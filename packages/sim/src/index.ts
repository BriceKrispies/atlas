import { openSimDb } from './ports/db.ts';
import { EventStorePort } from './ports/event-store.ts';
import { CachePort } from './ports/cache.ts';
import { ProjectionStorePort } from './ports/projection-store.ts';
import { SearchEnginePort } from './ports/search-engine.ts';
import { ControlPlaneRegistryPort } from './ports/control-plane-registry.ts';
import { submitIntent, type IngressState } from './ingress/submit-intent.ts';
import * as router from './ingress/query-router.ts';
import { installFetchInterceptor } from './ingress/fetch-interceptor.ts';
import type {
  IntentEnvelope,
  IntentResponse,
  TaxonomyNavigationResponse,
  FamilyDetailResponse,
  VariantTableParams,
  VariantTableResponse,
  SearchParams,
  SearchResponse,
} from './types.ts';

export type {
  IntentEnvelope,
  IntentResponse,
  IntentPayload,
  EventEnvelope,
  TaxonomyNavigationResponse,
  FamilyDetailResponse,
  VariantTableParams,
  VariantTableResponse,
  SearchParams,
  SearchResponse,
  SearchResult,
  SearchDocument,
  FilterValue,
  CacheSetOptions,
} from './types.ts';
export { IngressError } from './types.ts';

export interface CreateBrowserIngressOptions {
  tenantId: string;
  principalId: string;
  indexedDB?: IDBFactory;
}

export interface BrowserIngress {
  submitIntent(envelope: IntentEnvelope): Promise<IntentResponse>;
  getTaxonomyNodes(treeKey: string): Promise<TaxonomyNavigationResponse | null>;
  getFamilyDetail(familyKey: string): Promise<FamilyDetailResponse | null>;
  getVariantTable(
    familyKey: string,
    params?: VariantTableParams,
  ): Promise<VariantTableResponse | null>;
  searchCatalog(params: SearchParams): Promise<SearchResponse>;
  close(): Promise<void>;
}

export async function createBrowserIngress(
  opts: CreateBrowserIngressOptions,
): Promise<BrowserIngress> {
  // The opts.indexedDB factory is currently advisory; idb's openDB uses the
  // global indexedDB. Tests install fake-indexeddb/auto to replace it.
  const db = await openSimDb(opts.tenantId);

  const eventStore = new EventStorePort(db);
  const cache = new CachePort(db);
  const projections = new ProjectionStorePort(db);
  const search = new SearchEnginePort(db);
  const registry = new ControlPlaneRegistryPort();

  const state: IngressState = {
    db,
    tenantId: opts.tenantId,
    principalId: opts.principalId,
    eventStore,
    cache,
    projections,
    search,
    registry,
  };

  const ingress: BrowserIngress & {
    __db: typeof db;
    __search: SearchEnginePort;
    __cache: CachePort;
    __projections: ProjectionStorePort;
    __eventStore: EventStorePort;
  } = {
    __db: db,
    __search: search,
    __cache: cache,
    __projections: projections,
    __eventStore: eventStore,
    async submitIntent(envelope: IntentEnvelope): Promise<IntentResponse> {
      return submitIntent(state, envelope);
    },
    async getTaxonomyNodes(treeKey: string) {
      return router.getTaxonomyNodes(state, treeKey);
    },
    async getFamilyDetail(familyKey: string) {
      return router.getFamilyDetail(state, familyKey);
    },
    async getVariantTable(familyKey: string, params?: VariantTableParams) {
      return router.getVariantTable(state, familyKey, params ?? {});
    },
    async searchCatalog(params: SearchParams) {
      return router.searchCatalog(state, params);
    },
    async close() {
      db.close();
    },
  };
  return ingress;
}

export function installBrowserBackend(opts: CreateBrowserIngressOptions): () => void {
  let uninstall: (() => void) | null = null;
  void createBrowserIngress(opts).then((ingress) => {
    uninstall = installFetchInterceptor({ ingress });
  });
  return () => {
    if (uninstall) uninstall();
  };
}
