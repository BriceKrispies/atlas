/**
 * `OAuthAccessToken` entity — typed wrappers around `EntityStore`.
 *
 * Each issued token is one row; `tokenId` doubles as the JTI and the
 * entity_id. Status flips to 'revoked' on `/oauth/revoke`. The opaque
 * secret is SHA-256-hashed (high entropy + short-lived ⇒ Argon2id is
 * overkill).
 */
import type { EntityStore } from '@atlas/ports';
import type { OAuthAccessTokenDocument } from '../types.ts';
export const OAUTH_TOKEN_ENTITY_TYPE = 'OAuthAccessToken';
export const OAUTH_TOKEN_LATEST_VERSION = 1;
export async function getOAuthTokenEntity(store: EntityStore, tenantId: string, tokenId: string): Promise<OAuthAccessTokenDocument | null> {
    const row = await store.get<OAuthAccessTokenDocument>(tenantId, OAUTH_TOKEN_ENTITY_TYPE, tokenId);
    if (!row || row.status === 'deleted')
        return null;
    return row.attrs;
}
export async function putOAuthTokenEntity(store: EntityStore, doc: OAuthAccessTokenDocument): Promise<void> {
    await store.put<OAuthAccessTokenDocument>({
        tenantId: doc.tenantId,
        entityType: OAUTH_TOKEN_ENTITY_TYPE,
        entityId: doc.tokenId,
        attrs: doc,
        schemaVersion: OAUTH_TOKEN_LATEST_VERSION,
    });
}
export async function findOAuthTokensByLookup(store: EntityStore, tenantId: string, secretLookup: string): Promise<OAuthAccessTokenDocument[]> {
    const rows = await store.query<OAuthAccessTokenDocument>(tenantId, OAUTH_TOKEN_ENTITY_TYPE, { attrsEqual: { secretLookup } });
    return rows.map(function (r) {
        return r.attrs;
    });
}
