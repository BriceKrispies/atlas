import type { ProjectionStorePort } from '../../../ports/projection-store.ts';
import type { TaxonomyNavigationResponse } from '../../../types.ts';
import { projectionKey } from '../projections/taxonomy-navigation.ts';

export async function queryTaxonomyNodes(
  tenantId: string,
  treeKey: string,
  projections: ProjectionStorePort,
): Promise<TaxonomyNavigationResponse | null> {
  const v = await projections.get(projectionKey(treeKey, tenantId));
  return (v as TaxonomyNavigationResponse | null) ?? null;
}
