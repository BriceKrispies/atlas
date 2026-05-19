/**
 * `ScimToken` entity — typed wrappers around `EntityStore`.
 *
 * Per-tenant SCIM bearer tokens. The IDP's SCIM connector
 * authenticates with `Authorization: Bearer <secret>`; the secret is
 * Argon2id-hashed at rest. Lookup uses the SHA-256 prefix bucket
 * pattern (same as InviteToken / OAuth tokens).
 */
import type { EntityStore } from '@atlas/ports';
import type { ScimTokenDocument } from '../types.ts';
export const SCIM_TOKEN_ENTITY_TYPE = 'ScimToken';
export const SCIM_TOKEN_LATEST_VERSION = 1;
export async function getScimTokenEntity(store: EntityStore, tenantId: string, tokenId: string): Promise<ScimTokenDocument | null> {
    const row = await store.get<ScimTokenDocument>(tenantId, SCIM_TOKEN_ENTITY_TYPE, tokenId);
    if (!row || row.status === 'deleted')
        return null;
    return row.attrs;
}
export async function putScimTokenEntity(store: EntityStore, doc: ScimTokenDocument): Promise<void> {
    await store.put<ScimTokenDocument>({
        tenantId: doc.tenantId,
        entityType: SCIM_TOKEN_ENTITY_TYPE,
        entityId: doc.tokenId,
        attrs: doc,
        schemaVersion: SCIM_TOKEN_LATEST_VERSION,
    });
}
export async function findScimTokensByLookup(store: EntityStore, tenantId: string, secretLookup: string): Promise<ScimTokenDocument[]> {
    const rows = await store.query<ScimTokenDocument>(tenantId, SCIM_TOKEN_ENTITY_TYPE, { attrsEqual: { secretLookup } });
    return rows.map(function (r) {
        return r.attrs;
    });
}
export async function listScimTokens(store: EntityStore, tenantId: string): Promise<ScimTokenDocument[]> {
    const rows = await store.list<ScimTokenDocument>(tenantId, SCIM_TOKEN_ENTITY_TYPE);
    return rows.map(function (r) {
        return r.attrs;
    });
}
