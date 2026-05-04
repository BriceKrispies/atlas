// Window augmentation for the BDD harness surfaces. Imports here are
// type-only so the .d.ts can be picked up by tsc without bundling.
import type {
  EventEnvelope,
  IntentEnvelope,
  IntentResponse,
  SearchDocument,
} from '@atlas/platform-core';

export interface IngressFailure {
  code: string;
  status: number;
  message: string;
  correlationId?: string;
}

export type SubmitRawResult =
  | { ok: true; response: IntentResponse }
  | { ok: false; failure: IngressFailure };

export interface AtlasSimAction {
  tenantId: string;
  principalId: string;
  submitIntent(env: IntentEnvelope): Promise<IntentResponse>;
  submitIntentRaw(env: IntentEnvelope): Promise<SubmitRawResult>;
  getTaxonomyNodes(treeKey: string): Promise<unknown>;
  getFamilyDetail(familyKey: string): Promise<unknown>;
  getVariantTable(
    familyKey: string,
    params?: Record<string, unknown>,
  ): Promise<unknown>;
  searchCatalog(params: Record<string, unknown>): Promise<unknown>;
  listContentPages(): Promise<unknown>;
  getContentPage(pageId: string): Promise<unknown>;
  getContentPageRenderTree(pageId: string): Promise<unknown>;
}

export interface EventReadFilter {
  type?: string;
  correlationId?: string;
  idempotencyKey?: string;
  tenantId?: string;
}

export interface AtlasSnapshot {
  events: EventEnvelope[];
  projections: unknown[];
  cache: unknown[];
  search_documents: unknown[];
  catalog_state: unknown[];
  entities: unknown[];
  relations: unknown[];
}

/** Probe handle to the Web Worker projection mirror — see Phase 4 of
 *  `specs/worker.md`. `settle()` returns once the worker's cursor has
 *  caught the head of the event store for the current tenant. The BDD
 *  fixture auto-calls this after every `submitIntent` so step files
 *  don't need to settle manually. */
export interface AtlasSimDebugWorker {
  settle(): Promise<{ processed: number; lastSeq: bigint }>;
}

export interface AtlasSimDebug {
  snapshot(): Promise<AtlasSnapshot>;
  readEvents(filter?: EventReadFilter): Promise<EventEnvelope[]>;
  readEventById(id: string): Promise<EventEnvelope | null>;
  readEventTags(id: string): Promise<string[] | null>;
  readProjection(key: string): Promise<unknown>;
  readAllProjections(): Promise<unknown[]>;
  readCacheEntry(key: string): Promise<unknown>;
  readAllCache(): Promise<unknown[]>;
  readSearchDocs(tenantId: string, type?: string): Promise<SearchDocument[]>;
  readCatalogState(tenantId: string): Promise<unknown>;
  truncateSearch(): Promise<void>;
  indexSearchDocument(doc: SearchDocument): Promise<void>;
  registerWasmPlugin(pluginRef: string, bytes: number[]): Promise<void>;
  worker: AtlasSimDebugWorker;
  reset(): Promise<void>;
}

declare global {
  interface Window {
    __atlas?: AtlasSimAction;
    __atlas_debug?: AtlasSimDebug;
    __atlas_ready?: boolean;
    __atlas_boot_error?: string;
  }
}

export {};
