/**
 * `BreakGlassGrant` entity — time-bound emergency role grant.
 *
 * Lives in the target tenant's partition. The state machine is:
 *
 *   pending_approval ──Approve──▶ active ──Auto-Expiry──▶ expired
 *         │                          │
 *         │                          └──Revoke──▶ revoked
 *         └──Deny──▶ denied
 *
 * Self-approval forbidden: the issuer (`issuedBy`) and approver
 * (`approvedBy`) must differ — the approval handler enforces this.
 *
 * Audit retention: every emitted event carries `retention:10y`. Strictest
 * tier; tenants cannot shorten.
 */
import type { EntityStore } from '@atlas/ports';
import type { BreakGlassGrantDocument } from '../types.ts';
export const BREAK_GLASS_GRANT_ENTITY_TYPE = 'BreakGlassGrant';
export const BREAK_GLASS_GRANT_LATEST_VERSION = 1;
export async function getBreakGlassGrantEntity(store: EntityStore, tenantId: string, grantId: string): Promise<BreakGlassGrantDocument | null> {
    const row = await store.get<BreakGlassGrantDocument>(tenantId, BREAK_GLASS_GRANT_ENTITY_TYPE, grantId);
    if (!row || row.status === 'deleted')
        return null;
    return row.attrs;
}
export async function putBreakGlassGrantEntity(store: EntityStore, doc: BreakGlassGrantDocument): Promise<void> {
    await store.put<BreakGlassGrantDocument>({
        tenantId: doc.tenantId,
        entityType: BREAK_GLASS_GRANT_ENTITY_TYPE,
        entityId: doc.grantId,
        attrs: doc,
        schemaVersion: BREAK_GLASS_GRANT_LATEST_VERSION,
    });
}
export async function listActiveGrantsForPrincipal(store: EntityStore, tenantId: string, grantedTo: string): Promise<BreakGlassGrantDocument[]> {
    const rows = await store.query<BreakGlassGrantDocument>(tenantId, BREAK_GLASS_GRANT_ENTITY_TYPE, { attrsEqual: { grantedTo, status: 'active' } });
    return rows.map(function (r) {
        return r.attrs;
    });
}
export async function listGrantsForTenant(store: EntityStore, tenantId: string): Promise<BreakGlassGrantDocument[]> {
    const rows = await store.query<BreakGlassGrantDocument>(tenantId, BREAK_GLASS_GRANT_ENTITY_TYPE, {});
    return rows.map(function (r) {
        return r.attrs;
    });
}
