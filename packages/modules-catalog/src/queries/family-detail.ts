import type { ProjectionStore } from '@atlas/ports';
import type { FamilyDetailResponse } from '@atlas/platform-core';
import { projectionKey } from '../projections/family-detail.ts';

export async function queryFamilyDetail(
  tenantId: string,
  familyKey: string,
  projections: ProjectionStore,
): Promise<FamilyDetailResponse | null> {
  const v = await projections.get(projectionKey(familyKey, tenantId));
  return (v as FamilyDetailResponse | null) ?? null;
}
