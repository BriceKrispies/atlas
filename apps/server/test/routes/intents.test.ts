/**
 * Route-level tests for `apps/server/src/routes/intents.ts`.
 *
 * The single most important HTTP route — the production submitIntent
 * pipeline lands here. Coverage focuses on the route's own
 * orchestration (JSON parsing, correlation-id stamping, log-line
 * shape, error mapping) PLUS the contract guarantees (I2: deny path
 * appends no events; I3: idempotency replay returns prior eventId; I5:
 * inbound X-Correlation-Id is honored end-to-end).
 *
 * Strategy: mock `../../src/middleware/state.ts` so each test installs
 * a hand-built `RequestBundle` over in-memory ports — the production
 * route code runs unchanged. Mirrors the harness pattern used in
 * `src/routes/repositories.test.ts` and `src/routes/identity-a7.test.ts`.
 */

import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { EventEnvelope, IntentEnvelope } from '@atlas/platform-core';
import type { IntentHandler, IntentHandlerContext } from '@atlas/ports';
import {
  attachTestPrincipalMiddleware,
  buildFakeAppState,
  buildFakeBundle,
  makeValidator,
  StubAllowEngine,
  StubDenyEngine,
  type FakeBundle,
} from '../lib/fake-state.ts';
import type { ServerVariables } from '../../src/middleware/principal.ts';
import type { AppState } from '../../src/bootstrap.ts';

// ----------------------------------------------------------------------
// Test-scoped mock holder. The route imports `buildRequestBundle` from
// `../middleware/state.ts`; we replace that export with a function that
// returns whatever bundle the active test installed via `installBundle()`.
// ----------------------------------------------------------------------

let nextBundle: FakeBundle | null = null;
let nextBundleError: Error | null = null;

function installBundle(b: FakeBundle): void {
  nextBundle = b;
  nextBundleError = null;
}
function installBundleError(e: Error): void {
  nextBundle = null;
  nextBundleError = e;
}

vi.mock('../../src/middleware/state.ts', async () => {
  const actual = await vi.importActual<typeof import('../../src/middleware/state.ts')>(
    '../../src/middleware/state.ts',
  );
  return {
    ...actual,
    buildRequestBundle: vi.fn(async () => {
      if (nextBundleError) throw nextBundleError;
      if (!nextBundle) {
        throw new Error('test setup: no fake bundle installed; call installBundle()');
      }
      return nextBundle;
    }),
  };
});

// Late-import the route under test so the mock above takes effect.
import { intentRoutes } from '../../src/routes/intents.ts';

// ----------------------------------------------------------------------
// Build a Hono app with the same test-principal middleware shape the
// other route tests use. The intents route is registered last; the
// earlier middleware sets `principal`, `correlationId`, `ctx`.
// ----------------------------------------------------------------------

function buildApp(state: AppState, opts: {
  principal?: { principalId: string; tenantId: string };
}): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();
  attachTestPrincipalMiddleware(app, {
    state,
    ...(opts.principal ? { principal: opts.principal } : {}),
  });
  app.route('/', intentRoutes(state));
  return app;
}

const TENANT = 'tenant-a';
const PRINCIPAL = 'user-alice';
const SCHEMA_ID = 'test.action.v1';
const ACTION_ID = 'Test.Action.Do';

function envelope(overrides: Partial<IntentEnvelope> = {}): IntentEnvelope {
  return {
    eventType: 'Test.Requested',
    schemaId: SCHEMA_ID,
    schemaVersion: 1,
    tenantId: TENANT,
    correlationId: 'corr-test',
    idempotencyKey: 'idem-1',
    payload: {
      actionId: ACTION_ID,
      resourceType: 'TestResource',
      resourceId: 'r-1',
    },
    ...overrides,
  };
}

beforeEach(() => {
  nextBundle = null;
  nextBundleError = null;
});

