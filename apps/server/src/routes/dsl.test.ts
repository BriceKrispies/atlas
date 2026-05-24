/**
 * Route-level authz tests for `apps/server/src/routes/dsl.ts`.
 *
 * Closes the I2 hole tracked at `tickets/dsl/cedar-policy-actions.md`: the
 * DSL read / list / validate routes ran with NO `evaluateRead()` gate. These
 * tests assert the gate is in place and — critically — that a policy DENY
 * short-circuits BEFORE any side effect:
 *
 *   - unprivileged principal → 403 AUTHZ_POLICY_DENIED
 *   - admin principal → request proceeds (200 / 404 on the read path)
 *   - on DENY: the artifact store is NEVER touched (no existence leak)
 *   - on DENY for /validate: the DSL kind registry is NEVER touched, i.e.
 *     `validateDslSource()` (and therefore `parse()`) never runs — even
 *     parsing is a side effect I2 forbids on a denied request.
 *
 * Mirrors the test seam in `repositories.test.ts`: rather than `vi.mock`
 * (Node ESM modules are immutable post-import), the route's per-request
 * bundle is injected via `__setBuildRequestBundleForTest`. The injected
 * bundle carries a controllable `policyEngine` and call-recording spies for
 * the artifact store + kind registry, so "no side effect on deny" is a
 * direct assertion on whether those spies were invoked.
 *
 * @spec specs/architecture.md#I2
 * @spec specs/decisions/0007-dsl-substrate-and-authoring-contract.md
 */
import { describe, it, expect, beforeEach, afterEach } from '@atlas/test';
import { Hono } from 'hono';
import type {
  PolicyDecision,
  PolicyEvaluationRequest,
  PolicyEngine,
  DslArtifactStore,
} from '@atlas/ports';
import type { DslKindRegistry, AnyDslKind } from '@atlas/dsl';
import { dslRoutes } from './dsl.ts';
import {
  __setBuildRequestBundleForTest,
  type RequestBundle,
} from '../middleware/state.ts';
import type { AppState } from '../bootstrap.ts';
import type { ServerVariables } from '../middleware/principal.ts';

// ----------------------------------------------------------------------
// Spies. Each records whether it was touched so a denied request can be
// asserted to produce NO side effect (no store read, no parse).
// ----------------------------------------------------------------------

interface StoreSpy {
  store: DslArtifactStore;
  calls: string[];
}

function makeStoreSpy(): StoreSpy {
  const calls: string[] = [];
  const store = {
    async ensureKindRegistered() {
      calls.push('ensureKindRegistered');
    },
    async save() {
      calls.push('save');
      throw new Error('spy: save should not be called by a read route');
    },
    async get() {
      calls.push('get');
      return null;
    },
    async getVersion() {
      calls.push('getVersion');
      return null;
    },
    async getById() {
      calls.push('getById');
      return null;
    },
    async list() {
      calls.push('list');
      return [];
    },
  } as unknown as DslArtifactStore;
  return { store, calls };
}

interface RegistrySpy {
  registry: DslKindRegistry;
  calls: string[];
}

/**
 * Spy kind registry. `has`/`get`/`list` and the descriptor's `parse` all
 * record into `calls`. `validateDslSource()` calls `registry.has()` then
 * `registry.get()` then `descriptor.parse()` — so ANY entry in `calls`
 * after a /validate request proves the parse path was entered, which is a
 * side effect a policy-DENY must prevent.
 */
function makeRegistrySpy(): RegistrySpy {
  const calls: string[] = [];
  const descriptor = {
    kind: 'expression',
    parse(source: string) {
      calls.push(`parse:${source}`);
      return { ok: true, value: { ast: {}, sourceMap: { entries: [] } } };
    },
    evaluator: {
      staticCheck() {
        calls.push('staticCheck');
        return [];
      },
    },
    registry: {},
  } as unknown as AnyDslKind;
  const registry: DslKindRegistry = {
    has(kind: string) {
      calls.push(`has:${kind}`);
      return kind === 'expression';
    },
    get(kind: string) {
      calls.push(`get:${kind}`);
      return kind === 'expression' ? descriptor : undefined;
    },
    list() {
      calls.push('list');
      return ['expression'];
    },
  };
  return { registry, calls };
}

