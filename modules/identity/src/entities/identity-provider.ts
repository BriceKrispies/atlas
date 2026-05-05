/**
 * `IdentityProvider` entity — typed wrappers around `EntityStore`.
 *
 * Tenant-scoped. Each row represents one external IDP a tenant has
 * configured. Multiple IDPs per tenant are supported. JWT iss-claim
 * resolution looks up by `(tenantId, issuer)`, breaking ties by
 * `priority` when two IDPs share an issuer (rare; primarily for
 * IDP-cutover windows).
 */

import type { EntityStore } from '@atlas/ports';
import type {
  IdentityProviderDocument,
  IdentityProviderStatus,
} from '../types.ts';

export const IDENTITY_PROVIDER_ENTITY_TYPE = 'IdentityProvider';
export const IDENTITY_PROVIDER_LATEST_VERSION = 1;

export async function getIdentityProviderEntity(
  store: EntityStore,
  tenantId: string,
  idpId: string,
): Promise<IdentityProviderDocument | null> {
  const row = await store.get<IdentityProviderDocument>(
    tenantId,
    IDENTITY_PROVIDER_ENTITY_TYPE,
    idpId,
  );
  if (!row || row.status === 'deleted') return null;
  return row.attrs;
}

export async function putIdentityProviderEntity(
  store: EntityStore,
  doc: IdentityProviderDocument,
): Promise<void> {
  await store.put<IdentityProviderDocument>({
    tenantId: doc.tenantId,
    entityType: IDENTITY_PROVIDER_ENTITY_TYPE,
    entityId: doc.idpId,
    attrs: doc,
    schemaVersion: IDENTITY_PROVIDER_LATEST_VERSION,
  });
}

/**
 * Resolve the active IDP that issued a JWT, by matching `iss` claim
 * against `IdentityProvider.issuer`. Returns the highest-priority
 * `'active'` row when multiple IDPs share the issuer.
 */
export async function findActiveProviderByIssuer(
  store: EntityStore,
  tenantId: string,
  issuer: string,
): Promise<IdentityProviderDocument | null> {
  const rows = await store.query<IdentityProviderDocument>(
    tenantId,
    IDENTITY_PROVIDER_ENTITY_TYPE,
    {
      attrsEqual: {
        issuer,
        status: 'active' satisfies IdentityProviderStatus,
      },
    },
  );
  if (rows.length === 0) return null;
  // Highest priority wins.
  return rows
    .map((r) => r.attrs)
    .sort((a, b) => b.priority - a.priority)[0] ?? null;
}

/**
 * List all IDPs for a tenant. Used by the admin UI's IDP-management
 * surface.
 */
export async function listIdentityProviders(
  store: EntityStore,
  tenantId: string,
): Promise<IdentityProviderDocument[]> {
  const rows = await store.list<IdentityProviderDocument>(
    tenantId,
    IDENTITY_PROVIDER_ENTITY_TYPE,
  );
  return rows.map((r) => r.attrs);
}