// ======================================================================
// Authn: no principal middleware ran → route guards explicitly and 401s
// with PRINCIPAL_REQUIRED. Production's principalMiddleware mounts before
// this route in the authed group; the in-route guard is defense-in-depth.
// ======================================================================

describe('POST /api/v1/intents — authn precondition', () => {
  test('returns 401 PRINCIPAL_REQUIRED when no principal was set by upstream middleware', async () => {
    const { state, collector } = buildFakeAppState();
    const app = buildApp(state, {});
    installBundle(
      buildFakeBundle({ state, correlationId: 'corr-test', principalId: PRINCIPAL }),
    );

    const res = await app.request('/api/v1/intents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem-noauth',
      },
      body: JSON.stringify(envelope()),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PRINCIPAL_REQUIRED');

    const rejected = collector.events.find(
      (e) => e.eventName === 'Intent.Rejected',
    );
    expect(rejected).toBeDefined();
    expect((rejected!.properties as { code: string }).code).toBe('PRINCIPAL_REQUIRED');
  });
});

// ======================================================================
// Body parse / required headers.
// ======================================================================

describe('POST /api/v1/intents — body validation', () => {
  test('invalid JSON body → 400 BAD_REQUEST', async () => {
    const { state, collector } = buildFakeAppState();
    installBundle(buildFakeBundle({ state, correlationId: 'corr-1', principalId: PRINCIPAL }));
    const app = buildApp(state, {
      principal: { principalId: PRINCIPAL, tenantId: TENANT },
    });

    const res = await app.request('/api/v1/intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');

    // Intent.Rejected log line was emitted.
    const rejected = collector.events.find(
      (e) => e.eventName === 'Intent.Rejected',
    );
    expect(rejected).toBeDefined();
    expect((rejected!.properties as { code: string }).code).toBe('BAD_REQUEST');
  });

  test('missing idempotencyKey → 400 INVALID_IDEMPOTENCY_KEY', async () => {
    const { state, collector } = buildFakeAppState();
    installBundle(buildFakeBundle({ state, correlationId: 'corr-1', principalId: PRINCIPAL }));
    const app = buildApp(state, {
      principal: { principalId: PRINCIPAL, tenantId: TENANT },
    });

    // The route forwards the body to submitIntent which enforces the
    // idempotency-key contract. The X-Idempotency-Key header is not the
    // same surface as `envelope.idempotencyKey`; submitIntent reads the
    // envelope field. An empty value → INVALID_IDEMPOTENCY_KEY 400.
    const res = await app.request('/api/v1/intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope({ idempotencyKey: '' })),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');

    const rejected = collector.events.find(
      (e) => e.eventName === 'Intent.Rejected',
    );
    expect(rejected).toBeDefined();
  });
});

// ======================================================================
// Schema / action lookup.
// ======================================================================

describe('POST /api/v1/intents — schema validation', () => {
  test('unknown action / schema → 400', async () => {
    const { state } = buildFakeAppState();
    // Bundle has no validator registered for this schemaId — submitIntent
    // throws UNKNOWN_SCHEMA at step 3 of its pipeline.
    installBundle(
      buildFakeBundle({
        state,
        correlationId: 'corr-1',
        principalId: PRINCIPAL,
        validators: {},
        actions: {},
      }),
    );
    const app = buildApp(state, {
      principal: { principalId: PRINCIPAL, tenantId: TENANT },
    });
    const res = await app.request('/api/v1/intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope()),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNKNOWN_SCHEMA');
  });

  test('schema validator returns false → 400 SCHEMA_VALIDATION_FAILED with truncated reason', async () => {
    const { state, collector } = buildFakeAppState();
    // Build a long synthetic error string to verify the route truncates
    // it at 200 chars in the log line (Intent.Rejected.properties.reason).
    const longField = '/very-deeply-nested-path-' + 'x'.repeat(400);
    installBundle(
      buildFakeBundle({
        state,
        correlationId: 'corr-1',
        principalId: PRINCIPAL,
        validators: {
          [`${SCHEMA_ID}:1`]: makeValidator(false, [
            { instancePath: longField, message: 'mismatch' },
          ]),
        },
      }),
    );
    const app = buildApp(state, {
      principal: { principalId: PRINCIPAL, tenantId: TENANT },
    });
    const res = await app.request('/api/v1/intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope()),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SCHEMA_VALIDATION_FAILED');

    const rejected = collector.events.find(
      (e) => e.eventName === 'Intent.Rejected',
    );
    expect(rejected).toBeDefined();
    const reason = (rejected!.properties as { reason: string }).reason;
    // Route truncates to 200 chars + ellipsis when the underlying
    // message is longer.
    expect(reason.length).toBeLessThanOrEqual(201); // 200 chars + 1 char ellipsis
    expect(reason).toMatch(/…$/);
  });
});

