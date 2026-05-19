/**
 * `AuthSession` entity — typed wrappers around `EntityStore`.
 *
 * Sessions are tenant-scoped, keyed by `sessionId` (entity_id stable
 * for the session's lifetime). Refresh tokens rotate IN PLACE — each
 * refresh updates `refreshTokenHash`/`accessTokenHash`; the previous
 * refresh hash lingers for a short grace window so a network blip
 * on the rotation response doesn't lock the user out.
 */
import type { EntityStore } from '@atlas/ports';
import type { AuthSessionDocument, AuthSessionStatus } from '../types.ts';
export const AUTH_SESSION_ENTITY_TYPE = 'AuthSession';
export const AUTH_SESSION_LATEST_VERSION = 1;
export async function getSessionEntity(store: EntityStore, tenantId: string, sessionId: string): Promise<AuthSessionDocument | null> {
    const row = await store.get<AuthSessionDocument>(tenantId, AUTH_SESSION_ENTITY_TYPE, sessionId);
    if (!row)
        return null;
    // Status filter is intentionally NOT applied here — callers
    // (Refresh, Revoke) need to inspect status to issue the right error
    // code (`SESSION_REVOKED` vs `SESSION_NOT_FOUND`). Substrate
    // soft-delete (`row.status === 'deleted'`) is still treated as gone.
    if (row.status === 'deleted')
        return null;
    return row.attrs;
}
export async function putSessionEntity(store: EntityStore, doc: AuthSessionDocument): Promise<void> {
    await store.put<AuthSessionDocument>({
        tenantId: doc.tenantId,
        entityType: AUTH_SESSION_ENTITY_TYPE,
        entityId: doc.sessionId,
        attrs: doc,
        schemaVersion: AUTH_SESSION_LATEST_VERSION,
    });
}
/**
 * List active sessions for a user — used by the concurrent-session
 * limit check on Issue. Returns oldest-first (by `issuedAt`) so the
 * caller can evict from the head when at cap.
 */
export async function listActiveSessionsForUser(store: EntityStore, tenantId: string, userId: string): Promise<AuthSessionDocument[]> {
    const rows = await store.query<AuthSessionDocument>(tenantId, AUTH_SESSION_ENTITY_TYPE, { attrsEqual: { userId, status: 'active' satisfies AuthSessionStatus } });
    const docs = rows.map(function (r) {
        return r.attrs;
    });
    docs.sort(function (a, b) {
        return (a.issuedAt < b.issuedAt ? -1 : a.issuedAt > b.issuedAt ? 1 : 0);
    });
    return docs;
}
/**
 * Find a session by the lookup prefix derived from its current refresh
 * token hash. Used by refresh-by-cookie when the cookie payload is
 * just `<refreshSecret>` — we hash + lookup.
 *
 * Phase A2 ships the cookie with `<sessionId>.<refreshSecret>` so the
 * primary refresh path skips this lookup entirely (resolves session
 * by id directly). This helper exists for the rare paths where only
 * the refresh secret is presented (e.g., legacy clients, future
 * cookie-less refresh flows).
 *
 * Tolerates lookup-prefix collisions by returning all candidates;
 * callers verify the full hash.
 */
export async function findSessionsByRefreshLookup(store: EntityStore, tenantId: string, refreshTokenLookup: string): Promise<AuthSessionDocument[]> {
    const rows = await store.query<AuthSessionDocument>(tenantId, AUTH_SESSION_ENTITY_TYPE, { attrsEqual: { refreshTokenLookup } });
    return rows.map(function (r) {
        return r.attrs;
    });
}
/** Find a session by the lookup prefix of its current access token. */
export async function findSessionsByAccessLookup(store: EntityStore, tenantId: string, accessTokenLookup: string): Promise<AuthSessionDocument[]> {
    const rows = await store.query<AuthSessionDocument>(tenantId, AUTH_SESSION_ENTITY_TYPE, { attrsEqual: { accessTokenLookup } });
    return rows.map(function (r) {
        return r.attrs;
    });
}