// ----------------------------------------------------------------------
// Controllable policy engine. The route's gate reads
// `bundle.ingress.policyEngine` via `evaluateRead`.
// ----------------------------------------------------------------------

function makePolicyEngine(effect: 'permit' | 'deny'): {
  engine: PolicyEngine;
  seen: PolicyEvaluationRequest[];
} {
  const seen: PolicyEvaluationRequest[] = [];
  const engine: PolicyEngine = {
    async evaluate(request: PolicyEvaluationRequest): Promise<PolicyDecision> {
      seen.push(request);
      return { effect, reasons: [`test: ${effect}`] };
    },
  };
  return { engine, seen };
}

// ----------------------------------------------------------------------
// State + app builders.
// ----------------------------------------------------------------------

const TENANT = 'tenant-a';

function makeState(registry: DslKindRegistry): AppState {
  // The DSL routes read `state.dslKindRegistry` (for validate) and pass
  // `state` to `buildRequestBundle`, which is overridden below — so no
  // Postgres/JWKS/adapter wiring is needed. Partial-as-AppState at the
  // boundary, matching the repositories.test.ts pattern.
  const partial = {
    dslKindRegistry: registry,
    config: {
      port: 3000,
      controlPlaneDbUrl: 'postgres://unused',
      oidc: { issuerUrl: '', jwksUrl: '', audience: '' },
      testAuth: { enabled: true, debugEndpoints: false },
      tenantId: '_platform',
      rustLog: '',
      policyEngine: 'stub' as const,
    },
  };
  return partial as unknown as AppState;
}

interface Harness {
  app: Hono<{ Variables: ServerVariables }>;
  storeCalls: string[];
  registryCalls: string[];
  policySeen: PolicyEvaluationRequest[];
}

function buildHarness(effect: 'permit' | 'deny'): Harness {
  const storeSpy = makeStoreSpy();
  const registrySpy = makeRegistrySpy();
  const { engine, seen } = makePolicyEngine(effect);

  // Inject a hand-built bundle. `ingress` only needs the fields
  // `evaluateRead` reads on the happy path (policyEngine + the required
  // scalar fields); the rest are left undefined via the cast.
  __setBuildRequestBundleForTest(async function (): Promise<RequestBundle> {
    return {
      ingress: {
        tenantId: TENANT,
        principalId: 'usr-x',
        correlationId: 'test-corr',
        policyEngine: engine,
      },
      dslArtifactStore: storeSpy.store,
    } as unknown as RequestBundle;
  });

  const state = makeState(registrySpy.registry);
  const app = new Hono<{ Variables: ServerVariables }>();
  app.use('*', async function (c, next) {
    c.set('principal', { principalId: 'usr-x', tenantId: TENANT });
    c.set('correlationId', 'test-corr');
    await next();
  });
  app.route('/', dslRoutes(state));
  return {
    app,
    storeCalls: storeSpy.calls,
    registryCalls: registrySpy.calls,
    policySeen: seen,
  };
}

interface ErrorBody {
  error: { code: string; message: string };
}

beforeEach(function () {
  __setBuildRequestBundleForTest(null);
});
afterEach(function () {
  __setBuildRequestBundleForTest(null);
});