// ======================================================================
// Authz — Invariant I2: no events on deny.
// ======================================================================

describe('POST /api/v1/intents — authz (Invariant I2)', () => {
  test('deny → 403, NO event appended, NO dispatch invoked', async () => {
    const { state, collector } = buildFakeAppState();
    const bundle = buildFakeBundle({
      state,
      correlationId: 'corr-1',
      principalId: PRINCIPAL,
      policyEngine: new StubDenyEngine(),
    });
    installBundle(bundle);
    const app = buildApp(state, {
      principal: { principalId: PRINCIPAL, tenantId: TENANT },
    });
    const res = await app.request('/api/v1/intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope()),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');

    // Invariant I2 — no side effects on a denied request. The audit
    // emit hook is the one permitted side effect; we did not wire one.
    expect(bundle.events.appended).toHaveLength(0);
    expect(bundle.dispatchSpy.calls).toHaveLength(0);

    // Intent.Rejected log line was emitted.
    expect(
      collector.events.some((e) => e.eventName === 'Intent.Rejected'),
    ).toBe(true);
  });

  test('permit → 202 with eventId + correlationId', async () => {
    const { state, collector } = buildFakeAppState();
    const handler: IntentHandler = {
      async handle(ctx: IntentHandlerContext, env: IntentEnvelope) {
        const primary: EventEnvelope = {
          eventId: 'evt-primary',
          eventType: 'Test.Done',
          schemaId: env.schemaId,
          schemaVersion: env.schemaVersion,
          occurredAt: new Date().toISOString(),
          tenantId: env.tenantId,
          correlationId: ctx.correlationId,
          idempotencyKey: env.idempotencyKey,
          payload: env.payload,
          cacheInvalidationTags: [`Tenant:${env.tenantId}`],
        };
        const stored = await ctx.eventStore.append(primary);
        primary.eventId = stored.eventId;
        primary.seq = stored.seq;
        return { primary, follow: [] };
      },
    };
    const bundle = buildFakeBundle({
      state,
      correlationId: 'corr-permit',
      principalId: PRINCIPAL,
      handlers: { [ACTION_ID]: handler },
      policyEngine: new StubAllowEngine(),
    });
    installBundle(bundle);
    const app = buildApp(state, {
      principal: { principalId: PRINCIPAL, tenantId: TENANT },
    });
    const res = await app.request('/api/v1/intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope()),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      eventId: string;
      tenantId: string;
      principalId: string;
    };
    expect(body.eventId).toBeDefined();
    expect(body.tenantId).toBe(TENANT);
    expect(body.principalId).toBe(PRINCIPAL);

    // Handler ran → at least one append + one dispatch invocation.
    expect(bundle.events.appended.length).toBeGreaterThan(0);
    expect(bundle.dispatchSpy.calls.length).toBeGreaterThan(0);

    // Intent.Accepted log line emitted (route's success path).
    const accepted = collector.events.find(
      (e) => e.eventName === 'Intent.Accepted',
    );
    expect(accepted).toBeDefined();
    expect((accepted!.properties as { actionId: string }).actionId).toBe(ACTION_ID);
  });
});

