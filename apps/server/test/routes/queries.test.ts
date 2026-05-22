/**
 * Route-level tests for `apps/server/src/routes/queries.ts` — the
 * query-side catch-all dispatcher.
 *
 * Substrate ticket: `tickets/atlas-on-atlas/query-catch-all-dispatcher.md`.
 * Contract: [`specs/crosscut/action-driven-routing.md`](../../../../specs/crosscut/action-driven-routing.md) §4.
 *
 * Coverage:
 *   1. Synthetic query registered in a test-only registry → reachable
 *      via `GET /api/v1/queries/<id>` and returns the function's value.
 *   2. `Identity.Memberships.List` against a seeded in-memory entity
 *      store → membership list comes back.
 *   3. I2 deny path: a `StubDenyEngine` cuts dispatch with 403 BEFORE
 *      the query fn runs (assertion: fn-call counter stays 0).
 *   4. Cache-key wire-through: the descriptor's `cacheKey()` result is
 *      the exact key passed to `cache.set()` on cache miss.
 *
 * Strategy: install a fake `RequestBundle` via
 * `__setBuildRequestBundleForTest`; the route reads through that and
 * dispatches against a registry the test supplies via `queryRoutes()`
 * directly (no need to mutate the process-wide composed registry).
 */
import { describe, expect, test, beforeEach, afterAll, vi } from '@atlas/test';
import { Hono } from 'hono';
import {
  createQueryRegistry,
  type Cache,
  type QueryContext,
  type QueryRegistry,
} from '@atlas/ports';
import { identityQueryRegistry } from '@atlas/identity';
import {
  attachTestPrincipalMiddleware,
  buildFakeAppState,
  buildFakeBundle,
  makeFakeCache,
  makeFakeEntityStore,
  StubAllowEngine,
  StubDenyEngine,
  type FakeBundle,
} from '../lib/fake-state.ts';
import type { ServerVariables } from '../../src/middleware/principal.ts';
import type { AppState } from '../../src/bootstrap.ts';
import { __setBuildRequestBundleForTest, type RequestBundle } from '../../src/middleware/state.ts';
import { queryRoutes } from '../../src/routes/queries.ts';
import type { Entity, EntityListOptions, EntityStore } from '@atlas/ports';

// ----------------------------------------------------------------------
// Bundle override harness — mirrors the intent-route test's pattern.
// ----------------------------------------------------------------------
let nextBundle: FakeBundle | null = null;
__setBuildRequestBundleForTest(async function () {
  if (!nextBundle) {
    throw new Error('test setup: no fake bundle installed; call installBundle()');
  }
  return nextBundle as unknown as RequestBundle;
});
function installBundle(b: FakeBundle): void {
  nextBundle = b;
}
afterAll(function () {
  __setBuildRequestBundleForTest(null);
});
beforeEach(function () {
  nextBundle = null;
});

const TENANT = 'tenant-a';
const PRINCIPAL = 'user-alice';

function buildApp(
  state: AppState,
  registry: QueryRegistry,
  cacheFor: (b: Awaited<ReturnType<typeof import('../../src/middleware/state.ts').buildRequestBundle>>) => Cache,
): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();
  attachTestPrincipalMiddleware(app, {
    state,
    principal: { principalId: PRINCIPAL, tenantId: TENANT },
  });
  app.route('/', queryRoutes(state, registry, cacheFor));
  return app;
}

