/**
 * `User` entity — typed wrappers around `EntityStore`.
 *
 * Phase A1: Users are tenant-scoped. Each tenant has its own User
 * partition; a single human invited into two tenants gets two User
 * rows, one per tenant. Cross-tenant identity unification (one human,
 * many tenant memberships, one IDP subject) is a Phase A3 concern that
 * lands alongside per-tenant federated OIDC; it'll be modeled as an
 * `IdentityProvider` entity per tenant rather than a shared User.
 */

import type { EntityStore } from '@atlas/ports';
import type { UserDocument } from '../types.ts';

export const USER_ENTITY_TYPE = 'User';
export const USER_LATEST_VERSION = 1;

export async function getUserEntity(
  store: EntityStore,
  tenantId: string,
  userId: string,
): Promise<UserDocument | null> {
  const row = await store.get<UserDocument>(tenantId, USER_ENTITY_TYPE, userId);
  if (!row || row.status !== 'active') return null;
  return row.attrs;
}

export async function putUserEntity(
  store: EntityStore,
  doc: UserDocument,
  tenantId: string,
): Promise<void> {
  await store.put<UserDocument>({
    tenantId,
    entityType: USER_ENTITY_TYPE,
    entityId: doc.userId,
    attrs: doc,
    schemaVersion: USER_LATEST_VERSION,
  });
}

/**
 * Resolve a user by primary IDP subject claim. Used by principal
 * middleware on every authenticated request. The `index_registry` row
 * for `User.primaryIdpSubject` makes this O(1) via an expression
 * index.
 */
export async function findUserByIdpSubject(
  store: EntityStore,
  tenantId: string,
  primaryIdpSubject: string,
): Promise<UserDocument | null> {
  const rows = await store.query<UserDocument>(tenantId, USER_ENTITY_TYPE, {
    attrsEqual: { primaryIdpSubject },
  });
  const active = rows.find((r) => r.status === 'active');
  return active ? active.attrs : null;
}

/**
 * Resolve a user by email. Used by invite-accept and password-login.
 */
export async function findUserByEmail(
  store: EntityStore,
  tenantId: string,
  email: string,
): Promise<UserDocument | null> {
  const rows = await store.query<UserDocument>(tenantId, USER_ENTITY_TYPE, {
    attrsEqual: { email: email.toLowerCase() },
  });
  const active = rows.find((r) => r.status === 'active');
  return active ? active.attrs : null;
}

export async function listUsers(
  store: EntityStore,
  tenantId: string,
): Promise<UserDocument[]> {
  const rows = await store.list<UserDocument>(tenantId, USER_ENTITY_TYPE);
  return rows.map((r) => r.attrs);
}
