/**
 * apps/sim — browser-side BDD harness.
 *
 * Boots the Atlas ingress closed loop against IndexedDB and exposes:
 *   - `window.__atlas`       — action surface (submitIntent + queries)
 *   - `window.__atlas_debug` — read/probe surface (gated on VITE_BDD)
 *   - `window.__atlas_ready` — true once boot completes
 *   - `window.__atlas_boot_error` — populated if boot throws
 *
 * Mirrors `tests/parity/lib/sim-factory.ts` line-for-line — keep them in
 * sync. The only differences are: (a) policy engine is `RoleAwareStubPolicyEngine`
 * so the I2 BDD scenario can deny by role, (b) surfaces are mounted on
 * `window` instead of returned, (c) tenantId/principalId come from URL
 * params.
 */

import {
  openAtlasIdb,
  IdbEventStore,
  IdbCache,
  IdbProjectionStore,
  IdbSearchEngine,
  InMemoryControlPlaneRegistry,
  IdbCatalogStateStore,
  IdbEntityStore,
  IdbRelationStore,
  type IdbDb,
} from '@atlas/adapter-idb';
// Import browser-safe entrypoints only — the package barrel pulls in
// `worker-host.ts` (Node `worker_threads`) which Vite cannot bundle.
import { BrowserWasmHost } from '@atlas/wasm-host/browser';
import { InMemoryPluginLoader } from '@atlas/wasm-host/loader';
import {
  submitIntent,
  type IngressState,
} from '@atlas/ingress';
import {
  catalogHandlerRegistry,
  catalogDispatcher,
  getTaxonomyNodes,
  getFamilyDetail,
  getVariantTable,
  searchCatalog,
  type CatalogQueryDeps,
  type SearchParams,
} from '@atlas/catalog';
import {
  contentPagesHandlerRegistry,
  contentPagesDispatcher,
  listPages as listContentPagesQuery,
  getPage as getContentPageQuery,
  getRenderTree as getContentPageRenderTreeQuery,
  type ContentPagesQueryDeps,
} from '@atlas/content-pages';
import { composeRegistries } from '@atlas/authz';
import {
  cacheTagDispatcher,
  composeDispatchers,
  type EventDispatcher,
} from '@atlas/ports';
import {
  IngressError,
  type EventEnvelope,
  type IntentEnvelope,
  type IntentResponse,
  type SearchDocument,
} from '@atlas/platform-core';
import { RoleAwareStubPolicyEngine } from './role-aware-stub.ts';
import type {
  AtlasSimAction,
  AtlasSimDebug,
  AtlasSnapshot,
  EventReadFilter,
  IngressFailure,
  SubmitRawResult,
} from './types.ts';

/** Module id used by the Web Worker's cursor key. Single-worker default
 * — see Phase 4 of `specs/worker.md`. */
const SIM_WORKER_MODULE_ID = 'sim';

/** True when the harness is running under BDD. The Web Worker mirrors
 * the server projection-worker; in BDD mode it is the **only** path
 * that updates projections (the inline `composeDispatchers` chain in
 * `state.dispatch` is replaced with a no-op). In dev (sandbox-style),
 * we keep the inline chain so the sim stays synchronous and easy to
 * eyeball. */
const IS_BDD = import.meta.env['VITE_BDD'] === 'true';

interface BootedContext {
  db: IdbDb;
  state: IngressState;
  queryDeps: CatalogQueryDeps;
  contentPagesDeps: ContentPagesQueryDeps;
  projections: IdbProjectionStore;
  search: IdbSearchEngine;
  pluginLoader: InMemoryPluginLoader;
  tenantId: string;
  principalId: string;
  worker: SimWorkerHandle | null;
}

/**
 * Handle to the Web Worker projection mirror. `settle()` round-trips
 * a `'settle'` message and resolves once the worker reports its cursor
 * has caught the event store head. `shutdown()` terminates the Worker
 * (used during reboot / reset).
 */
interface SimWorkerHandle {
  settle(): Promise<{ processed: number; lastSeq: bigint }>;
  shutdown(): Promise<void>;
}