// ----------------------------------------------------------------------
// 1. Synthetic query — reachable through the catch-all with no edits.
// ----------------------------------------------------------------------
describe('GET /api/v1/queries/:queryId — synthetic query roundtrip', function () {
  test('a query registered in a module-style registry is reachable', async function () {
    const { state } = buildFakeAppState();
    const registry = createQueryRegistry();
    const fnSpy = vi.fn(async function (_ctx: QueryContext) {
      return { hello: 'world', count: 42 };
    });
    registry.register({
      queryId: 'Synthetic.Hello.Get',
      actionId: 'Synthetic.Hello.Get',
      resource: { type: 'Synthetic', idFrom: function () { return ''; } },
      cacheKey: function (ctx) { return `Synthetic.Hello:${ctx.tenantId}`; },
      fn: fnSpy,
    });

    const bundle = buildFakeBundle({
      state,
      correlationId: 'corr-1',
      principalId: PRINCIPAL,
      policyEngine: new StubAllowEngine(),
    });
    installBundle(bundle);

    const app = buildApp(state, registry, function (b) {
      return b.ingress.cache;
    });
    const res = await app.request('/api/v1/queries/Synthetic.Hello.Get');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { hello: string; count: number };
    expect(body).toEqual({ hello: 'world', count: 42 });
    expect(fnSpy).toHaveBeenCalledTimes(1);
  });

  test('unknown queryId → 404', async function () {
    const { state } = buildFakeAppState();
    const registry = createQueryRegistry();
    const bundle = buildFakeBundle({
      state,
      correlationId: 'corr-1',
      principalId: PRINCIPAL,
      policyEngine: new StubAllowEngine(),
    });
    installBundle(bundle);
    const app = buildApp(state, registry, function (b) {
      return b.ingress.cache;
    });
    const res = await app.request('/api/v1/queries/Not.Registered.Anywhere');
    // Auth runs first today, but we need the principal middleware to
    // populate the principal so the route reaches the descriptor lookup.
    // The test-principal middleware attaches `principal` unconditionally,
    // so we reach the 404 path.
    expect(res.status).toBe(404);
  });

  test('POST body params reach the fn', async function () {
    const { state } = buildFakeAppState();
    const registry = createQueryRegistry();
    const receivedParams: Record<string, unknown>[] = [];
    registry.register({
      queryId: 'Synthetic.Echo.Get',
      actionId: 'Synthetic.Echo.Get',
      resource: { type: 'Synthetic', idFrom: function () { return ''; } },
      fn: async function (_ctx, params) {
        receivedParams.push(params);
        return { echoed: params };
      },
    });
    const bundle = buildFakeBundle({
      state,
      correlationId: 'corr-1',
      principalId: PRINCIPAL,
      policyEngine: new StubAllowEngine(),
    });
    installBundle(bundle);
    const app = buildApp(state, registry, function (b) {
      return b.ingress.cache;
    });
    const res = await app.request('/api/v1/queries/Synthetic.Echo.Get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: 'active', limit: 10 }),
    });
    expect(res.status).toBe(200);
    expect(receivedParams[0]).toEqual({ filter: 'active', limit: 10 });
  });
});

// ----------------------------------------------------------------------
// 2. `Identity.Memberships.List` against a seeded entity store.
// ----------------------------------------------------------------------
describe('GET /api/v1/queries/Identity.Memberships.List — real identity query', function () {
  test('returns the memberships seeded in the tenant', async function () {
    const { state } = buildFakeAppState();
    const registry = identityQueryRegistry();

    // Seed two memberships into a fake EntityStore so the real
    // `listMembershipsForTenant` helper returns them.
    const seededEntities: Entity<unknown>[] = [
      {
        tenantId: TENANT,
        entityType: 'Membership',
        entityId: 'mem-1',
        schemaVersion: 1,
        status: 'active',
        attrs: {
          tenantId: TENANT,
          membershipId: 'mem-1',
          userId: 'user-1',
          roles: ['Admin'],
          status: 'active',
        },
        createdAt: '2026-05-21T00:00:00Z',
        updatedAt: '2026-05-21T00:00:00Z',
      },
      {
        tenantId: TENANT,
        entityType: 'Membership',
        entityId: 'mem-2',
        schemaVersion: 1,
        status: 'active',
        attrs: {
          tenantId: TENANT,
          membershipId: 'mem-2',
          userId: 'user-2',
          roles: ['Member'],
          status: 'active',
        },
        createdAt: '2026-05-21T00:00:00Z',
        updatedAt: '2026-05-21T00:00:00Z',
      },
    ];
    const entities: EntityStore = makeFakeEntityStore({
      async list<T = unknown>(
        tenantId: string,
        entityType: string,
        _opts?: EntityListOptions,
      ): Promise<Entity<T>[]> {
        if (tenantId !== TENANT || entityType !== 'Membership') return [];
        return seededEntities as Entity<T>[];
      },
    });

    const bundle = buildFakeBundle({
      state,
      correlationId: 'corr-1',
      principalId: PRINCIPAL,
      policyEngine: new StubAllowEngine(),
    });
    // Inject seeded entities onto the identityDeps slot of the bundle so
    // buildRequestBundle's identityDeps.entities (which the route reads
    // off the bundle when assembling QueryContext.entities) returns the
    // seeded store.
    bundle.identityDeps = {
      ...bundle.identityDeps,
      entities,
    };

    installBundle(bundle);
    const app = buildApp(state, registry, function (b) {
      return b.ingress.cache;
    });
    const res = await app.request('/api/v1/queries/Identity.Memberships.List');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ membershipId: string; userId: string }>;
    expect(body).toHaveLength(2);
    expect(body.map((m) => m.membershipId).sort()).toEqual(['mem-1', 'mem-2']);
  });
});