// ----------------------------------------------------------------------
// GET /api/v1/dsl/:kind  (list)
// ----------------------------------------------------------------------
describe('GET /api/v1/dsl/:kind — list authz', function () {
  it('denies an unprivileged principal with 403 AUTHZ_POLICY_DENIED', async function () {
    const h = buildHarness('deny');
    const res = await h.app.request('/api/v1/dsl/expression');
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('AUTHZ_POLICY_DENIED');
  });

  it('gates on Dsl.Expression.List BEFORE reading the store (no existence leak)', async function () {
    const h = buildHarness('deny');
    await h.app.request('/api/v1/dsl/expression');
    expect(h.policySeen.map((r) => r.action)).toEqual(['Dsl.Expression.List']);
    expect(h.storeCalls).toEqual([]);
  });

  it('permits an authorized principal (store IS read)', async function () {
    const h = buildHarness('permit');
    const res = await h.app.request('/api/v1/dsl/expression');
    expect(res.status).toBe(200);
    expect(h.storeCalls).toContain('list');
  });
});

// ----------------------------------------------------------------------
// GET /api/v1/dsl/:kind/:apiName  (read)
// ----------------------------------------------------------------------
describe('GET /api/v1/dsl/:kind/:apiName — read authz', function () {
  it('denies with 403 and does NOT read the store', async function () {
    const h = buildHarness('deny');
    const res = await h.app.request('/api/v1/dsl/expression/my-expr');
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('AUTHZ_POLICY_DENIED');
    expect(h.policySeen.map((r) => r.action)).toEqual(['Dsl.Expression.Read']);
    expect(h.storeCalls).toEqual([]);
  });

  it('permits and reads the store (404 when absent, never 403)', async function () {
    const h = buildHarness('permit');
    const res = await h.app.request('/api/v1/dsl/expression/my-expr');
    expect(res.status).toBe(404);
    expect(h.storeCalls).toContain('get');
  });
});

// ----------------------------------------------------------------------
// GET /api/v1/dsl/:kind/:apiName/v/:version  (read version)
// ----------------------------------------------------------------------
describe('GET /api/v1/dsl/:kind/:apiName/v/:version — read-version authz', function () {
  it('denies with 403 and does NOT read the store', async function () {
    const h = buildHarness('deny');
    const res = await h.app.request('/api/v1/dsl/expression/my-expr/v/2');
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('AUTHZ_POLICY_DENIED');
    expect(h.policySeen.map((r) => r.action)).toEqual(['Dsl.Expression.Read']);
    expect(h.storeCalls).toEqual([]);
  });

  // SDET: the implementer only tested the read-version DENY path. The PERMIT
  // path — confirming the gate passes through to the version-specific store
  // read (getVersion, not get/list) — was unwitnessed. Without this a future
  // refactor could silently route read-version at the wrong store method
  // while the deny test still passes.
  it('permits and reads the versioned store (getVersion; 404 when absent, never 403)', async function () {
    const h = buildHarness('permit');
    const res = await h.app.request('/api/v1/dsl/expression/my-expr/v/2');
    expect(res.status).toBe(404);
    expect(h.policySeen.map((r) => r.action)).toEqual(['Dsl.Expression.Read']);
    expect(h.storeCalls).toContain('getVersion');
  });

  // SDET / I2 ordering observation. The version-syntax 400 fires BEFORE the
  // authz gate (route parses `:version` and short-circuits on a non-positive
  // integer ahead of buildRequestBundle/evaluateRead). This is a deliberate
  // pin of CURRENT behavior, NOT an endorsement: a denied principal hitting
  // `/v/abc` learns the version is malformed without an authz check. It leaks
  // nothing tenant-scoped (purely syntactic validation of the caller's own
  // URL) and never touches the store — but if the team decides authz must
  // precede ALL request-shape feedback, this test will flag the change.
  it('returns 400 for a malformed version BEFORE the authz gate runs (no store, no policy eval)', async function () {
    const h = buildHarness('deny');
    const res = await h.app.request('/api/v1/dsl/expression/my-expr/v/not-a-number');
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('DSL_INVALID_VERSION');
    // Gate never ran, store never touched — the short-circuit is pre-authz.
    expect(h.policySeen).toEqual([]);
    expect(h.storeCalls).toEqual([]);
  });
});

