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
  type TaxonomyNavigationResponse,
  type FamilyDetailResponse,
  type VariantTableParams,
  type VariantTableResponse,
  type SearchParams,
  type SearchResponse,
} from '@atlas/modules-catalog';
import type { IntentEnvelope, IntentResponse } from '@atlas/platform-core';

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
  const handlers = catalogHandlerRegistry();

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
  };

  const queryDeps: CatalogQueryDeps = {
    tenantId: opts.tenantId,
    principalId: opts.principalId,
    projections,
    search,
  };

  return {
    __db: db,
    __search: search,
    async submitIntent(envelope) {
      return submitIntent(state, envelope);
    },
    async getTaxonomyNodes(treeKey) {
      return getTaxonomyNodes(queryDeps, treeKey);
    },
    async getFamilyDetail(familyKey) {
      return getFamilyDetail(queryDeps, familyKey);
    },
    async getVariantTable(familyKey, params) {
      return getVariantTable(queryDeps, familyKey, params ?? {});
    },
    async searchCatalog(params) {
      return searchCatalog(queryDeps, params);
    },
    async close() {
      db.close();
    },
  };
}
