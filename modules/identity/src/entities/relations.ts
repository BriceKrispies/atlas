/**
 * Relation helpers for identity. All edges are tenant-local.
 *
 *   - `membership.user` (1:1) — Membership → User. The Membership has
 *     a deterministic entity_id (`m:<userId>`) so the edge is mostly
 *     redundant in Phase A1, but we keep it so future features that
 *     traverse "give me all users that have a membership in scope X"
 *     have a uniform graph entry point.
 *   - `invite.user` (0:1) — InviteToken → User, set on accept.
 */

import type { RelationStore } from '@atlas/ports';
import { membershipEntityIdFor } from '../ids.ts';

export const MEMBERSHIP_USER_EDGE = 'membership.user';
export const INVITE_USER_EDGE = 'invite.user';

export async function linkMembershipToUser(
  store: RelationStore,
  tenantId: string,
  userId: string,
): Promise<void> {
  await store.add({
    tenantId,
    edgeType: MEMBERSHIP_USER_EDGE,
    fromId: membershipEntityIdFor(userId),
    toId: userId,
  });
}

export async function unlinkMembershipFromUser(
  store: RelationStore,
  tenantId: string,
  userId: string,
): Promise<void> {
  await store.remove(
    tenantId,
    MEMBERSHIP_USER_EDGE,
    membershipEntityIdFor(userId),
    userId,
  );
}

export async function linkInviteToUser(
  store: RelationStore,
  tenantId: string,
  tokenId: string,
  userId: string,
): Promise<void> {
  await store.add({
    tenantId,
    edgeType: INVITE_USER_EDGE,
    fromId: tokenId,
    toId: userId,
  });
}
