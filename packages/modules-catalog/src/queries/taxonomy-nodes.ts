import type { ProjectionStore } from '@atlas/ports';
import type { TaxonomyNavigationResponse } from '@atlas/platform-core';
import { projectionKey } from '../projections/taxonomy-navigation.ts';

export async function queryTaxonomyNodes(
  tenantId: string,
  treeKey: string,
  projections: ProjectionStore,
): Promise<TaxonomyNavigationResponse | null> {
  const v = await projections.get(projectionKey(treeKey, tenantId));
  return (v as TaxonomyNavigationResponse | null) ?? null;
}
