/**
 * `InviteToken` entity — typed wrappers around `EntityStore`.
 *
 * Invite tokens are tenant-scoped. Only the Argon2id hash is persisted;
 * the plaintext is surfaced to the operator EXACTLY ONCE at issue time.
 * The `tokenLookup` field bounds the candidate set during accept so we
 * don't have to scan every pending invite.
 */
import type { EntityStore } from '@atlas/ports';
import type { InviteTokenDocument } from '../types.ts';
export const INVITE_TOKEN_ENTITY_TYPE = 'InviteToken';
export const INVITE_TOKEN_LATEST_VERSION = 1;
export async function getInviteTokenEntity(store: EntityStore, tenantId: string, tokenId: string): Promise<InviteTokenDocument | null> {
    const row = await store.get<InviteTokenDocument>(tenantId, INVITE_TOKEN_ENTITY_TYPE, tokenId);
    if (!row || row.status !== 'active')
        return null;
    return row.attrs;
}
export async function putInviteTokenEntity(store: EntityStore, doc: InviteTokenDocument): Promise<void> {
    await store.put<InviteTokenDocument>({
        tenantId: doc.tenantId,
        entityType: INVITE_TOKEN_ENTITY_TYPE,
        entityId: doc.tokenId,
        attrs: doc,
        schemaVersion: INVITE_TOKEN_LATEST_VERSION,
    });
}
/**
 * Find pending-accept candidates by the deterministic `tokenLookup`
 * prefix. Callers verify the Argon2id hash against each candidate's
 * `tokenHash`. Collisions are rare (lookup carries enough entropy) but
 * tolerated.
 */
export async function findInviteTokensByLookup(store: EntityStore, tenantId: string, tokenLookup: string): Promise<InviteTokenDocument[]> {
    const rows = await store.query<InviteTokenDocument>(tenantId, INVITE_TOKEN_ENTITY_TYPE, { attrsEqual: { tokenLookup, status: 'pending' } });
    return rows.map(function (r) {
        return r.attrs;
    });
}
