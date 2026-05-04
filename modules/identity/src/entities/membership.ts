/**
 * `Membership` entity — typed wrappers around `EntityStore`.
 *
 * Memberships are tenant-scoped (unlike Users). One Membership per
 * (tenant, user); the entity_id is deterministic via
 * `membershipEntityIdFor(userId)` so handlers idempotently upsert.
 */

import type { EntityStore } from '@atlas/ports';
import type { MembershipDocument } from '../types.ts';
import { membershipEntityIdFor } from '../ids.ts';

export const MEMBERSHIP_ENTITY_TYPE = 'Membership';
export const MEMBERSHIP_LATEST_VERSION = 1;

export async function getMembershipEntity(
  store: EntityStore,
  tenantId: string,
  userId: string,
): Promise<MembershipDocument | null> {
  const row = await store.get<MembershipDocument>(
    tenantId,
    MEMBERSHIP_ENTITY_TYPE,
    membershipEntityIdFor(userId),
  );
  if (!row || row.status !== 'active') return null;
  return row.attrs;
}

export async function putMembershipEntity(
  store: EntityStore,
  doc: MembershipDocument,
): Promise<void> {
  await store.put<MembershipDocument>({
    tenantId: doc.tenantId,
    entityType: MEMBERSHIP_ENTITY_TYPE,
    entityId: membershipEntityIdFor(doc.userId),
    attrs: doc,
    schemaVersion: MEMBERSHIP_LATEST_VERSION,
  });
}

export async function deleteMembershipEntity(
  store: EntityStore,
  tenantId: string,
  userId: string,
): Promise<void> {
  await store.delete(
    tenantId,
    MEMBERSHIP_ENTITY_TYPE,
    membershipEntityIdFor(userId),
  );
}

export async function listMembershipsForTenant(
  store: EntityStore,
  tenantId: string,
): Promise<MembershipDocument[]> {
  const rows = await store.list<MembershipDocument>(
    tenantId,
    MEMBERSHIP_ENTITY_TYPE,
  );
  return rows.map((r) => r.attrs);
}
