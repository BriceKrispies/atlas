import type {
  TaxonomyNavigationResponse,
  FamilyDetailResponse,
  VariantTableParams,
  VariantTableResponse,
  SearchParams,
  SearchResponse,
} from './responses.ts';
import type { ProjectionStore, SearchEngine } from '@atlas/ports';
import { queryTaxonomyNodes } from './queries/taxonomy-nodes.ts';
import { queryFamilyDetail } from './queries/family-detail.ts';
import { queryVariantTable } from './queries/variant-table.ts';
import { handleSearch } from './queries/search.ts';

export interface CatalogQueryDeps {
  tenantId: string;
  principalId: string;
  /**
   * Per-request correlation id (Invariant I5). Optional so existing
   * fixtures that construct deps once continue to compile; route handlers
   * should populate it so any downstream cache writes / log lines carry
   * the request-scoped id.
   */
  correlationId?: string;
  projections: ProjectionStore;
  search: SearchEngine;
}

export async function getTaxonomyNodes(
  deps: CatalogQueryDeps,
  treeKey: string,
): Promise<TaxonomyNavigationResponse | null> {
  return queryTaxonomyNodes(deps.tenantId, treeKey, deps.projections);
}

export async function getFamilyDetail(
  deps: CatalogQueryDeps,
  familyKey: string,
): Promise<FamilyDetailResponse | null> {
  return queryFamilyDetail(deps.tenantId, familyKey, deps.projections);
}

export async function getVariantTable(
  deps: CatalogQueryDeps,
  familyKey: string,
  params: VariantTableParams,
): Promise<VariantTableResponse | null> {
  return queryVariantTable(deps.tenantId, familyKey, params, deps.projections);
}

export async function searchCatalog(
  deps: CatalogQueryDeps,
  params: SearchParams,
): Promise<SearchResponse> {
  return handleSearch(deps.tenantId, deps.principalId, params, deps.search);
}
