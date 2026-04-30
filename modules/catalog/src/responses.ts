// Catalog-specific query response types. These used to live in
// @atlas/platform-core but they're domain-shaped; only catalog code reads
// or writes them.

export interface VariantRow {
  variantId: string;
  variantKey: string;
  name: string;
  revision: number;
  values: Record<string, { raw: unknown; normalized: unknown; display: string | null }>;
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
  rows: VariantRow[];
  facets: Record<string, Array<{ value: string; count: number }>>;
  rowCount?: number;
}
