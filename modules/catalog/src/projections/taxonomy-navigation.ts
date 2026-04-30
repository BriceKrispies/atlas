import type { CatalogStateStore, ProjectionStore } from '@atlas/ports';
import type { SeedPayload } from '../seed-types.ts';
import { deterministicUuid } from '../ids.ts';

export function projectionKey(treeKey: string, tenantId: string): string {
  return `catalog:taxonomy-navigation:${treeKey}:${tenantId}`;
}

export async function rebuildTaxonomyNavigation(
  tenantId: string,
  catalogState: CatalogStateStore,
  projections: ProjectionStore,
): Promise<Array<{ treeKey: string; payload: unknown }>> {
  const state = await catalogState.get(tenantId);
  if (!state) return [];
  const seed = state.payload as SeedPayload;

  const familiesByNodeKey = new Map<string, Array<{ key: string; name: string; canonicalSlug: string }>>();
  for (const fam of seed.families) {
    const list = familiesByNodeKey.get(fam.defaultTaxonomyNode) ?? [];
    list.push({ key: fam.key, name: fam.name, canonicalSlug: fam.canonicalSlug });
    familiesByNodeKey.set(fam.defaultTaxonomyNode, list);
  }

  const out: Array<{ treeKey: string; payload: unknown }> = [];
  for (const tree of seed.taxonomyTrees) {
    const treeId = deterministicUuid('tree', tenantId, tree.key);
    const sortedNodes = [...tree.nodes].sort((a, b) => a.path.localeCompare(b.path));
    const nodes = sortedNodes.map((n) => {
      const nodeId = deterministicUuid('node', tenantId, tree.key, n.key);
      const parentId = n.parent
        ? deterministicUuid('node', tenantId, tree.key, n.parent)
        : null;
      const fams = (familiesByNodeKey.get(n.key) ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({
          familyId: deterministicUuid('family', tenantId, f.key),
          familyKey: f.key,
          name: f.name,
          canonicalSlug: f.canonicalSlug,
        }));
      return {
        nodeId,
        key: n.key,
        path: n.path,
        name: n.name,
        parentId,
        families: fams,
      };
    });
    const payload = {
      treeId,
      treeKey: tree.key,
      name: tree.name,
      purpose: tree.purpose,
      nodes,
    };
    await projections.set(projectionKey(tree.key, tenantId), payload);
    out.push({ treeKey: tree.key, payload });
  }
  return out;
}