// ----------------------------------------------------------------------
// 3. I2: deny short-circuits 403, fn not called.
// ----------------------------------------------------------------------
describe('Query catch-all — Invariant I2 (authz before fn)', function () {
  test('deny → 403, fn never called, no cache read', async function () {
    const { state } = buildFakeAppState();
    const registry = createQueryRegistry();
    const fnSpy = vi.fn(async function () {
      return { secret: 'should-not-leak' };
    });
    const cacheGetSpy = vi.fn(async function () {
      return null;
    });
    registry.register({
      queryId: 'Identity.Memberships.List',
      actionId: 'Identity.Memberships.List',
      resource: { type: 'Tenant', idFrom: function () { return ''; } },
      cacheKey: function (ctx) { return `Identity.Memberships:${ctx.tenantId}`; },
      fn: fnSpy,
    });

    const cache = makeFakeCache({ get: cacheGetSpy });
    const bundle = buildFakeBundle({
      state,
      correlationId: 'corr-deny',
      principalId: PRINCIPAL,
      policyEngine: new StubDenyEngine(),
    });
    // Replace the bundle's cache with the spy so we can assert no get().
    bundle.ingress = { ...bundle.ingress, cache };

    installBundle(bundle);
    const app = buildApp(state, registry, function (b) {
      return b.ingress.cache;
    });
    const res = await app.request('/api/v1/queries/Identity.Memberships.List');

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');

    // I2: no fn call, no cache read on deny.
    expect(fnSpy).toHaveBeenCalledTimes(0);
    expect(cacheGetSpy).toHaveBeenCalledTimes(0);
  });
});

// ----------------------------------------------------------------------
// 4. Cache-key wire-through: descriptor.cacheKey is exactly the key
//    used for cache.get and cache.set.
// ----------------------------------------------------------------------
describe('Query catch-all — cacheKey wire-through', function () {
  test('descriptor cacheKey is the literal key passed to cache.get + cache.set', async function () {
    const { state } = buildFakeAppState();
    const registry = createQueryRegistry();
    const expectedKey = `MyCustom.Query:${TENANT}`;
    const getCalls: string[] = [];
    const setCalls: Array<{ key: string; value: unknown }> = [];
    const cache = makeFakeCache({
      async get(key: string) {
        getCalls.push(key);
        return null;
      },
      async set(key: string, value: unknown) {
        setCalls.push({ key, value });
      },
    });

    registry.register({
      queryId: 'MyCustom.Query.Get',
      actionId: 'MyCustom.Query.Get',
      resource: { type: 'Custom', idFrom: function () { return ''; } },
      cacheKey: function (ctx) {
        // Static shape — tenantId literal per §4.6.
        return `MyCustom.Query:${ctx.tenantId}`;
      },
      fn: async function () {
        return { value: 'fresh' };
      },
    });

    const bundle = buildFakeBundle({
      state,
      correlationId: 'corr-cache',
      principalId: PRINCIPAL,
      policyEngine: new StubAllowEngine(),
    });
    bundle.ingress = { ...bundle.ingress, cache };
    installBundle(bundle);

    const app = buildApp(state, registry, function (b) {
      return b.ingress.cache;
    });
    const res = await app.request('/api/v1/queries/MyCustom.Query.Get');
    expect(res.status).toBe(200);

    // The exact descriptor-built key was used for both get and set.
    // This is the "sanity probe — if the catch-all forgets the
    // descriptor's cacheKey, this test fails" guarantee the substrate
    // acceptance bar calls out.
    expect(getCalls).toEqual([expectedKey]);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.key).toBe(expectedKey);
    expect(setCalls[0]?.value).toEqual({ value: 'fresh' });
  });

  test('cache hit short-circuits the fn', async function () {
    const { state } = buildFakeAppState();
    const registry = createQueryRegistry();
    const fnSpy = vi.fn(async function () {
      return { unreachable: true };
    });
    const cache = makeFakeCache({
      async get() {
        return { fromCache: true };
      },
    });
    registry.register({
      queryId: 'Cached.Thing.Get',
      actionId: 'Cached.Thing.Get',
      resource: { type: 'Cached', idFrom: function () { return ''; } },
      cacheKey: function (ctx) { return `Cached:${ctx.tenantId}`; },
      fn: fnSpy,
    });
    const bundle = buildFakeBundle({
      state,
      correlationId: 'corr-hit',
      principalId: PRINCIPAL,
      policyEngine: new StubAllowEngine(),
    });
    bundle.ingress = { ...bundle.ingress, cache };
    installBundle(bundle);

    const app = buildApp(state, registry, function (b) {
      return b.ingress.cache;
    });
    const res = await app.request('/api/v1/queries/Cached.Thing.Get');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fromCache: boolean };
    expect(body.fromCache).toBe(true);
    expect(fnSpy).toHaveBeenCalledTimes(0);
  });
});
