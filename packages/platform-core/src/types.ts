export interface EventEnvelope {
  eventId: string;
  eventType: string;
  schemaId: string;
  schemaVersion: number;
  occurredAt: string;
  tenantId: string;
  correlationId: string;
  idempotencyKey: string;
  causationId?: string | null;
  principalId?: string | null;
  userId?: string | null;
  cacheInvalidationTags?: string[] | null;
  payload: unknown;
}

export interface IntentEnvelope {
  eventId?: string;
  eventType: string;
  schemaId: string;
  schemaVersion: number;
  occurredAt?: string;
  tenantId: string;
  correlationId: string;
  idempotencyKey: string;
  causationId?: string | null;
  principalId?: string | null;
  userId?: string | null;
  payload: IntentPayload;
}

export interface IntentPayload {
  actionId: string;
  resourceType: string;
  resourceId?: string | null;
  [k: string]: unknown;
}

export interface IntentResponse {
  eventId: string;
  tenantId: string;
  principalId: string | null;
}

export interface Principal {
  principalId: string;
  tenantId: string;
}

export interface SearchDocument {
  documentId: string;
  documentType: string;
  tenantId: string;
  fields: Record<string, unknown>;
  permissionAttributes?: { allowedPrincipals: string[] } | null;
}

export interface CacheSetOptions {
  ttlSeconds: number;
  tags: ReadonlyArray<string>;
}

export interface VariantTableParams {
  filters?: Record<string, FilterValue>;
  sort?: string;
  pageSize?: number;
}

export type FilterValue =
  | { kind: 'equals'; value: string }
  | { kind: 'range'; gte?: number; lte?: number };

export interface SearchParams {
  q: string;
  type?: string;
  pageSize?: number;
  cursor?: string;
}

export interface SearchResult {
  documentType: string;
  documentId: string;
  title: string;
  summary: string | null;
  taxonomyPath: string | null;
  score: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

export interface TaxonomyNavigationResponse {
  treeId: string;
  treeKey: string;
  name: string;
  purpose: string;
  nodes: Array<{
    nodeId: string;
    key: string;
    path: string;
    name: string;
    parentId: string | null;
    families: Array<{
      familyId: string;
      familyKey: string;
      name: string;
      canonicalSlug: string;
    }>;
  }>;
}

export interface FamilyDetailResponse {
  familyId: string;
  familyKey: string;
  type: string;
  name: string;
  canonicalSlug: string;
  currentRevision: number;
  publishedRevision: number | null;
  attributes: Array<Record<string, unknown>>;
  displayPolicies: Array<Record<string, unknown>>;
  assets: Array<Record<string, unknown>>;
}

export interface VariantTableResponse {
  familyId: string;
  familyKey: string;
  rows: Array<Record<string, unknown>>;
  facets: Record<string, Array<{ value: string; count: number }>>;
  rowCount?: number;
}
