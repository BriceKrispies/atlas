/**
 * `AuthFactor` entity — typed wrappers around `EntityStore`.
 *
 * One row per enrolled factor (TOTP / WebAuthn-MFA / Passkey).
 * RecoveryCode is its own entity (different cardinality —
 * 10 codes per regen vs 1 row per factor); see `recovery-code.ts`.
 *
 * Tenant-scoped per the standard pattern. `userId` is the entity-side
 * key for "list factors for user" — used by:
 *   - last-factor protection (revoke refuses when this is the only
 *     active factor and tenant `mfaRequired=true`)
 *   - challenge dispatch (which factors can the user redeem?)
 */

import type { EntityStore } from '@atlas/ports';
import type { AuthFactorDocument, AuthFactorKind } from '../types.ts';

export const AUTH_FACTOR_ENTITY_TYPE = 'AuthFactor';
export const AUTH_FACTOR_LATEST_VERSION = 1;

export async function getAuthFactorEntity(
  store: EntityStore,
  tenantId: string,
  factorId: string,
): Promise<AuthFactorDocument | null> {
  const row = await store.get<AuthFactorDocument>(
    tenantId,
    AUTH_FACTOR_ENTITY_TYPE,
    factorId,
  );
  if (!row || row.status === 'deleted') return null;
  return row.attrs;
}

export async function putAuthFactorEntity(
  store: EntityStore,
  doc: AuthFactorDocument,
): Promise<void> {
  await store.put<AuthFactorDocument>({
    tenantId: doc.tenantId,
    entityType: AUTH_FACTOR_ENTITY_TYPE,
    entityId: doc.factorId,
    attrs: doc,
    schemaVersion: AUTH_FACTOR_LATEST_VERSION,
  });
}

/**
 * List all factors for a user. Caller filters by `kind` / `status`
 * locally.
 */
export async function listFactorsForUser(
  store: EntityStore,
  tenantId: string,
  userId: string,
): Promise<AuthFactorDocument[]> {
  const rows = await store.query<AuthFactorDocument>(
    tenantId,
    AUTH_FACTOR_ENTITY_TYPE,
    { attrsEqual: { userId } },
  );
  return rows.map((r) => r.attrs);
}

/**
 * List active factors of a specific kind for a user. Used by:
 *   - WebAuthn allowCredentials (only enrolled passkeys for this user)
 *   - challenge dispatch (which factor types can we offer?)
 */
export async function listActiveFactorsForUserByKind(
  store: EntityStore,
  tenantId: string,
  userId: string,
  kind: AuthFactorKind,
): Promise<AuthFactorDocument[]> {
  const rows = await store.query<AuthFactorDocument>(
    tenantId,
    AUTH_FACTOR_ENTITY_TYPE,
    { attrsEqual: { userId, kind, status: 'active' } },
  );
  return rows.map((r) => r.attrs);
}

/**
 * Lookup a factor by credentialId (WebAuthn / Passkey only). The
 * credentialId is supplied by the browser during the assertion
 * ceremony; we resolve to the AuthFactor row to verify the signature
 * and update signCount.
 *
 * Cross-user lookup: a credentialId is unique within a tenant
 * (browsers ensure global uniqueness; we just need tenant-scoped).
 */
export async function findFactorByCredentialId(
  store: EntityStore,
  tenantId: string,
  credentialId: string,
): Promise<AuthFactorDocument | null> {
  const rows = await store.query<AuthFactorDocument>(
    tenantId,
    AUTH_FACTOR_ENTITY_TYPE,
    { attrsEqual: { 'attrs.credentialId': credentialId } },
  );
  // The InMemoryEntityStore matches `attrsEqual` against top-level
  // attrs keys; for the dotted-path query we fall back to a manual
  // filter so the test fixture works the same as the Postgres adapter
  // (which DOES support dotted paths via the JSONB expression index).
  let matches = rows;
  if (matches.length === 0) {
    const all = await store.query<AuthFactorDocument>(
      tenantId,
      AUTH_FACTOR_ENTITY_TYPE,
      { attrsEqual: {} },
    );
    matches = all.filter((r) => {
      const a = r.attrs as { attrs?: { credentialId?: string } };
      return a.attrs?.credentialId === credentialId;
    });
  }
  if (matches.length === 0) return null;
  return matches[0]!.attrs;
}
