/**
 * `ApiKey` entity — typed wrappers around `EntityStore`.
 *
 * Bearer scheme: `atlas_<keyId>_<secret>`.
 *   - `keyId` is the entity_id (non-secret) — used for O(1) lookup.
 *   - `secret` is the high-entropy random part — Argon2id-hashed.
 *
 * Tenant-scoped: every key belongs to exactly one tenant. Owned by
 * exactly one of `userId` or `servicePrincipalId`.
 */

import type { EntityStore } from '@atlas/ports';
import type { ApiKeyDocument } from '../types.ts';

export const API_KEY_ENTITY_TYPE = 'ApiKey';
export const API_KEY_LATEST_VERSION = 1;

export async function getApiKeyEntity(
  store: EntityStore,
  tenantId: string,
  keyId: string,
): Promise<ApiKeyDocument | null> {
  const row = await store.get<ApiKeyDocument>(tenantId, API_KEY_ENTITY_TYPE, keyId);
  if (!row || row.status === 'deleted') return null;
  return row.attrs;
}

export async function putApiKeyEntity(
  store: EntityStore,
  doc: ApiKeyDocument,
): Promise<void> {
  await store.put<ApiKeyDocument>({
    tenantId: doc.tenantId,
    entityType: API_KEY_ENTITY_TYPE,
    entityId: doc.keyId,
    attrs: doc,
    schemaVersion: API_KEY_LATEST_VERSION,
  });
}

export async function listApiKeysForOwner(
  store: EntityStore,
  tenantId: string,
  ownerKey: 'userId' | 'servicePrincipalId',
  ownerId: string,
): Promise<ApiKeyDocument[]> {
  const rows = await store.query<ApiKeyDocument>(
    tenantId,
    API_KEY_ENTITY_TYPE,
    { attrsEqual: { [ownerKey]: ownerId } },
  );
  return rows.map((r) => r.attrs);
}

/**
 * Parse the bearer string `atlas_<keyId>.<secret>`.
 *
 * The separator between keyId and secret is `.` (NOT `_`) because
 * base64url-encoded secrets include `_` — splitting on `_` would
 * misparse. `.` is outside the base64url alphabet so it's an
 * unambiguous separator.
 *
 * Returns null when the token doesn't have the expected shape —
 * caller treats as "this isn't an API key, try another scheme."
 */
export function parseApiKeyBearer(
  bearer: string,
): { keyId: string; secret: string } | null {
  if (!bearer.startsWith('atlas_')) return null;
  const remainder = bearer.slice('atlas_'.length);
  const sep = remainder.indexOf('.');
  if (sep <= 0 || sep === remainder.length - 1) return null;
  const keyId = remainder.slice(0, sep);
  return { keyId, secret: remainder.slice(sep + 1) };
}
