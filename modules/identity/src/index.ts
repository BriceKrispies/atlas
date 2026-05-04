/**
 * @atlas/identity — User, Membership, InviteToken on the L3 entity substrate.
 *
 * Storage: Users live in the platform-tenant partition (`tenantId='_platform'`);
 * Memberships are tenant-scoped; InviteTokens are tenant-scoped. The
 * Membership ↔ User link is encoded as a cross-partition relation
 * (`membership.user` edge).
 *
 * Phase A1 surface: entity readers/writers + seed registration. Handlers,
 * dispatcher, queries, and password/magic-link auth land in subsequent
 * commits within the same phase.
 */

export {
  newEventId,
  newUserId,
  newMembershipId,
  newInviteTokenId,
  membershipEntityIdFor,
} from './ids.ts';

export type {
  UserStatus,
  UserDocument,
  MembershipStatus,
  MembershipDocument,
  InviteTokenStatus,
  InviteTokenDocument,
} from './types.ts';

export { IdentityError, codes as identityErrorCodes } from './errors.ts';

// L3 substrate surface.
export {
  USER_ENTITY_TYPE,
  USER_LATEST_VERSION,
  getUserEntity,
  putUserEntity,
  findUserByIdpSubject,
  findUserByEmail,
  listUsers,
} from './entities/user.ts';

export {
  MEMBERSHIP_ENTITY_TYPE,
  MEMBERSHIP_LATEST_VERSION,
  getMembershipEntity,
  putMembershipEntity,
  deleteMembershipEntity,
  listMembershipsForTenant,
} from './entities/membership.ts';

export {
  INVITE_TOKEN_ENTITY_TYPE,
  INVITE_TOKEN_LATEST_VERSION,
  getInviteTokenEntity,
  putInviteTokenEntity,
  findInviteTokensByLookup,
} from './entities/invite-token.ts';

export {
  MEMBERSHIP_USER_EDGE,
  INVITE_USER_EDGE,
  linkMembershipToUser,
  unlinkMembershipFromUser,
  linkInviteToUser,
} from './entities/relations.ts';

export type {
  IdentityDispatchContext,
  IdentityQueryDeps,
} from './entities/contracts.ts';

export { seedIdentityEntityTypes } from './entities/seed.ts';

// Handlers.
export {
  handleUserCreate,
  type UserCreateCommand,
  type UserCreateResult,
} from './handlers/user-create.ts';
export {
  handleMembershipCreate,
  type MembershipCreateCommand,
  type MembershipCreateResult,
} from './handlers/membership-create.ts';
export {
  handleInviteIssue,
  type InviteIssueCommand,
  type InviteIssueResult,
} from './handlers/invite-issue.ts';
export {
  handleInviteAccept,
  type InviteAcceptCommand,
  type InviteAcceptResult,
} from './handlers/invite-accept.ts';
export {
  identityHandlerEntries,
  identityHandlerRegistry,
} from './handlers/registry.ts';

// Dispatcher + queries.
export {
  dispatchIdentityEvent,
  identityDispatcher,
} from './dispatch.ts';
export {
  getUser,
  getUserByIdpSubject,
  getUserByEmail,
  listAllUsers,
  getMembership,
  listMemberships,
  getInviteToken,
} from './queries.ts';

// Crypto helpers (for routes that issue/verify invites).
export {
  generateSecret,
  hashSecret,
  lookupOf,
  constantTimeEqual,
} from './crypto/secret-hash.ts';
