import type { ProjectionStore } from '@atlas/ports';
import type { FamilyDetailResponse } from '../responses.ts';
import { projectionKey } from '../projections/family-detail.ts';
import { readProjection } from '../internal/projection-read.ts';

export async function queryFamilyDetail(
  tenantId: string,
  familyKey: string,
  projections: ProjectionStore,
): Promise<FamilyDetailResponse | null> {
  const v = await projections.get(projectionKey(familyKey, tenantId));
  return readProjection<FamilyDetailResponse>(v);
}
