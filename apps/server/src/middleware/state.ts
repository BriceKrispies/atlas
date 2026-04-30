/**
 * Per-request `IngressState` + `CatalogQueryDeps` construction.
 *
 * We rebuild adapters per request because each tenant has its own
 * `postgres.Sql` (resolved through the LRU pool cache in TenantDbProvider).
 * Adapter instances are cheap closures over the Sql connection; this is not
 * a hot path concern. If profiling later flags it, cache them per tenant.
 */

import {
  PostgresEventStore,
  PostgresCache,
  PostgresProjectionStore,
  PostgresSearchEngine,
  PostgresCatalogStateStore,
  PostgresRenderTreeStore,
} from '@atlas/adapter-node';
import {
  policyEvaluatedEvent,
  shouldEmitPolicyEvaluated,
} from '@atlas/adapter-policy-cedar';
import {
  catalogHandlerRegistry,
  catalogDispatcher,
  type CatalogQueryDeps,
} from '@atlas/catalog';
import {
  PostgresPolicyStore,
  authzHandlerRegistry,
  composeRegistries,
} from '@atlas/authz';
import {
  contentPagesHandlerRegistry,
  contentPagesDispatcher,
  type ContentPagesQueryDeps,
} from '@atlas/content-pages';
import { policyCacheDispatcher } from '@atlas/adapter-policy-cedar';
import type { CedarBundleCache } from '@atlas/adapter-policy-cedar';
import type {
  IngressState,
  EventDispatcher,
} from '@atlas/ingress';
import { cacheTagDispatcher, composeDispatchers } from '@atlas/ports';
import type { PolicyEngine } from '@atlas/ports';
import type { Principal } from '@atlas/platform-core';
import { ensureTenantMigrated, type AppState } from '../bootstrap.ts';

function newAuditId(): string {
  return `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Structural type guard — is this engine a Cedar bundle cache (i.e.
 * exposes `invalidate` + `invalidateAll`)? The stub engine doesn't,
 * so the wiring layer skips wiring `wirePolicyCacheInvalidation` for
 * stub-mode deployments.
 */
function isBundleCache(engine: PolicyEngine): engine is PolicyEngine & CedarBundleCache {
  const e = engine as unknown as Partial<CedarBundleCache>;
  return typeof e.invalidate === 'function' && typeof e.invalidateAll === 'function';
}

export interface RequestBundle {
  ingress: IngressState;
  catalogDeps: CatalogQueryDeps;
  contentPagesDeps: ContentPagesQueryDeps;
}

export async function buildRequestBundle(
  state: AppState,
  principal: Principal,
  correlationId: string,
): Promise<RequestBundle> {
  const sql = await ensureTenantMigrated(state, principal.tenantId);

  const eventStore = new PostgresEventStore(sql);
  const cache = new PostgresCache(sql);
  const projections = new PostgresProjectionStore(sql);
  const search = new PostgresSearchEngine(sql);
  const catalogState = new PostgresCatalogStateStore(sql);
  const renderTreeStore = new PostgresRenderTreeStore(sql);
  const policyStore = new PostgresPolicyStore(state.controlPlaneSql);
  const handlers = composeRegistries(
    catalogHandlerRegistry(),
    authzHandlerRegistry(policyStore),
    contentPagesHandlerRegistry(projections),
  );

  // Cedar-engine bundle-cache invalidation for `Tenant:{tenantId}` tags
  // emitted by activate / archive. Wiring is lazy: only the cedar engine
  // exposes the bundle-cache surface (the stub engine doesn't cache
  // anything). The narrow duck-type guard mirrors the `CedarBundleCache`
  // interface that `policyCacheDispatcher` accepts — no `as` cast needed
  // once the guard returns true.
  const policyBundle: CedarBundleCache | null = isBundleCache(state.policyEngine)
    ? state.policyEngine
    : null;

  // Chunk 8 — dispatcher registry. Each module exports a factory that
  // captures its per-request adapters and returns an `EventDispatcher`.
  // `composeDispatchers` chains them in order; `null` entries are skipped
  // so the conditional cedar-bundle invalidation is one inline ternary
  // rather than a wrapping if-statement.
  //
  // Chain order:
  //   1. catalog projection rebuilds
  //   2. content-pages projection rebuilds (with optional WASM host
  //      threaded through for `pluginRef`-driven render trees, Chunk 10)
  //   3. cross-cutting cache-tag invalidation (was hidden inside
  //      dispatchCatalogEvent pre-Chunk 8 — now its own dispatcher so
  //      adding modules cannot accidentally bypass it)
  //   4. policy-bundle cache invalidation (must run AFTER the rest so
  //      the next evaluate sees the freshly-activated bundle)
  //
  // Adding module #4 is one line in this composer, not a function-body
  // edit further down.
  const dispatch: EventDispatcher = composeDispatchers(
    catalogDispatcher({ catalogState, projections, search, cache }),
    contentPagesDispatcher({
      projections,
      renderTreeStore,
      cache,
      ...(state.wasmHost !== undefined ? { wasmHost: state.wasmHost } : {}),
    }),
    cacheTagDispatcher(cache),
    policyBundle ? policyCacheDispatcher(policyBundle) : null,
  );

  const ingress: IngressState = {
    tenantId: principal.tenantId,
    principalId: principal.principalId,
    correlationId,
    eventStore,
    cache,
    projections,
    search,
    registry: state.controlPlaneRegistry,
    catalogState,
    handlers,
    dispatch,
    policyEngine: state.policyEngine,
    // `StructuredAuthz.PolicyEvaluated` audit emit (Chunk 6c). Persists
    // the envelope to the event store, then dispatches it through the
    // existing pipeline. Persistence is critical: the catalog dispatcher
    // is a no-op for non-catalog event types, so a dispatch-only path
    // would silently drop the audit on the floor. Errors here are
    // swallowed by submitIntent so a flaky audit pipeline never turns a
    // clean deny into a 500.
    //
    // The wiring layer (this hook) owns the emit decision — submitIntent
    // calls the hook unconditionally; the hook itself decides whether
    // to emit by consulting `shouldEmitPolicyEvaluated`. This keeps
    // `AUDIT_EMIT_PERMITS` reads in one place.
    auditPolicyEvaluated: async (request, decision, ctx) => {
      if (!shouldEmitPolicyEvaluated(decision, process.env)) return;
      const envelope = policyEvaluatedEvent(request, decision, {
        correlationId: ctx.correlationId,
        idempotencyKey: ctx.idempotencyKey,
        eventId: newAuditId(),
      });
      const stored = await eventStore.append(envelope);
      envelope.eventId = stored;
      await dispatch(envelope);
    },
  };

  // Thread the per-request correlation id into the catalog query deps so
  // any downstream cache writes / log lines / error envelopes can carry it
  // (Invariant I5). The catalog query handlers currently only read
  // projections; propagation here is logging-only today, but reserves the
  // slot for future cache-write / telemetry call sites without another
  // signature change.
  const catalogDeps: CatalogQueryDeps = {
    tenantId: principal.tenantId,
    principalId: principal.principalId,
    correlationId,
    projections,
    search,
  };

  const contentPagesDeps: ContentPagesQueryDeps = {
    tenantId: principal.tenantId,
    principalId: principal.principalId,
    correlationId,
    projections,
    renderTreeStore,
  };

  return { ingress, catalogDeps, contentPagesDeps };
}
