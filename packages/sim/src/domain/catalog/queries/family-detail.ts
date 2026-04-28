import type { ProjectionStorePort } from '../../../ports/projection-store.ts';
import type { FamilyDetailResponse } from '../../../types.ts';
import { projectionKey } from '../projections/family-detail.ts';

export async function queryFamilyDetail(
  tenantId: string,
  familyKey: string,
  projections: ProjectionStorePort,
): Promise<FamilyDetailResponse | null> {
  const v = await projections.get(projectionKey(familyKey, tenantId));
  return (v as FamilyDetailResponse | null) ?? null;
}
