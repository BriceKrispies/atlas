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
  catalogHandlerRegistry,
  dispatchCatalogEvent,
  type CatalogQueryDeps,
} from '@atlas/modules-catalog';
import type {
  IngressState,
  EventDispatcher,
} from '@atlas/ingress';
import type { Principal } from '@atlas/platform-core';
import { ensureTenantMigrated, type AppState } from '../bootstrap.ts';

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
  const handlers = catalogHandlerRegistry();

  const dispatch: EventDispatcher = (envelope) =>
    dispatchCatalogEvent(envelope, {
      catalogState,
      projections,
      search,
      cache,
    });

  const ingress: IngressState = {
    tenantId: principal.tenantId,
    principalId: principal.principalId,
    eventStore,
    cache,
    projections,
    search,
    registry: state.controlPlaneRegistry,
    catalogState,
    handlers,
    dispatch,
  };

  const catalogDeps: CatalogQueryDeps = {
    tenantId: principal.tenantId,
    principalId: principal.principalId,
    projections,
    search,
  };

  // correlationId is threaded into events via the IntentEnvelope (it
  // overrides anything stale on the envelope). Capture here for completeness
  // even though IngressState doesn't expose it directly.
  void correlationId;

  return { ingress, catalogDeps };
}
