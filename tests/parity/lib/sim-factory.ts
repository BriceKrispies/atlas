import {
  openAtlasIdb,
  IdbEventStore,
  IdbCache,
  IdbProjectionStore,
  IdbSearchEngine,
  InMemoryControlPlaneRegistry,
  IdbCatalogStateStore,
  type IdbDb,
} from '@atlas/adapters-idb';
import { StubPolicyEngine } from '@atlas/adapters-policy-stub';
import {
  submitIntent,
  type IngressState,
  type EventDispatcher,
} from '@atlas/ingress';
import {
  catalogHandlerRegistry,
  dispatchCatalogEvent,
  getTaxonomyNodes,
  getFamilyDetail,
  getVariantTable,
  searchCatalog,
  type CatalogQueryDeps,
} from '@atlas/modules-catalog';
import {
  IngressError,
  type IntentEnvelope,
  type IntentResponse,
  type SearchDocument,
} from '@atlas/platform-core';
import {
  IngressFailureError,
  type BrowserIngress,
  type FactoryOptions,
  type HealthResponse,
  type IngressFailure,
} from './factory.ts';

interface SimContext {
  db: IdbDb;
  state: IngressState;
  queryDeps: CatalogQueryDeps;
  search: IdbSearchEngine;
  registry: InMemoryControlPlaneRegistry;
}

async function buildContext(opts: FactoryOptions): Promise<SimContext> {
  const db = await openAtlasIdb(opts.tenantId);

  const eventStore = new IdbEventStore(db);
  const cache = new IdbCache(db);
  const projections = new IdbProjectionStore(db);
  const search = new IdbSearchEngine(db);
  const registry = new InMemoryControlPlaneRegistry();
  const catalogState = new IdbCatalogStateStore(db);
  const handlers = catalogHandlerRegistry();
  const policyEngine = new StubPolicyEngine();

  const dispatch: EventDispatcher = (envelope) =>
    dispatchCatalogEvent(envelope, { catalogState, projections, search, cache });

  const state: IngressState = {
    tenantId: opts.tenantId,
    principalId: opts.principalId,
    eventStore,
    cache,
    projections,
    search,
    registry,
    catalogState,
    handlers,
    dispatch,
    policyEngine,
  };

  const queryDeps: CatalogQueryDeps = {
    tenantId: opts.tenantId,
    principalId: opts.principalId,
    projections,
    search,
  };

  return { db, state, queryDeps, search, registry };
}

function failureFromIngressError(e: IngressError): IngressFailure {
  const failure: IngressFailure = {
    code: e.code,
    status: e.status,
    message: e.message,
  };
  if (e.correlationId) failure.correlationId = e.correlationId;
  return failure;
}

export async function createSimIngress(opts: FactoryOptions): Promise<BrowserIngress> {
  const ctx = await buildContext(opts);

  const ingress: BrowserIngress = {
    mode: 'sim',
    tenantId: opts.tenantId,
    principalId: opts.principalId,

    async submitIntent(envelope: IntentEnvelope): Promise<IntentResponse> {
      try {
        return await submitIntent(ctx.state, envelope);
      } catch (e) {
        if (e instanceof IngressError) {
          throw new IngressFailureError(failureFromIngressError(e));
        }
        throw e;
      }
    },

    async submitIntentRaw(envelope) {
      try {
        const response = await submitIntent(ctx.state, envelope);
        return { ok: true, response };
      } catch (e) {
        if (e instanceof IngressError) {
          return { ok: false, failure: failureFromIngressError(e) };
        }
        if (e instanceof Error) {
          return {
            ok: false,
            failure: { code: 'TRANSACTION_FAILED', status: 500, message: e.message },
          };
        }
        return {
          ok: false,
          failure: { code: 'TRANSACTION_FAILED', status: 500, message: String(e) },
        };
      }
    },

    getTaxonomyNodes(treeKey) {
      return getTaxonomyNodes(ctx.queryDeps, treeKey);
    },
    getFamilyDetail(familyKey) {
      return getFamilyDetail(ctx.queryDeps, familyKey);
    },
    getVariantTable(familyKey, params) {
      return getVariantTable(ctx.queryDeps, familyKey, params ?? {});
    },
    searchCatalog(params) {
      return searchCatalog(ctx.queryDeps, params);
    },

    async readEventTags(eventId) {
      const ev = await ctx.db.get('events', eventId);
      return ev?.cacheInvalidationTags ?? null;
    },

    async truncateSearch() {
      const tx = ctx.db.transaction('search_documents', 'readwrite');
      const idx = tx.objectStore('search_documents').index('by_tenant_type');
      let cursor = await idx.openCursor(
        IDBKeyRange.bound([opts.tenantId, ''], [opts.tenantId, '￿']),
      );
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;
    },

    async indexSearchDocument(doc: SearchDocument): Promise<void> {
      await ctx.search.index(doc);
    },

    async health(): Promise<{ status: number; body: HealthResponse }> {
      return { status: 200, body: { status: 'ok' } };
    },

    async ready(): Promise<{ status: number; body: HealthResponse }> {
      const ok = ctx.registry.hasAction('Catalog.SeedPackage.Apply');
      const body: HealthResponse = ok
        ? { status: 'ok', checks: { registry: 'ok' } }
        : { status: 'unavailable', checks: { registry: 'no actions loaded' } };
      return { status: ok ? 200 : 503, body };
    },

    async whoami() {
      // Sim has no HTTP / no JWT verification path; nothing to probe. Tests
      // that exercise auth headers must run only in node mode.
      return null;
    },

    async close() {
      ctx.db.close();
    },
  };

  return ingress;
}

let dbCounter = 0;

export function uniqueTenantId(prefix: string): string {
  dbCounter++;
  return `${prefix}-${dbCounter}-${Date.now().toString(36)}`;
}

/**
 * Convenience wrapper that mints a unique tenant id + principal and returns
 * the resulting ingress alongside the ids. Mirrors the catalog-sim helper.
 */
export async function makeSimIngress(prefix: string): Promise<{
  ingress: BrowserIngress;
  tenantId: string;
  principalId: string;
}> {
  const tenantId = uniqueTenantId(prefix);
  const principalId = `user:test-user:${tenantId}`;
  const ingress = await createSimIngress({ tenantId, principalId });
  return { ingress, tenantId, principalId };
}