// ======================================================================
// Idempotency replay — Invariant I3.
// ======================================================================

describe('POST /api/v1/intents — idempotency (Invariant I3)', () => {
  test('replay of the same idempotencyKey returns the prior eventId, no new events', async () => {
    const { state } = buildFakeAppState();
    const priorEvt: EventEnvelope = {
      eventId: 'evt-prior',
      eventType: 'Test.Requested',
      schemaId: SCHEMA_ID,
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT,
      correlationId: 'corr-prior',
      idempotencyKey: 'idem-replay',
      payload: { actionId: ACTION_ID, resourceType: 'TestResource', resourceId: 'r-1' },
    };
    const bundle = buildFakeBundle({
      state,
      correlationId: 'corr-2',
      principalId: PRINCIPAL,
      priorEvents: [priorEvt],
    });
    installBundle(bundle);
    const app = buildApp(state, {
      principal: { principalId: PRINCIPAL, tenantId: TENANT },
    });

    const res = await app.request('/api/v1/intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope({ idempotencyKey: 'idem-replay' })),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { eventId: string };
    expect(body.eventId).toBe('evt-prior');

    // Replay path must NOT append a new event nor invoke dispatch.
    expect(bundle.events.appended).toHaveLength(0);
    expect(bundle.dispatchSpy.calls).toHaveLength(0);
  });
});

// ======================================================================
// Correlation-id propagation — Invariant I5.
// ======================================================================

describe('POST /api/v1/intents — correlation-id propagation (Invariant I5)', () => {
  test('inbound X-Correlation-Id header is honored on the response logger', async () => {
    const { state, collector } = buildFakeAppState();
    const bundle = buildFakeBundle({
      state,
      correlationId: 'corr-from-header',
      principalId: PRINCIPAL,
      policyEngine: new StubAllowEngine(),
    });
    installBundle(bundle);
    const app = buildApp(state, {
      principal: { principalId: PRINCIPAL, tenantId: TENANT },
    });

    const res = await app.request('/api/v1/intents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': 'corr-from-header',
      },
      // Envelope omits `correlationId` so the route stamps it from the
      // request-resolved id.
      body: JSON.stringify({
        eventType: 'Test.Requested',
        schemaId: SCHEMA_ID,
        schemaVersion: 1,
        tenantId: TENANT,
        idempotencyKey: 'idem-corr',
        correlationId: '',
        payload: {
          actionId: ACTION_ID,
          resourceType: 'TestResource',
          resourceId: 'r-1',
        },
      }),
    });
    expect(res.status).toBe(202);
    // Every captured log line for this request carries the header id —
    // the route's logger is rooted in the system context built from
    // c.get('correlationId'). Submitted + Accepted both must agree.
    const submitted = collector.events.find((e) => e.eventName === 'Intent.Submitted');
    const accepted = collector.events.find((e) => e.eventName === 'Intent.Accepted');
    expect(submitted).toBeDefined();
    expect(accepted).toBeDefined();
    expect(submitted!.correlationId).toBe('corr-from-header');
    expect(accepted!.correlationId).toBe('corr-from-header');
  });
});

// ======================================================================
// Bundle build failure (e.g. tenant migration error before submitIntent).
// ======================================================================

describe('POST /api/v1/intents — bundle build failure', () => {
  test('buildRequestBundle throws → 500 with BUNDLE_BUILD_FAILED log line', async () => {
    const { state, collector } = buildFakeAppState();
    installBundleError(new Error('tenant pool unavailable'));
    const app = buildApp(state, {
      principal: { principalId: PRINCIPAL, tenantId: TENANT },
    });
    const res = await app.request('/api/v1/intents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope()),
    });
    expect(res.status).toBeGreaterThanOrEqual(500);
    const rejected = collector.events.find((e) => e.eventName === 'Intent.Rejected');
    expect(rejected).toBeDefined();
    expect((rejected!.properties as { code: string }).code).toBe('BUNDLE_BUILD_FAILED');
  });
});
