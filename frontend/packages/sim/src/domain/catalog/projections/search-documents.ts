import type { Db } from '../../../ports/db.ts';
import type { SearchEnginePort } from '../../../ports/search-engine.ts';
import type { SearchDocument } from '../../../types.ts';
import type { SeedPayload } from '../seed-types.ts';
import { deterministicUuid } from '../ids.ts';

function display(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'boolean') return String(raw);
  if (raw == null) return null;
  return JSON.stringify(raw);
}

export async function rebuildSearchDocuments(
  tenantId: string,
  db: Db,
  search: SearchEnginePort,
): Promise<number> {
  const state = await db.get('catalog_state', tenantId);
  if (!state) return 0;
  const seed = state.payload as SeedPayload;

  const taxonomyPathByFamilyKey = new Map<string, string>();
  for (const tree of seed.taxonomyTrees) {
    const sortedNodes = [...tree.nodes].sort((a, b) => a.path.localeCompare(b.path));
    for (const fam of seed.families) {
      const node = sortedNodes.find((n) => n.key === fam.defaultTaxonomyNode);
      if (node && !taxonomyPathByFamilyKey.has(fam.key)) {
        taxonomyPathByFamilyKey.set(fam.key, node.path);
      }
    }
  }

  let written = 0;
  for (const fam of seed.families) {
    const familyId = deterministicUuid('family', tenantId, fam.key);
    const taxonomyPath = taxonomyPathByFamilyKey.get(fam.key) ?? null;

    await search.deleteByDocument(tenantId, 'family', fam.key);
    const sortedVariants = [...fam.variants].sort((a, b) => a.key.localeCompare(b.key));
    for (const v of sortedVariants) {
      await search.deleteByDocument(tenantId, 'variant', v.key);
    }

    const familyFields: Record<string, unknown> = {
      title: fam.name,
      summary: '',
      body_text: '',
      family_key: fam.key,
      family_id: familyId,
      family_type: fam.type,
      _sort: { sortOrder: 0 },
    };
    if (taxonomyPath !== null) familyFields['taxonomy_path'] = taxonomyPath;

    const familyDoc: SearchDocument = {
      documentId: fam.key,
      documentType: 'family',
      tenantId,
      fields: familyFields,
      permissionAttributes: null,
    };
    await search.index(familyDoc);
    written++;

    for (let idx = 0; idx < sortedVariants.length; idx++) {
      const v = sortedVariants[idx];
      if (!v) continue;
      const variantId = deterministicUuid('variant', tenantId, fam.key, v.key);
      const attrsMap: Record<string, unknown> = {};
      const bodyParts: string[] = [];
      for (const [attrKey, raw] of Object.entries(v.values)) {
        const d = display(raw);
        if (d !== null) {
          bodyParts.push(d);
          attrsMap[attrKey] = d;
        } else {
          attrsMap[attrKey] = null;
        }
      }
      const variantFields: Record<string, unknown> = {
        title: v.name,
        summary: `${fam.name} - ${v.key}`,
        body_text: bodyParts.join(' '),
        family_key: fam.key,
        family_id: familyId,
        family_type: fam.type,
        variant_key: v.key,
        variant_id: variantId,
        attributes: attrsMap,
        _sort: { sortOrder: idx + 1 },
      };
      if (taxonomyPath !== null) variantFields['taxonomy_path'] = taxonomyPath;

      const variantDoc: SearchDocument = {
        documentId: v.key,
        documentType: 'variant',
        tenantId,
        fields: variantFields,
        permissionAttributes: null,
      };
      await search.index(variantDoc);
      written++;
    }
  }
  return written;
}
