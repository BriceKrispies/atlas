/**
 * Projection-worker bootstrap. Builds long-lived state: control-plane
 * Postgres pool, tenant DB provider, adapter factories the tenant loop
 * uses to instantiate per-tenant adapters on demand.
 *
 * Adapter wiring mirrors `apps/server/src/bootstrap.ts` for the slice
 * the worker uses (event store + projection store + cache + render-tree
 * + WorkerSource). The worker does NOT need the policy engine, ingress,
 * or HTTP machinery.
 */

import postgres from 'postgres';
import {
  PostgresEventStore,
  PostgresEntityStore,
  PostgresRelationStore,
  PostgresProjectionStore,
  PostgresCache,
  PostgresWorkerSource,
  PostgresCatalogStateStore,
  PostgresSearchEngine,
  PostgresTenantDbProvider,
} from '@atlas/adapter-node';
import type {
  EventStore,
  EntityStore,
  ProjectionStore,
  Cache,
  RelationStore,
  WorkerSource,
  CatalogStateStore,
  SearchEngine,
} from '@atlas/ports';
import type { WorkerConfig } from './config.ts';

export interface PerTenantAdapters {
  tenantId: string;
  eventStore: EventStore;
  entities: EntityStore;
  relations: RelationStore;
  projections: ProjectionStore;
  cache: Cache;
  workerSource: WorkerSource;
  catalogState: CatalogStateStore;
  search: SearchEngine;
}

export interface WorkerAppState {
  config: WorkerConfig;
  controlPlaneSql: postgres.Sql;
  tenantDb: PostgresTenantDbProvider;
  /**
   * Build the adapter set for one tenant. Caller is responsible for
   * managing lifetime — typically one set per active subscription.
   */
  adaptersForTenant(tenantId: string): Promise<PerTenantAdapters>;
}

export async function bootstrap(config: WorkerConfig): Promise<WorkerAppState> {
  const controlPlaneSql = postgres(config.controlPlaneDbUrl, {
    // Worker is long-running — let the pool size itself.
    max: 10,
  });

  const tenantDb = new PostgresTenantDbProvider(controlPlaneSql);

  return {
    config,
    controlPlaneSql,
    tenantDb,
    async adaptersForTenant(tenantId: string): Promise<PerTenantAdapters> {
      const sql = await tenantDb.getPool(tenantId);
      return {
        tenantId,
        eventStore: new PostgresEventStore(sql),
        entities: new PostgresEntityStore(sql),
        relations: new PostgresRelationStore(sql),
        projections: new PostgresProjectionStore(sql),
        cache: new PostgresCache(sql),
        workerSource: new PostgresWorkerSource(sql, config.moduleId),
        catalogState: new PostgresCatalogStateStore(sql),
        search: new PostgresSearchEngine(sql),
      };
    },
  };
}

export async function shutdown(state: WorkerAppState): Promise<void> {
  await state.controlPlaneSql.end({ timeout: 5 });
  // TenantDbProvider closes its own pools through its own lifecycle.
}
