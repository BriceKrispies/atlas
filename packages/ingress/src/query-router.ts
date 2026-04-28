import type {
  TaxonomyNavigationResponse,
  FamilyDetailResponse,
  VariantTableParams,
  VariantTableResponse,
  SearchParams,
  SearchResponse,
} from '@atlas/platform-core';
import {
  queryTaxonomyNodes,
  queryFamilyDetail,
  queryVariantTable,
  handleSearch,
} from '@atlas/modules-catalog';
import type { IngressState } from './submit-intent.ts';

export async function getTaxonomyNodes(
  state: IngressState,
  treeKey: string,
): Promise<TaxonomyNavigationResponse | null> {
  return queryTaxonomyNodes(state.tenantId, treeKey, state.projections);
}

export async function getFamilyDetail(
  state: IngressState,
  familyKey: string,
): Promise<FamilyDetailResponse | null> {
  return queryFamilyDetail(state.tenantId, familyKey, state.projections);
}

export async function getVariantTable(
  state: IngressState,
  familyKey: string,
  params: VariantTableParams,
): Promise<VariantTableResponse | null> {
  return queryVariantTable(state.tenantId, familyKey, params, state.projections);
}

export async function searchCatalog(
  state: IngressState,
  params: SearchParams,
): Promise<SearchResponse> {
  return handleSearch(state.tenantId, state.principalId, params, state.search);
}
