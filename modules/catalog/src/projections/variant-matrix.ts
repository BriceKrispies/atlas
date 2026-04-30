import type { CatalogStateStore, ProjectionStore } from '@atlas/ports';
import type { SeedPayload } from '../seed-types.ts';
import { deterministicUuid } from '../ids.ts';

export function projectionKey(familyKey: string, tenantId: string): string {
  return `catalog:variant-matrix:${familyKey}:${tenantId}`;
}

function normalize(raw: unknown): unknown {
  return raw;
}

function display(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'boolean') return String(raw);
  if (raw == null) return null;
  return JSON.stringify(raw);
}

function facetKey(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'boolean') return String(raw);
  return null;
}

export async function rebuildVariantMatrix(
  tenantId: string,
  catalogState: CatalogStateStore,
  projections: ProjectionStore,
): Promise<Array<{ familyKey: string; payload: unknown }>> {
  const state = await catalogState.get(tenantId);
  if (!state) return [];
  const seed = state.payload as SeedPayload;

  const out: Array<{ familyKey: string; payload: unknown }> = [];
  for (const fam of seed.families) {
    const familyId = deterministicUuid('family', tenantId, fam.key);
    const sortedVariants = [...fam.variants].sort((a, b) => a.key.localeCompare(b.key));
    const facets = new Map<string, Map<string, number>>();

    const rows = sortedVariants.map((v) => {
      const variantId = deterministicUuid('variant', tenantId, fam.key, v.key);
      const valueMap: Record<string, { raw: unknown; normalized: unknown; display: string | null }> = {};
      for (const [attrKey, raw] of Object.entries(v.values)) {
        valueMap[attrKey] = {
          raw,
          normalized: normalize(raw),
          display: display(raw),
        };
        const fk = facetKey(raw);
        if (fk !== null) {
          let bucket = facets.get(attrKey);
          if (!bucket) {
            bucket = new Map();
            facets.set(attrKey, bucket);
          }
          bucket.set(fk, (bucket.get(fk) ?? 0) + 1);
        }
      }
      return {
        variantId,
        variantKey: v.key,
        name: v.name,
        revision: 1,
        values: valueMap,
      };
    });

    const facetsObj: Record<string, Array<{ value: string; count: number }>> = {};
    const sortedAttrKeys = [...facets.keys()].sort();
    for (const attr of sortedAttrKeys) {
      const bucket = facets.get(attr);
      if (!bucket) continue;
      const sortedValues = [...bucket.keys()].sort();
      facetsObj[attr] = sortedValues.map((v) => {
        const c = bucket.get(v);
        return { value: v, count: c ?? 0 };
      });
    }

    const payload = {
      familyId,
      familyKey: fam.key,
      rows,
      facets: facetsObj,
    };
    await projections.set(projectionKey(fam.key, tenantId), payload);
    out.push({ familyKey: fam.key, payload });
  }
  return out;
}