// ----------------------------------------------------------------------
// Unknown :kind — deny must not reveal kind existence (SDET addition)
// ----------------------------------------------------------------------
describe('unknown :kind — authz gate runs regardless of kind registration', function () {
  // The kind is interpolated into the action id (`Dsl.<Kind>.List`) BEFORE
  // any registry lookup. A denied principal asking for a bogus kind must get
  // the same 403 as for a real kind, with NO store read and NO registry
  // consult — so deny can't be used to probe which kinds exist.
  it('denies list on an unknown kind with 403 and touches neither store nor registry', async function () {
    const h = buildHarness('deny');
    const res = await h.app.request('/api/v1/dsl/nope');
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('AUTHZ_POLICY_DENIED');
    expect(h.policySeen.map((r) => r.action)).toEqual(['Dsl.Nope.List']);
    expect(h.storeCalls).toEqual([]);
    expect(h.registryCalls).toEqual([]);
  });

  it('denies validate on an unknown kind with 403 before any parse', async function () {
    const h = buildHarness('deny');
    const res = await h.app.request('/api/v1/dsl/nope/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: '1 + 1' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('AUTHZ_POLICY_DENIED');
    expect(h.policySeen.map((r) => r.action)).toEqual(['Dsl.Nope.Validate']);
    expect(h.registryCalls).toEqual([]);
  });
});

// ----------------------------------------------------------------------
// POST /api/v1/dsl/:kind/validate  (the adversarial case)
// ----------------------------------------------------------------------
describe('POST /api/v1/dsl/:kind/validate — validate authz short-circuit', function () {
  it('denies with 403 BEFORE parsing (registry untouched — no parse side effect)', async function () {
    const h = buildHarness('deny');
    const res = await h.app.request('/api/v1/dsl/expression/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: '1 + 1' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('AUTHZ_POLICY_DENIED');
    // The gate ran for the validate action…
    expect(h.policySeen.map((r) => r.action)).toEqual(['Dsl.Expression.Validate']);
    // …and the kind registry was NEVER consulted — `validateDslSource()`
    // (and therefore `parse()`) never ran. Even parsing is a side effect
    // I2 forbids on a denied request.
    expect(h.registryCalls).toEqual([]);
  });

  it('permits and parses (registry IS consulted)', async function () {
    const h = buildHarness('permit');
    const res = await h.app.request('/api/v1/dsl/expression/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: '1 + 1' }),
    });
    expect(res.status).toBe(200);
    expect(h.registryCalls).toContain('parse:1 + 1');
  });

  // SDET — THE adversarial case from the ticket. A denied principal sends a
  // MALFORMED body. The I2 claim ("authz runs BEFORE the body is read") only
  // holds if the deny short-circuit fires ahead of `c.req.json()`. If the
  // body were parsed first, this would 400 DSL_INVALID_REQUEST — leaking that
  // the request reached parse-stage — instead of the authz 403. We assert the
  // 403 wins, proving the gate genuinely precedes the body read, not just the
  // source-parse. (The implementer's deny test sent VALID JSON, so it could
  // not distinguish "authz before body read" from "authz before source parse,
  // body read regardless".)
  it('denies with 403 even when the body is malformed JSON (authz precedes the body read)', async function () {
    const h = buildHarness('deny');
    const res = await h.app.request('/api/v1/dsl/expression/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not valid json',
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('AUTHZ_POLICY_DENIED');
    expect(h.policySeen.map((r) => r.action)).toEqual(['Dsl.Expression.Validate']);
    expect(h.registryCalls).toEqual([]);
  });

  // SDET — a missing `source` field under deny must ALSO 403, not 400
  // DSL_INVALID_REQUEST. Same ordering guarantee: the body-shape validation
  // lives after the deny short-circuit, so a denied caller never learns their
  // payload was structurally wrong.
  it('denies with 403 when source is missing (no 400 shape-feedback leak)', async function () {
    const h = buildHarness('deny');
    const res = await h.app.request('/api/v1/dsl/expression/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hints: { foo: 1 } }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('AUTHZ_POLICY_DENIED');
    expect(h.registryCalls).toEqual([]);
  });
});
