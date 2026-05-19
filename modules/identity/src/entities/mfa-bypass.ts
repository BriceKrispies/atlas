/**
 * `MfaBypass` entity — admin-issued one-shot bypass tokens.
 *
 * When a user is fully locked out (no MFA factor, no recovery codes)
 * a tenant admin can issue a 5-minute single-use bypass that lets
 * the user satisfy the MFA challenge once. Audited on issue + use
 * with both the admin's principalId AND the user's id.
 */
import type { EntityStore } from '@atlas/ports';
import type { MfaBypassDocument } from '../types.ts';
export const MFA_BYPASS_ENTITY_TYPE = 'MfaBypass';
export const MFA_BYPASS_LATEST_VERSION = 1;
export async function getMfaBypassEntity(store: EntityStore, tenantId: string, bypassId: string): Promise<MfaBypassDocument | null> {
    const row = await store.get<MfaBypassDocument>(tenantId, MFA_BYPASS_ENTITY_TYPE, bypassId);
    if (!row || row.status === 'deleted')
        return null;
    return row.attrs;
}
export async function putMfaBypassEntity(store: EntityStore, doc: MfaBypassDocument): Promise<void> {
    await store.put<MfaBypassDocument>({
        tenantId: doc.tenantId,
        entityType: MFA_BYPASS_ENTITY_TYPE,
        entityId: doc.bypassId,
        attrs: doc,
        schemaVersion: MFA_BYPASS_LATEST_VERSION,
    });
}
export async function findMfaBypassesByLookup(store: EntityStore, tenantId: string, userId: string, secretLookup: string): Promise<MfaBypassDocument[]> {
    const rows = await store.query<MfaBypassDocument>(tenantId, MFA_BYPASS_ENTITY_TYPE, { attrsEqual: { userId, secretLookup } });
    return rows.map(function (r) {
        return r.attrs;
    });
}
