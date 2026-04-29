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
} from '@atlas/adapters-node';
import {
  policyEvaluatedEvent,
  shouldEmitPolicyEvaluated,
} from '@atlas/adapters-policy-cedar';
import {
  catalogHandlerRegistry,
  dispatchCatalogEvent,
  type CatalogQueryDeps,
} from '@atlas/modules-catalog';
import {
  PostgresPolicyStore,
  authzHandlerRegistry,
  composeRegistries,
} from '@atlas/modules-authz';
import { wirePolicyCacheInvalidation } from '@atlas/adapters-policy-cedar';
import type {
  IngressState,
  EventDispatcher,
} from '@atlas/ingress';
import type { Principal } from '@atlas/platform-core';
import { ensureTenantMigrated, type AppState } from '../bootstrap.ts';

function newAuditId(): string {
  return `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface RequestBundle {
  ingress: IngressState;
  catalogDeps: CatalogQueryDeps;
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
  const policyStore = new PostgresPolicyStore(state.controlPlaneSql);
  const handlers = composeRegistries(
    catalogHandlerRegistry(),
    authzHandlerRegistry(policyStore),
  );

  // Cedar-engine bundle-cache invalidation for `Tenant:{tenantId}` tags
  // emitted by activate / archive. Wiring is lazy: only wires when the
  // configured engine is the Cedar adapter (the stub engine doesn't
  // cache anything). Plain duck-typed check on `invalidate` keeps the
  // wiring layer unaware of the concrete adapter type.
  const policyEngine = state.policyEngine as unknown as {
    invalidate?: (tenantId: string) => void;
    invalidateAll?: () => void;
  };
  const onPolicyCacheTags =
    typeof policyEngine.invalidate === 'function' &&
    typeof policyEngine.invalidateAll === 'function'
      ? wirePolicyCacheInvalidation(state.policyEngine as Parameters<typeof wirePolicyCacheInvalidation>[0])
      : null;

  const dispatch: EventDispatcher = async (envelope) => {
    await dispatchCatalogEvent(envelope, {
      catalogState,
      projections,
      search,
      cache,
    });
    // Apply policy-bundle cache invalidation AFTER the catalog dispatcher
    // returns so the next evaluate sees the freshly-activated bundle.
    if (onPolicyCacheTags) {
      onPolicyCacheTags(envelope.cacheInvalidationTags);
    }
  };

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

  return { ingress, catalogDeps };
}
