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
  newIdentityProviderId,
  newScimTokenId,
  newAuditExportConfigId,
  newAuditExportRunId,
  newAuthFactorId,
  newRecoveryCodeId,
  newRecoveryBatchId,
  newMfaBypassId,
  newSamlSpKeyId,
  newSamlReplayRecordId,
  newImpersonationId,
  newBreakGlassGrantId,
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
  // Phase A3 — federated OIDC.
  IdentityProviderKind,
  IdentityProviderStatus,
  IdentityProviderDocument,
  OidcDiscoveryDocument,
  RoleMapping,
  // Phase A4 — SCIM + audit export.
  ScimTokenStatus,
  ScimTokenDocument,
  AuditExportDestinationKind,
  AuditExportS3Destination,
  AuditExportStatus,
  AuditExportCadence,
  AuditExportConfigDocument,
  AuditExportRunStatus,
  AuditExportRunDocument,
  // Phase A5 — MFA stack.
  AuthFactorKind,
  AuthFactorStatus,
  AuthFactorDocument,
  TotpFactorAttrs,
  WebAuthnFactorAttrs,
  RecoveryCodeStatus,
  RecoveryCodeDocument,
  MfaBypassStatus,
  MfaBypassDocument,
  IdentityPolicy,
  // Phase A6 — SAML.
  SamlNameIdFormat,
  SamlAttributeMappings,
  SamlSpKeyStatus,
  SamlSpKeyDocument,
  SamlAssertionReplayDocument,
  // Phase A7 — risk + impersonation + break-glass.
  ImpersonationStatus,
  ImpersonationEndReason,
  ImpersonationSessionDocument,
  BreakGlassStatus,
  BreakGlassEndReason,
  BreakGlassGrantDocument,
  RiskSignals,
  RiskScore,
  RiskScorer,
  RiskPolicy,
} from './types.ts';

export { DEFAULT_IDENTITY_POLICY } from './types.ts';

export { DEFAULT_SESSION_POLICY } from './types.ts';

export { DEFAULT_RISK_POLICY } from './types.ts';

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

// Phase A6 — SAML SP signing keys.
export {
  SAML_SP_KEY_ENTITY_TYPE,
  SAML_SP_KEY_LATEST_VERSION,
  getSamlSpKeyEntity,
  putSamlSpKeyEntity,
  findActiveSamlSpKey,
  listMetadataSamlSpKeys,
} from './entities/saml-sp-key.ts';
export {
  handleSamlSpKeyGenerate,
  handleSamlSpKeyRotate,
  type SamlSpKeyGenerateCommand,
  type SamlSpKeyGenerateResult,
  type SamlSpKeyRotateCommand,
  type SamlSpKeyRotateResult,
} from './handlers/saml-sp-key.ts';
export { generateSamlSpKey, type GeneratedSpKey } from './saml/sp-key.ts';
export {
  parseIdpMetadata,
  DEFAULT_SAML_ATTRIBUTE_MAPPINGS,
  type ParsedIdpMetadata,
} from './saml/metadata-parser.ts';
export {
  buildAuthnRequest,
  type BuildAuthnRequestOptions,
  type BuiltAuthnRequest,
} from './saml/authn-request.ts';
export {
  verifySamlResponse,
  type VerifyOptions,
  type VerifiedAssertion,
} from './saml/verify.ts';
export {
  recordSeenAssertion,
  SAML_ASSERTION_REPLAY_ENTITY_TYPE,
  SAML_ASSERTION_REPLAY_LATEST_VERSION,
} from './entities/saml-assertion-replay.ts';
export {
  handleSamlAcs,
  type SamlAcsCommand,
  type SamlAcsResult,
} from './handlers/saml-acs.ts';

// Phase A5.7 — MFA challenge flow.
export {
  handleMfaChallengeSubmit,
  type MfaChallengeMethod,
  type MfaChallengeSubmitCommand,
  type MfaChallengeSubmitResult,
} from './handlers/mfa-challenge.ts';

// Phase A5.8 — last-factor protection on Revoke.
export {
  handleFactorRevoke,
  type FactorRevokeCommand,
  type FactorRevokeResult,
} from './handlers/factor-revoke.ts';

// Phase A5.9 — MFA bypass tokens.
export {
  MFA_BYPASS_ENTITY_TYPE,
  MFA_BYPASS_LATEST_VERSION,
  getMfaBypassEntity,
  putMfaBypassEntity,
  findMfaBypassesByLookup,
} from './entities/mfa-bypass.ts';
export {
  handleMfaBypassIssue,
  handleMfaBypassUse,
  type MfaBypassIssueCommand,
  type MfaBypassIssueResult,
  type MfaBypassUseCommand,
  type MfaBypassUseResult,
} from './handlers/mfa-bypass.ts';

