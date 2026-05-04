/**
 * Read-side query helpers exposed to the wiring layer.
 *
 * Reads come from `EntityStore` (Users, Memberships) — no projection
 * fast-paths today; per-tenant Membership counts are small. Add
 * memoization in `cache_entries` if a perf signal warrants.
 */

import type { EntityStore, RelationStore } from '@atlas/ports';
import type {
  AuthSessionDocument,
  MembershipDocument,
  UserDocument,
  InviteTokenDocument,
} from './types.ts';
import {
  findUserByEmail,
  findUserByIdpSubject,
  getUserEntity,
  listUsers,
} from './entities/user.ts';
import {
  getMembershipEntity,
  listMembershipsForTenant,
} from './entities/membership.ts';
import { getInviteTokenEntity } from './entities/invite-token.ts';
import {
  findSessionsByAccessLookup,
  getSessionEntity,
  listActiveSessionsForUser,
} from './entities/auth-session.ts';

export interface IdentityQueryDeps {
  tenantId: string;
  principalId: string;
  correlationId: string;
  entities: EntityStore;
  relations: RelationStore;
}

export async function getUser(
  deps: IdentityQueryDeps,
  userId: string,
): Promise<UserDocument | null> {
  return getUserEntity(deps.entities, deps.tenantId, userId);
}

export async function getUserByIdpSubject(
  deps: IdentityQueryDeps,
  primaryIdpSubject: string,
): Promise<UserDocument | null> {
  return findUserByIdpSubject(deps.entities, deps.tenantId, primaryIdpSubject);
}

export async function getUserByEmail(
  deps: IdentityQueryDeps,
  email: string,
): Promise<UserDocument | null> {
  return findUserByEmail(deps.entities, deps.tenantId, email);
}

export async function listAllUsers(
  deps: IdentityQueryDeps,
): Promise<UserDocument[]> {
  return listUsers(deps.entities, deps.tenantId);
}

/**
 * Membership for the principal's tenant. The wiring layer's principal
 * middleware calls this on every request after JWT validation to
 * hydrate `Principal.roles`.
 */
export async function getMembership(
  deps: IdentityQueryDeps,
  userId: string,
): Promise<MembershipDocument | null> {
  return getMembershipEntity(deps.entities, deps.tenantId, userId);
}

export async function listMemberships(
  deps: IdentityQueryDeps,
): Promise<MembershipDocument[]> {
  return listMembershipsForTenant(deps.entities, deps.tenantId);
}

export async function getInviteToken(
  deps: IdentityQueryDeps,
  tokenId: string,
): Promise<InviteTokenDocument | null> {
  return getInviteTokenEntity(deps.entities, deps.tenantId, tokenId);
}

// Phase A2 — sessions.

export async function getSession(
  deps: IdentityQueryDeps,
  sessionId: string,
): Promise<AuthSessionDocument | null> {
  return getSessionEntity(deps.entities, deps.tenantId, sessionId);
}

/**
 * Sessions for the current user, oldest-first by `issuedAt`. Used by
 * the `/identity/sessions` self-service route + the concurrent-limit
 * eviction path.
 */
export async function listOwnSessions(
  deps: IdentityQueryDeps,
  userId: string,
): Promise<AuthSessionDocument[]> {
  return listActiveSessionsForUser(deps.entities, deps.tenantId, userId);
}

/**
 * Resolve a session by the lookup prefix derived from a presented
 * access token. The principal middleware's bearer-auth path uses this
 * to find the candidate session row, then verifies the full hash.
 */
export async function findSessionsByAccessTokenLookup(
  deps: IdentityQueryDeps,
  accessTokenLookup: string,
): Promise<AuthSessionDocument[]> {
  return findSessionsByAccessLookup(deps.entities, deps.tenantId, accessTokenLookup);
}

// END Phase A2 sessions.