interface WorkerSettledMsg {
  type: 'settled';
  requestId: string;
  processed: number;
  lastSeq: string;
}
interface WorkerReadyMsg {
  type: 'ready';
}
interface WorkerShutdownAckMsg {
  type: 'shutdown-ack';
}
type WorkerInbound = WorkerSettledMsg | WorkerReadyMsg | WorkerShutdownAckMsg;

async function spawnSimWorker(
  tenantId: string,
  moduleId: string,
): Promise<SimWorkerHandle> {
  // Vite spec for Web Workers: `new Worker(new URL('./relative.ts',
  // import.meta.url), { type: 'module' })`. The bundler statically
  // analyzes this exact form and emits a separate chunk.
  const worker = new Worker(new URL('./worker/main.ts', import.meta.url), {
    type: 'module',
  });

  const pendingSettles = new Map<
    string,
    (msg: WorkerSettledMsg) => void
  >();
  let shutdownResolve: (() => void) | null = null;

  worker.addEventListener('message', (e: MessageEvent<WorkerInbound>) => {
    const msg = e.data;
    if (msg.type === 'settled') {
      const resolve = pendingSettles.get(msg.requestId);
      if (resolve) {
        pendingSettles.delete(msg.requestId);
        resolve(msg);
      }
    } else if (msg.type === 'shutdown-ack') {
      const r = shutdownResolve;
      if (r) {
        shutdownResolve = null;
        r();
      }
    }
  });

  // Wait for the worker's `ready` ack before returning. If it never
  // arrives within the timeout, fail fast — the BDD harness would
  // otherwise hang on the first settle().
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('sim worker init timeout (5s)'));
    }, 5_000);
    const onReady = (e: MessageEvent<WorkerInbound>): void => {
      if (e.data.type === 'ready') {
        clearTimeout(timeout);
        worker.removeEventListener('message', onReady);
        resolve();
      }
    };
    worker.addEventListener('message', onReady);
    worker.postMessage({ type: 'init', tenantId, moduleId });
  });

  let settleCounter = 0;
  return {
    settle(): Promise<{ processed: number; lastSeq: bigint }> {
      settleCounter += 1;
      const requestId = `s-${settleCounter}`;
      return new Promise((resolve) => {
        pendingSettles.set(requestId, (msg) => {
          resolve({ processed: msg.processed, lastSeq: BigInt(msg.lastSeq) });
        });
        worker.postMessage({ type: 'settle', requestId });
      });
    },
    async shutdown(): Promise<void> {
      await new Promise<void>((resolve) => {
        shutdownResolve = resolve;
        worker.postMessage({ type: 'shutdown' });
        // Hard cap — if the worker is wedged, terminate after 1s.
        setTimeout(() => {
          if (shutdownResolve === resolve) {
            shutdownResolve = null;
            resolve();
          }
        }, 1_000);
      });
      worker.terminate();
    },
  };
}

/** No-op `EventDispatcher` for BDD mode: writes go to the event store
 *  and the Web Worker drains them out-of-band. */
const noopDispatch: EventDispatcher = async (_event) => {
  // intentionally empty — Web Worker owns the chain in BDD mode
};

