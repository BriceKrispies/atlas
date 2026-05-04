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
  newSessionId,
  newApiKeyId,
  newServicePrincipalId,
  newOAuthTokenId,
} from './ids.ts';

export type {
  UserStatus,
  UserDocument,
  MembershipStatus,
  MembershipDocument,
  InviteTokenStatus,
  InviteTokenDocument,
  // Phase A2
  AuthSessionStatus,
  AuthSessionDocument,
  SessionEndReason,
  ApiKeyStatus,
  ApiKeyDocument,
  ServicePrincipalStatus,
  ServicePrincipalDocument,
  OAuthAccessTokenStatus,
  OAuthAccessTokenDocument,
  SessionPolicy,
} from './types.ts';

export { DEFAULT_SESSION_POLICY } from './types.ts';

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
  IdentityDispatchContextA2,
  IdentityQueryDepsA2,
  SessionPolicyResolver,
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
  handlePasswordSet,
  type PasswordSetCommand,
  type PasswordSetResult,
} from './handlers/password-set.ts';
export {
  handlePasswordLogin,
  type PasswordLoginCommand,
  type PasswordLoginResult,
} from './handlers/password-login.ts';
export {
  handleSessionIssue,
  type SessionIssueCommand,
  type SessionIssueResult,
} from './handlers/session-issue.ts';
export {
  handleSessionRefresh,
  type SessionRefreshCommand,
  type SessionRefreshResult,
} from './handlers/session-refresh.ts';
export {
  handleSessionRevoke,
  handleSessionRevokeAllForUser,
  type SessionRevokeCommand,
  type SessionRevokeResult,
  type SessionRevokeAllForUserCommand,
  type SessionRevokeAllForUserResult,
} from './handlers/session-revoke.ts';
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
  getSession,
  listOwnSessions,
  findSessionsByAccessTokenLookup,
} from './queries.ts';

// AuthSession entity-store wrappers — surfaced for routes/middleware
// that need direct access (e.g. principal middleware bearer-auth).
export {
  AUTH_SESSION_ENTITY_TYPE,
  AUTH_SESSION_LATEST_VERSION,
  getSessionEntity,
  putSessionEntity,
  listActiveSessionsForUser,
  findSessionsByRefreshLookup,
  findSessionsByAccessLookup,
} from './entities/auth-session.ts';

// Phase A2.7-A2.9 — service credentials.
export {
  API_KEY_ENTITY_TYPE,
  API_KEY_LATEST_VERSION,
  getApiKeyEntity,
  putApiKeyEntity,
  listApiKeysForOwner,
  parseApiKeyBearer,
} from './entities/api-key.ts';
export {
  SERVICE_PRINCIPAL_ENTITY_TYPE,
  SERVICE_PRINCIPAL_LATEST_VERSION,
  getServicePrincipalEntity,
  putServicePrincipalEntity,
  listServicePrincipals,
} from './entities/service-principal.ts';
export {
  OAUTH_TOKEN_ENTITY_TYPE,
  OAUTH_TOKEN_LATEST_VERSION,
  getOAuthTokenEntity,
  putOAuthTokenEntity,
  findOAuthTokensByLookup,
} from './entities/oauth-token.ts';
export {
  handleApiKeyCreate,
  type ApiKeyCreateCommand,
  type ApiKeyCreateResult,
} from './handlers/api-key-create.ts';
export {
  handleApiKeyRotate,
  type ApiKeyRotateCommand,
  type ApiKeyRotateResult,
} from './handlers/api-key-rotate.ts';
export {
  handleApiKeyRevoke,
  type ApiKeyRevokeCommand,
  type ApiKeyRevokeResult,
} from './handlers/api-key-revoke.ts';
export {
  handleServicePrincipalCreate,
  handleServicePrincipalSetScopes,
  handleServicePrincipalDisable,
  type ServicePrincipalCreateCommand,
  type ServicePrincipalCreateResult,
  type ServicePrincipalSetScopesCommand,
  type ServicePrincipalSetScopesResult,
  type ServicePrincipalDisableCommand,
  type ServicePrincipalDisableResult,
} from './handlers/service-principal.ts';
export {
  handleOAuthIssueToken,
  type OAuthIssueCommand,
  type OAuthIssueResult,
} from './handlers/oauth-token-issue.ts';
export {
  handleOAuthRevokeToken,
  type OAuthRevokeCommand,
  type OAuthRevokeResult,
} from './handlers/oauth-token-revoke.ts';

// Session lifetime helpers (Phase A2.4).
export {
  checkSessionLifetime,
  touchSessionLastSeen,
  type LifetimeCheckResult,
} from './session-lifetime.ts';

// Crypto helpers (for routes that issue/verify invites + passwords).
export {
  generateSecret,
  hashSecret,
  lookupOf,
  constantTimeEqual,
} from './crypto/secret-hash.ts';
export {
  hashPassword,
  verifyPassword,
  validatePasswordComplexity,
} from './crypto/password.ts';

// Platform-default role packs (Phase A1).
export {
  buildRolePacksCedar,
  buildRolePackBundle,
  type PolicyBundleWrapper,
} from './policies/role-packs.ts';
