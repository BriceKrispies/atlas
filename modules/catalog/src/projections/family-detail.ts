import type { CatalogStateStore, ProjectionStore } from '@atlas/ports';
import { deterministicUuid } from '../ids.ts';
import { readSeed } from '../internal/seed-state.ts';
export function projectionKey(familyKey: string, tenantId: string): string {
    return `catalog:family-detail:${familyKey}:${tenantId}`;
}
export async function rebuildFamilyDetail(tenantId: string, catalogState: CatalogStateStore, projections: ProjectionStore): Promise<Array<{
    familyKey: string;
    payload: unknown;
}>> {
    const state = await catalogState.get(tenantId);
    if (!state)
        return [];
    const seed = readSeed(state);
    const attrTypeByKey = new Map<string, string>();
    for (const a of seed.attributeDefinitions ?? []) {
        attrTypeByKey.set(a.key, a.dataType);
    }
    const publishedRevisions = state.publishedRevisions;
    const out: Array<{
        familyKey: string;
        payload: unknown;
    }> = [];
    for (const fam of seed.families) {
        const familyId = deterministicUuid('family', tenantId, fam.key);
        const sortedAttrs = [...fam.attributes].sort(function (a, b) {
            return a.displayOrder - b.displayOrder;
        });
        const attributes = sortedAttrs.map(function (fa) {
            return ({
                attributeKey: fa.attributeKey,
                dataType: attrTypeByKey.get(fa.attributeKey) ?? 'string',
                role: fa.role,
                required: fa.required ?? false,
                filterable: fa.filterable ?? false,
                sortable: fa.sortable ?? false,
                isVariantAxis: fa.isVariantAxis ?? false,
                displayOrder: fa.displayOrder,
            });
        });
        const dps = (fam.displayPolicies ?? [])
            .slice()
            .sort(function (a, b) {
            return a.surface.localeCompare(b.surface) || a.order - b.order;
        })
            .map(function (dp) {
            return ({
                surface: dp.surface,
                attributeKey: dp.attributeKey,
                role: dp.role,
                order: dp.order,
            });
        });
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