async function buildContext(
  tenantId: string,
  principalId: string,
): Promise<BootedContext> {
  const db = await openAtlasIdb(tenantId);

  const eventStore = new IdbEventStore(db);
  const cache = new IdbCache(db);
  const projections = new IdbProjectionStore(db);
  const search = new IdbSearchEngine(db);
  const registry = new InMemoryControlPlaneRegistry();
  const catalogState = new IdbCatalogStateStore(db);
  // L3 substrate — IDB-backed entity + relation stores. One instance
  // shared by the dispatcher chain, the handler registry, and the
  // query deps.
  const entities = new IdbEntityStore(db);
  const relations = new IdbRelationStore(db);
  const handlers = composeRegistries(
    catalogHandlerRegistry(),
    contentPagesHandlerRegistry(entities),
  );
  const policyEngine = new RoleAwareStubPolicyEngine();

  const pluginLoader = new InMemoryPluginLoader();
  const wasmHost = new BrowserWasmHost({ loader: pluginLoader });

  // BDD cut-over (Phase 4 of `specs/worker.md`): in BDD the sim's
  // dispatch is a no-op so projections only update when the Web
  // Worker drains them — exactly mirroring the server's async path.
  // In dev/sandbox mode we keep the inline chain so the surface stays
  // synchronous and easy to eyeball.
  const dispatch = IS_BDD
    ? noopDispatch
    : composeDispatchers(
        catalogDispatcher({ catalogState, projections, search, cache }),
        contentPagesDispatcher({
          entities,
          relations,
          cache,
          wasmHost,
        }),
        cacheTagDispatcher(cache),
      );

  const state: IngressState = {
    tenantId,
    principalId,
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
    tenantId,
    principalId,
    projections,
    search,
  };

  const contentPagesDeps: ContentPagesQueryDeps = {
    tenantId,
    principalId,
    correlationId: 'sim-corr',
    entities,
    relations,
  };

  return {
    db,
    state,
    queryDeps,
    contentPagesDeps,
    projections,
    search,
    pluginLoader,
    tenantId,
    principalId,
    worker: null,
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

function buildActionSurface(ctx: BootedContext): AtlasSimAction {
  return {
    tenantId: ctx.tenantId,
    principalId: ctx.principalId,

    async submitIntent(env: IntentEnvelope): Promise<IntentResponse> {
      return submitIntent(ctx.state, env);
    },

    async submitIntentRaw(env: IntentEnvelope): Promise<SubmitRawResult> {
      try {
        const response = await submitIntent(ctx.state, env);
        return { ok: true, response };
      } catch (e) {
        if (e instanceof IngressError) {
          return { ok: false, failure: failureFromIngressError(e) };
        }
        const message = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          failure: { code: 'TRANSACTION_FAILED', status: 500, message },
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
      return searchCatalog(ctx.queryDeps, params as unknown as SearchParams);
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
  };
}

/**
 * Convert an IDB event row (with `seq: number`) to the canonical
 * `EventEnvelope` shape (with `seq: bigint`). IDB indexes can't accept
 * bigint keys so the underlying store uses `number`; the probe surface
 * exposes the spec-aligned bigint shape to BDD consumers.
 */
function rowToEnvelope(row: { seq: number } & Omit<EventEnvelope, 'seq'>): EventEnvelope {
  return { ...row, seq: BigInt(row.seq) };
}

function matchesFilter(env: { eventType?: string; correlationId?: string; idempotencyKey?: string; tenantId?: string }, filter: EventReadFilter): boolean {
  if (filter.type !== undefined && env.eventType !== filter.type) return false;
  if (filter.correlationId !== undefined && env.correlationId !== filter.correlationId) return false;
  if (filter.idempotencyKey !== undefined && env.idempotencyKey !== filter.idempotencyKey) return false;
  if (filter.tenantId !== undefined && env.tenantId !== filter.tenantId) return false;
  return true;
}

function buildDebugSurface(ctx: BootedContext, reboot: () => Promise<void>): AtlasSimDebug {
  const { db, projections, search, pluginLoader, tenantId } = ctx;
  return {
    async snapshot(): Promise<AtlasSnapshot> {
      const [
        events,
        projectionsAll,
        cacheAll,
        searchAll,
        catalogStateAll,
        entitiesAll,
        relationsAll,
      ] = await Promise.all([
        db.getAll('events'),
        db.getAll('projections'),
        db.getAll('cache'),
        db.getAll('search_documents'),
        db.getAll('catalog_state'),
        db.getAll('entities'),
        db.getAll('relations'),
      ]);
      return {
        events: events.map(rowToEnvelope),
        projections: projectionsAll,
        cache: cacheAll,
        search_documents: searchAll,
        catalog_state: catalogStateAll,
        entities: entitiesAll,
        relations: relationsAll,
      };
    },

    async readEvents(filter = {}) {
      const all = await db.getAll('events');
      return all.filter((e) => matchesFilter(e, filter)).map(rowToEnvelope);
    },

    async readEventById(id) {
      const ev = await db.get('events', id);
      return ev ? rowToEnvelope(ev) : null;
    },

    async readEventTags(id) {
      const ev = await db.get('events', id);
      return ev?.cacheInvalidationTags ?? null;
    },

    async readProjection(key) {
      return projections.get(key);
    },

    async readAllProjections() {
      return db.getAll('projections');
    },

    async readCacheEntry(key) {
      return db.get('cache', key);
    },

    async readAllCache() {
      return db.getAll('cache');
    },

    async readSearchDocs(scopedTenant, type) {
      const idx = db
        .transaction('search_documents', 'readonly')
        .objectStore('search_documents')
        .index(type !== undefined ? 'by_tenant_type' : 'by_tenant_type');
      const lower: [string, string] = [scopedTenant, type ?? ''];
      const upper: [string, string] = [scopedTenant, type ?? '￿'];
      const range = IDBKeyRange.bound(lower, upper);
      const out: SearchDocument[] = [];
      let cursor = await idx.openCursor(range);
      while (cursor) {
        out.push(cursor.value.doc);
        cursor = await cursor.continue();
      }
      return out;
    },


    async readCatalogState(scopedTenant) {
      return db.get('catalog_state', scopedTenant);
    },

    async truncateSearch() {
      const tx = db.transaction('search_documents', 'readwrite');
      const idx = tx.objectStore('search_documents').index('by_tenant_type');
      let cursor = await idx.openCursor(
        IDBKeyRange.bound([tenantId, ''], [tenantId, '￿']),
      );
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }
      await tx.done;
    },

    async indexSearchDocument(doc) {
      await search.index(doc);
    },

    async registerWasmPlugin(pluginRef, bytes) {
      pluginLoader.set(pluginRef, new Uint8Array(bytes));
    },

    worker: {
      async settle() {
        if (!ctx.worker) {
          // No worker spawned — sim's running with the inline chain.
          // Drain is a no-op; report an empty result for symmetry.
          return { processed: 0, lastSeq: 0n };
        }
        return ctx.worker.settle();
      },
    },

    async reset() {
      await reboot();
    },
  };
}

let currentCtx: BootedContext | null = null;

async function boot(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const urlTenant = params.get('tenantId');
  const urlPrincipal = params.get('principalId');
  const tenantId = urlTenant ?? 'sim-default';
  const principalId =
    urlPrincipal ?? `user:test-user:${tenantId}`;

  // If we're rebooting against a possibly-different tenant, terminate
  // the prior Web Worker (so its IDB connection releases) and close the
  // prior db handle first to avoid VersionChange transactions blocking.
  if (currentCtx) {
    if (currentCtx.worker) {
      await currentCtx.worker.shutdown().catch(() => undefined);
    }
    currentCtx.db.close();
    currentCtx = null;
  }

  const ctx = await buildContext(tenantId, principalId);
  currentCtx = ctx;

  // Spawn the projection-worker mirror only in BDD mode — in dev/sandbox
  // mode the inline dispatch chain is still authoritative and a Worker
  // would just race it. See the comment on `IS_BDD` for the rationale.
  if (IS_BDD) {
    ctx.worker = await spawnSimWorker(tenantId, SIM_WORKER_MODULE_ID);
  }

  const action = buildActionSurface(ctx);
  window.__atlas = action;

  if (IS_BDD) {
    window.__atlas_debug = buildDebugSurface(ctx, async () => {
      // Reboot wipes the current tenant's DB and re-builds the context. The
      // public reset() resolves only after __atlas_ready flips back to true.
      const tid = ctx.tenantId;
      if (ctx.worker) {
        await ctx.worker.shutdown().catch(() => undefined);
        ctx.worker = null;
      }
      ctx.db.close();
      currentCtx = null;
      window.__atlas_ready = false;
      await indexedDB.deleteDatabase(`atlas-sim-${tid}`);
      await boot();
    });
  }

  delete window.__atlas_boot_error;
  window.__atlas_ready = true;
  document.dispatchEvent(new CustomEvent('atlas-sim-ready'));
}

boot().catch((e) => {
  const message = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  window.__atlas_boot_error = message;
  // Also surface to the page for human debugging.
  const el = document.getElementById('atlas-sim-root');
  if (el) {
    const pre = document.createElement('pre');
    pre.style.color = 'crimson';
    pre.textContent = `Sim boot failed:\n${message}`;
    el.appendChild(pre);
  }
});
