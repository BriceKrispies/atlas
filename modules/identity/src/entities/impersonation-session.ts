/**
 * `ImpersonationSession` entity — operator-as-tenant access record.
 *
 * One row per impersonation ceremony. Lives in the TARGET tenant's
 * partition (so the customer's audit feed can resolve it without
 * cross-partition reads). The operator's principal id is stored verbatim
 * on `operatorId` so every audit event emitted while the session is
 * active can stamp `impersonatedBy`.
 *
 * Token resolution: callers present `<impersonationId>.<secret>` in
 * `Authorization: Bearer`; the middleware splits on `.`, looks up the
 * entity by `impersonationId`, and SHA-256-compares the secret half
 * against `tokenHash`. The `tokenLookup` field exists for the rare case
 * where the bearer is presented WITHOUT the id prefix (e.g. legacy
 * tooling) — same prefix-bucket pattern as ApiKey.
 */

import type { EntityStore } from '@atlas/ports';
import type { ImpersonationSessionDocument } from '../types.ts';

export const IMPERSONATION_SESSION_ENTITY_TYPE = 'ImpersonationSession';
export const IMPERSONATION_SESSION_LATEST_VERSION = 1;

export async function getImpersonationSessionEntity(
  store: EntityStore,
  tenantId: string,
  impersonationId: string,
): Promise<ImpersonationSessionDocument | null> {
  const row = await store.get<ImpersonationSessionDocument>(
    tenantId,
    IMPERSONATION_SESSION_ENTITY_TYPE,
    impersonationId,
  );
  if (!row || row.status === 'deleted') return null;
  return row.attrs;
}

export async function putImpersonationSessionEntity(
  store: EntityStore,
  doc: ImpersonationSessionDocument,
): Promise<void> {
  await store.put<ImpersonationSessionDocument>({
    tenantId: doc.tenantId,
    entityType: IMPERSONATION_SESSION_ENTITY_TYPE,
    entityId: doc.impersonationId,
    attrs: doc,
    schemaVersion: IMPERSONATION_SESSION_LATEST_VERSION,
  });
}

export async function findImpersonationByLookup(
  store: EntityStore,
  tenantId: string,
  tokenLookup: string,
): Promise<ImpersonationSessionDocument[]> {
  const rows = await store.query<ImpersonationSessionDocument>(
    tenantId,
    IMPERSONATION_SESSION_ENTITY_TYPE,
    { attrsEqual: { tokenLookup } },
  );
  return rows.map((r) => r.attrs);
}

export async function listActiveImpersonationsForTenant(
  store: EntityStore,
  tenantId: string,
): Promise<ImpersonationSessionDocument[]> {
  const rows = await store.query<ImpersonationSessionDocument>(
    tenantId,
    IMPERSONATION_SESSION_ENTITY_TYPE,
    { attrsEqual: { status: 'active' } },
  );
  return rows.map((r) => r.attrs);
}
