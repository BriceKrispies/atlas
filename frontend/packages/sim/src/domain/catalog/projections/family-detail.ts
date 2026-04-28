import type { Db } from '../../../ports/db.ts';
import type { ProjectionStorePort } from '../../../ports/projection-store.ts';
import type { SeedPayload } from '../seed-types.ts';
import { deterministicUuid } from '../ids.ts';

export function projectionKey(familyKey: string, tenantId: string): string {
  return `catalog:family-detail:${familyKey}:${tenantId}`;
}

export async function rebuildFamilyDetail(
  tenantId: string,
  db: Db,
  projections: ProjectionStorePort,
): Promise<Array<{ familyKey: string; payload: unknown }>> {
  const state = await db.get('catalog_state', tenantId);
  if (!state) return [];
  const seed = state.payload as SeedPayload;
  const attrTypeByKey = new Map<string, string>();
  for (const a of seed.attributeDefinitions ?? []) {
    attrTypeByKey.set(a.key, a.dataType);
  }
  const publishedRevisions = state.publishedRevisions;

  const out: Array<{ familyKey: string; payload: unknown }> = [];
  for (const fam of seed.families) {
    const familyId = deterministicUuid('family', tenantId, fam.key);
    const sortedAttrs = [...fam.attributes].sort((a, b) => a.displayOrder - b.displayOrder);
    const attributes = sortedAttrs.map((fa) => ({
      attributeKey: fa.attributeKey,
      dataType: attrTypeByKey.get(fa.attributeKey) ?? 'string',
      role: fa.role,
      required: fa.required ?? false,
      filterable: fa.filterable ?? false,
      sortable: fa.sortable ?? false,
      isVariantAxis: fa.isVariantAxis ?? false,
      displayOrder: fa.displayOrder,
    }));
    const dps = (fam.displayPolicies ?? [])
      .slice()
      .sort((a, b) => a.surface.localeCompare(b.surface) || a.order - b.order)
      .map((dp) => ({
        surface: dp.surface,
        attributeKey: dp.attributeKey,
        role: dp.role,
        order: dp.order,
      }));

    const payload = {
      familyId,
      familyKey: fam.key,
      type: fam.type,
      name: fam.name,
      canonicalSlug: fam.canonicalSlug,
      currentRevision: 1,
      publishedRevision: publishedRevisions[fam.key] ?? null,
      attributes,
      displayPolicies: dps,
      assets: [] as unknown[],
    };
    await projections.set(projectionKey(fam.key, tenantId), payload);
    out.push({ familyKey: fam.key, payload });
  }
  return out;
}
