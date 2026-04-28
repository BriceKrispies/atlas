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
import {
  submitIntent,
  getTaxonomyNodes,
  getFamilyDetail,
  getVariantTable,
  searchCatalog,
  type IngressState,
} from '@atlas/ingress';
import type {
  IntentEnvelope,
  IntentResponse,
  TaxonomyNavigationResponse,
  FamilyDetailResponse,
  VariantTableParams,
  VariantTableResponse,
  SearchParams,
  SearchResponse,
} from '@atlas/platform-core';

export interface CreateSimIngressOptions {
  tenantId: string;
  principalId: string;
}

export interface SimIngress {
  submitIntent(envelope: IntentEnvelope): Promise<IntentResponse>;
  getTaxonomyNodes(treeKey: string): Promise<TaxonomyNavigationResponse | null>;
  getFamilyDetail(familyKey: string): Promise<FamilyDetailResponse | null>;
  getVariantTable(
    familyKey: string,
    params?: VariantTableParams,
  ): Promise<VariantTableResponse | null>;
  searchCatalog(params: SearchParams): Promise<SearchResponse>;
  close(): Promise<void>;
  __db: IdbDb;
  __search: IdbSearchEngine;
}

export async function createSimIngress(opts: CreateSimIngressOptions): Promise<SimIngress> {
  const db = await openAtlasIdb(opts.tenantId);

  const eventStore = new IdbEventStore(db);
  const cache = new IdbCache(db);
  const projections = new IdbProjectionStore(db);
  const search = new IdbSearchEngine(db);
  const registry = new InMemoryControlPlaneRegistry();
  const catalogState = new IdbCatalogStateStore(db);

  const state: IngressState = {
    tenantId: opts.tenantId,
    principalId: opts.principalId,
    eventStore,
    cache,
    projections,
    search,
    registry,
    catalogState,
  };

  return {
    __db: db,
    __search: search,
    async submitIntent(envelope) {
      return submitIntent(state, envelope);
    },
    async getTaxonomyNodes(treeKey) {
      return getTaxonomyNodes(state, treeKey);
    },
    async getFamilyDetail(familyKey) {
      return getFamilyDetail(state, familyKey);
    },
    async getVariantTable(familyKey, params) {
      return getVariantTable(state, familyKey, params ?? {});
    },
    async searchCatalog(params) {
      return searchCatalog(state, params);
    },
    async close() {
      db.close();
    },
  };
}
