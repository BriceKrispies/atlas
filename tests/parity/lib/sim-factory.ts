import {
  openAtlasIdb,
  IdbEventStore,
  IdbCache,
  IdbProjectionStore,
  IdbSearchEngine,
  InMemoryControlPlaneRegistry,
  IdbCatalogStateStore,
  IdbRenderTreeStore,
  type IdbDb,
} from '@atlas/adapter-idb';
import { StubPolicyEngine } from '@atlas/adapter-policy-stub';
import {
  BrowserWasmHost,
  InMemoryPluginLoader,
} from '@atlas/wasm-host';
import type { WasmHost } from '@atlas/ports';
import {
  submitIntent,
  type IngressState,
  type EventDispatcher,
} from '@atlas/ingress';
import {
  catalogHandlerRegistry,
  catalogDispatcher,
  getTaxonomyNodes,
  getFamilyDetail,
  getVariantTable,
  searchCatalog,
  type CatalogQueryDeps,
} from '@atlas/catalog';
import {
  contentPagesHandlerRegistry,
  contentPagesDispatcher,
  listPages as listContentPagesQuery,
  getPage as getContentPageQuery,
  getRenderTree as getContentPageRenderTreeQuery,
  renderTreeKey as contentRenderTreeKey,
  type ContentPagesQueryDeps,
} from '@atlas/content-pages';
import { composeRegistries } from '@atlas/authz';
import { cacheTagDispatcher, composeDispatchers } from '@atlas/ports';
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
  contentPagesDeps: ContentPagesQueryDeps;
  projections: IdbProjectionStore;
  search: IdbSearchEngine;
  registry: InMemoryControlPlaneRegistry;
  wasmHost: WasmHost;
  pluginLoader: InMemoryPluginLoader;
}

async function buildContext(opts: FactoryOptions): Promise<SimContext> {
  const db = await openAtlasIdb(opts.tenantId);

  const eventStore = new IdbEventStore(db);
  const cache = new IdbCache(db);
  const projections = new IdbProjectionStore(db);
  const search = new IdbSearchEngine(db);
  const registry = new InMemoryControlPlaneRegistry();
  const catalogState = new IdbCatalogStateStore(db);
  const renderTreeStore = new IdbRenderTreeStore(db);
  const handlers = composeRegistries(
    catalogHandlerRegistry(),
    contentPagesHandlerRegistry(projections),
  );
  const policyEngine = new StubPolicyEngine();

  // Per-sim WASM host. Plugin bytes are seeded by tests via the
  // `pluginLoader` reference below — leaving it empty by default so
  // pages without `pluginRef` keep using the default render tree.
  const pluginLoader = new InMemoryPluginLoader();
  const wasmHost: WasmHost = new BrowserWasmHost({ loader: pluginLoader });

  // Chunk 8 — dispatcher registry. Sim mirrors the apps/server chain
  // structure (minus the policy-bundle dispatcher — sim runs the stub
  // engine which has no cache to flush). Cross-cutting cache-tag
  // invalidation is now its own dispatcher rather than piggy-backing
  // on the catalog one. The WASM host (Chunk 10) threads through the
  // content-pages dispatcher for `pluginRef`-driven render trees.
  const dispatch: EventDispatcher = composeDispatchers(
    catalogDispatcher({ catalogState, projections, search, cache }),
    contentPagesDispatcher({
      projections,
      renderTreeStore,
      cache,
      wasmHost,
    }),
    cacheTagDispatcher(cache),
  );

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

  const contentPagesDeps: ContentPagesQueryDeps = {
    tenantId: opts.tenantId,
    principalId: opts.principalId,
    correlationId: 'sim-corr',
    projections,
    renderTreeStore,
  };

  return {
    db,
    state,
    queryDeps,
    contentPagesDeps,
    projections,
    search,
    registry,
    wasmHost,
    pluginLoader,
  };
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

    listContentPages() {
      return listContentPagesQuery(ctx.contentPagesDeps);
    },
    getContentPage(pageId) {
      return getContentPageQuery(ctx.contentPagesDeps, pageId);
    },
    getContentPageRenderTree(pageId) {
      return getContentPageRenderTreeQuery(ctx.contentPagesDeps, pageId);
    },
    async clearRenderTreeFastPath(pageId: string): Promise<void> {
      await ctx.projections.delete(
        contentRenderTreeKey(opts.tenantId, pageId),
      );
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

    async registerWasmPlugin(pluginRef: string, bytes: Uint8Array): Promise<void> {
      ctx.pluginLoader.set(pluginRef, bytes);
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
