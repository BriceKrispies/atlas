/**
 * Route-level tests for `apps/server/src/routes/health.ts`.
 *
 * Two assertions, both load-bearing for the I20 zero-restart probe
 * surfaced through `GET /readyz`:
 *
 *   1. `bootId` is stable across multiple `/readyz` calls inside the
 *      same Node process — a test harness probing twice MUST see the
 *      same value. This is the property BDD scenarios will assert
 *      between "code lands" and "BDD runs" to mechanically witness
 *      that `apps/server` did not restart in between.
 *
 *   2. Two distinct `AppState` instances built in the same process
 *      yield different `bootId`s — i.e. the value is fresh per
 *      bootstrap, not a module-level constant captured at import time.
 *      This is the smallest possible stand-in for "the next process
 *      boot will have a different identity"; a real second-process
 *      boot is exercised by BDD.
 *
 * See `tickets/chore/expose-server-bootid-for-i20-probe.md` and the
 * companion §11 retrospective at
 * `tickets/kernel-extraction/bootid-for-i20-probe.md`.
 */
import { describe, expect, test } from '@atlas/test';
import { Hono } from 'hono';
import type { ControlPlaneRegistry } from '@atlas/ports';
import type { AppState } from '../../src/bootstrap.ts';
import { healthRoutes } from '../../src/routes/health.ts';
import { buildFakeAppState } from '../lib/fake-state.ts';

/**
 * Wire just enough of `AppState` for the readyz handler to run without
 * tripping the throw-on-access proxy on `controlPlaneSql` /
 * `controlPlaneRegistry`. Everything else stays as `buildFakeAppState`
 * built it (notably `bootId` / `startedAt` — those are the values
 * under test).
 */
function withReadyzStubs(
  state: AppState,
  opts: { hasAction?: boolean } = {},
): AppState {
  const hasAction = opts.hasAction ?? true;

  // postgres.js exposes the connection as a tagged-template function;
  // we mimic that by returning a callable that resolves to a single-row
  // result, which is all the `SELECT 1` probe needs.
  const fakeSql = (function () {
    return Promise.resolve([{ ok: 1 }]);
  }) as unknown as AppState['controlPlaneSql'];

  const registry: ControlPlaneRegistry = {
    // The real readiness branch keys off `hasAction('Catalog.SeedPackage.Apply')`
    // (health.ts §34). Returning false here drives the production
    // `ready = false` path — not a stubbed response.
    hasAction(): boolean {
      return hasAction;
    },
    getAction(): null {
      return null;
    },
    getSchemaValidator(): null {
      return null;
    },
  };

  // Object-spread defeats the `readonly` modifier in TS; the AppState
  // contract only requires immutability at the consumer surface, not
  // in the test fixture builder.
  return {
    ...state,
    controlPlaneSql: fakeSql,
    controlPlaneRegistry: registry,
  };
}

describe('GET /readyz — boot identity surface', function () {
  test('bootId is stable across multiple /readyz calls within the same process', async function () {
    const { state } = buildFakeAppState();
    const wired = withReadyzStubs(state);
    const app = new Hono();
    app.route('/', healthRoutes(wired));

    const r1 = await app.request('/readyz');
    expect(r1.status).toBe(200);
    const body1 = (await r1.json()) as { bootId: string; startedAt: string };

    const r2 = await app.request('/readyz');
    expect(r2.status).toBe(200);
    const body2 = (await r2.json()) as { bootId: string; startedAt: string };

    // Same process → same bootId. This is the I20 probe contract.
    expect(body1.bootId).toBe(body2.bootId);
    expect(body1.bootId).toBe(wired.bootId);
    // startedAt is also stable per process.
    expect(body1.startedAt).toBe(body2.startedAt);
    // ISO-8601 (the contract documented on AppState.startedAt).
    expect(body1.startedAt).toBe(wired.startedAt.toISOString());
  });

  test('two AppState instances in the same process get distinct bootIds', function () {
    const a = buildFakeAppState().state;
    const b = buildFakeAppState().state;
    // Fresh UUID per bootstrap — the value is NOT a module-level
    // constant captured at import time. If this ever collides, either
    // crypto.randomUUID is broken or someone pinned the value.
    expect(a.bootId).not.toBe(b.bootId);
    // Both are syntactically UUID-shaped.
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(a.bootId).toMatch(uuidRe);
    expect(b.bootId).toMatch(uuidRe);
  });

  // drift-2026-05/readyz-503-branch-test-coverage — the 503 not-ready
  // branch carries bootId + startedAt, but no test exercised it. An
  // operator triaging an unhealthy boot needs the boot identity in the
  // FAILURE response, not just the 200 path. Drive the failure through
  // the real branch: `hasAction('Catalog.SeedPackage.Apply')` returns
  // false (health.ts §34-40 → ready = false → 503 at §48-49).
  test('the 503 not-ready branch still carries bootId + startedAt', async function () {
    const { state } = buildFakeAppState();
    const wired = withReadyzStubs(state, { hasAction: false });
    const app = new Hono();
    app.route('/', healthRoutes(wired));

    const r = await app.request('/readyz');
    // Registry reports no actions loaded → the production handler takes
    // the `ready = false` path and responds 503.
    expect(r.status).toBe(503);
    const body = (await r.json()) as {
      status: string;
      bootId: string;
      startedAt: string;
      checks: Record<string, string>;
    };
    expect(body.status).toBe('unavailable');
    // The boot-identity surface MUST survive the not-ready branch.
    expect(body.bootId).toBe(wired.bootId);
    expect(body.startedAt).toBe(wired.startedAt.toISOString());
    // The failing check is the one we drove, and the SQL probe (which we
    // left healthy) still reports ok — confirming we hit the registry
    // branch, not an incidental SQL failure.
    expect(body.checks['registry']).toBe('no actions loaded');
    expect(body.checks['control_plane_db']).toBe('ok');
  });
});

// drift-2026-05/healthz-negative-test-for-bootid-contract — liveness must
// stay terse. The /readyz positive test exists, but nothing locked the
// /healthz body shape, so a future change leaking bootId/startedAt onto
// liveness would pass silently. Lock the contract.
describe('GET /healthz — liveness stays terse', function () {
  test('returns exactly { status: "ok" } with no bootId / startedAt', async function () {
    const { state } = buildFakeAppState();
    // /healthz reads neither controlPlaneSql nor the registry, but wire
    // the stubs anyway so the proxy guard never trips if the handler
    // shape changes underneath us.
    const wired = withReadyzStubs(state);
    const app = new Hono();
    app.route('/', healthRoutes(wired));

    const r = await app.request('/healthz');
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;

    // Exact shape: status only.
    expect(body).toEqual({ status: 'ok' });
    // Boot-identity fields belong only on /readyz — explicitly assert
    // they are absent so a future widening of /healthz breaks here.
    expect(body).not.toHaveProperty('bootId');
    expect(body).not.toHaveProperty('startedAt');
    expect(Object.keys(body)).toEqual(['status']);
  });
});