// Phase A5.4 + A5.5 — WebAuthn (2FA + passkey) handlers + ephemeral challenge entity.
export {
  WEBAUTHN_CHALLENGE_ENTITY_TYPE,
  WEBAUTHN_CHALLENGE_LATEST_VERSION,
  getWebAuthnChallenge,
  putWebAuthnChallenge,
  deleteWebAuthnChallenge,
  type WebAuthnChallengeDocument,
  type WebAuthnChallengeKind,
} from './entities/webauthn-challenge.ts';
export {
  handleWebAuthnRegisterBegin,
  handleWebAuthnRegisterFinish,
  type WebAuthnRegisterBeginCommand,
  type WebAuthnRegisterBeginResult,
  type WebAuthnRegisterFinishCommand,
  type WebAuthnRegisterFinishResult,
} from './handlers/webauthn-register.ts';
export {
  handleWebAuthnAssertBegin,
  handleWebAuthnAssertFinish,
  type WebAuthnAssertBeginCommand,
  type WebAuthnAssertBeginResult,
  type WebAuthnAssertFinishCommand,
  type WebAuthnAssertFinishResult,
} from './handlers/webauthn-assert.ts';

// Phase A5.6 — RecoveryCode entity + handlers.
export {
  RECOVERY_CODE_ENTITY_TYPE,
  RECOVERY_CODE_LATEST_VERSION,
  getRecoveryCodeEntity,
  putRecoveryCodeEntity,
  listRecoveryCodesForUser,
  findRecoveryCodesByLookup,
} from './entities/recovery-code.ts';
export {
  handleGenerateRecoveryCodes,
  handleRegenerateRecoveryCodes,
  handleRedeemRecoveryCode,
  type GenerateRecoveryCodesCommand,
  type GenerateRecoveryCodesResult,
  type RedeemRecoveryCodeCommand,
  type RedeemRecoveryCodeResult,
} from './handlers/recovery-code.ts';

// Phase A5.3 — TOTP handlers + crypto.
export {
  handleTotpEnroll,
  handleTotpChallenge,
  type TotpEnrollBeginCommand,
  type TotpEnrollBeginResult,
  type TotpChallengeCommand,
  type TotpChallengeResult,
} from './handlers/totp.ts';
export {
  generateTotpSecret,
  buildOtpauthUri,
  base32Encode,
  totpAt,
  hotp,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  encryptionKeyIdForTenant,
} from './crypto/totp.ts';

// Phase A5 — MFA AuthFactor wrappers.
export {
  AUTH_FACTOR_ENTITY_TYPE,
  AUTH_FACTOR_LATEST_VERSION,
  getAuthFactorEntity,
  putAuthFactorEntity,
  listFactorsForUser,
  listActiveFactorsForUserByKind,
  findFactorByCredentialId,
} from './entities/auth-factor.ts';

// Phase A4.8 — Audit export config + handlers.
export {
  AUDIT_EXPORT_CONFIG_ENTITY_TYPE,
  AUDIT_EXPORT_CONFIG_LATEST_VERSION,
  AUDIT_EXPORT_RUN_ENTITY_TYPE,
  AUDIT_EXPORT_RUN_LATEST_VERSION,
  getAuditExportConfig,
  putAuditExportConfig,
  listAuditExportConfigs,
  putAuditExportRun,
  listAuditExportRuns,
} from './entities/audit-export-config.ts';
export {
  handleAuditExportConfigure,
  handleAuditExportActivate,
  handleAuditExportDisable,
  type AuditExportConfigureCommand,
  type AuditExportConfigureResult,
  type AuditExportActivateCommand,
  type AuditExportActivateResult,
  type AuditExportDisableCommand,
  type AuditExportDisableResult,
} from './handlers/audit-export-config.ts';

// Phase A4.9 — Audit export pipeline.
export {
  runAuditExport,
  exportTenantAudit,
  InMemoryUploader,
  type Uploader,
  type AuditExportRunOptions,
} from './audit-export.ts';

// Phase A4 — SCIM token wrappers + handlers.
export {
  SCIM_TOKEN_ENTITY_TYPE,
  SCIM_TOKEN_LATEST_VERSION,
  getScimTokenEntity,
  putScimTokenEntity,
  findScimTokensByLookup,
  listScimTokens,
} from './entities/scim-token.ts';
export {
  handleScimTokenEnable,
  handleScimTokenRotate,
  handleScimTokenRevoke,
  type ScimTokenEnableCommand,
  type ScimTokenEnableResult,
  type ScimTokenRotateCommand,
  type ScimTokenRotateResult,
  type ScimTokenRevokeCommand,
  type ScimTokenRevokeResult,
} from './handlers/scim-token.ts';

// Phase A3 — IdentityProvider entity wrappers.
export {
  IDENTITY_PROVIDER_ENTITY_TYPE,
  IDENTITY_PROVIDER_LATEST_VERSION,
  getIdentityProviderEntity,
  putIdentityProviderEntity,
  findActiveProviderByIssuer,
  listIdentityProviders,
} from './entities/identity-provider.ts';

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
// Phase A3 — federated OIDC handlers.
export {
  handleIdpConfigure,
  type IdpConfigureCommand,
  type IdpConfigureResult,
} from './handlers/idp-configure.ts';
export {
  handleIdpActivate,
  type IdpActivateCommand,
  type IdpActivateResult,
} from './handlers/idp-activate.ts';
export {
  handleIdpDisable,
  type IdpDisableCommand,
  type IdpDisableResult,
} from './handlers/idp-disable.ts';
export {
  handleIdpRotateJwks,
  type IdpRotateJwksCommand,
  type IdpRotateJwksResult,
} from './handlers/idp-rotate-jwks.ts';
export {
  handleJitProvision,
  type JitClaims,
  type JitProvisionCommand,
  type JitProvisionResult,
} from './handlers/jit-provision.ts';

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
