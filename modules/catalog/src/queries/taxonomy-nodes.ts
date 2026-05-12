import type { ProjectionStore } from '@atlas/ports';
import type { TaxonomyNavigationResponse } from '../responses.ts';
import { projectionKey } from '../projections/taxonomy-navigation.ts';
import { readProjection } from '../internal/projection-read.ts';

export async function queryTaxonomyNodes(
  tenantId: string,
  treeKey: string,
  projections: ProjectionStore,
): Promise<TaxonomyNavigationResponse | null> {
  const v = await projections.get(projectionKey(treeKey, tenantId));
  return readProjection<TaxonomyNavigationResponse>(v);
}
