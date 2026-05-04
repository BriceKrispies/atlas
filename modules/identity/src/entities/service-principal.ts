/**
 * `ServicePrincipal` entity — typed wrappers around `EntityStore`.
 *
 * Tenant-scoped, owned by a User. Carries a scope ceiling that bounds
 * owned ApiKeys (an ApiKey owned by an SP cannot have a scope outside
 * `sp.scopes`).
 */

import type { EntityStore } from '@atlas/ports';
import type { ServicePrincipalDocument } from '../types.ts';

export const SERVICE_PRINCIPAL_ENTITY_TYPE = 'ServicePrincipal';
export const SERVICE_PRINCIPAL_LATEST_VERSION = 1;

export async function getServicePrincipalEntity(
  store: EntityStore,
  tenantId: string,
  spId: string,
): Promise<ServicePrincipalDocument | null> {
  const row = await store.get<ServicePrincipalDocument>(
    tenantId,
    SERVICE_PRINCIPAL_ENTITY_TYPE,
    spId,
  );
  if (!row || row.status === 'deleted') return null;
  return row.attrs;
}

export async function putServicePrincipalEntity(
  store: EntityStore,
  doc: ServicePrincipalDocument,
): Promise<void> {
  await store.put<ServicePrincipalDocument>({
    tenantId: doc.tenantId,
    entityType: SERVICE_PRINCIPAL_ENTITY_TYPE,
    entityId: doc.spId,
    attrs: doc,
    schemaVersion: SERVICE_PRINCIPAL_LATEST_VERSION,
  });
}

export async function listServicePrincipals(
  store: EntityStore,
  tenantId: string,
): Promise<ServicePrincipalDocument[]> {
  const rows = await store.list<ServicePrincipalDocument>(
    tenantId,
    SERVICE_PRINCIPAL_ENTITY_TYPE,
  );
  return rows.map((r) => r.attrs);
}
