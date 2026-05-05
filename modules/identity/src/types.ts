/**
 * Domain types for the identity module.
 *
 * Phase A1 entities: `User`, `Membership`, `InviteToken`.
 * Phase A2 entities: `AuthSession`, `ApiKey`, `ServicePrincipal`,
 *                    `OAuthAccessToken`.
 * Phase A3 entities: `IdentityProvider`.
 *
 * All stored on the L3 substrate (`entities` table) — no per-domain
 * tables.
 */

export type UserStatus = 'active' | 'suspended' | 'deprovisioned';

/**
 * Canonical User document. The `primaryIdpSubject` field is the JWT
 * `sub` claim from the IDP that minted the token; principal middleware
 * resolves it to a User on every request. A User has at most one
 * `primaryIdpSubject` per IDP, but may carry multiple linked subjects
 * once Phase A3 (federated OIDC) lands — those go on `linkedSubjects`.
 */
export interface UserDocument {
  userId: string;
  email: string;
  status: UserStatus;
  /**
   * Subject claim from the platform IDP at first login. Required for
   * the platform-OIDC path; null for users created via SCIM or magic-link
   * before they've completed a JWT login.
   */
  primaryIdpSubject: string | null;
  givenName?: string;
  familyName?: string;
  /**
   * Argon2id hash of the user's password. Optional because a User may
   * authenticate exclusively via federated IDP / magic link / passkey.
   */
  passwordHash?: string;
  /**
   * Wall-clock timestamp of the last successful login. Used by
   * lockout / anomaly heuristics; never trust it for auth decisions.
   */
  lastLoginAt?: string;
  /**
   * Consecutive failed-login counter. Reset on success. Lockout fires
   * at the policy threshold.
   */
  failedLoginCount?: number;
  /** ISO timestamp until which logins are rejected (account lockout). */
  lockedUntil?: string;
  createdAt: string;
  updatedAt: string;
}

export type MembershipStatus = 'active' | 'suspended' | 'ended';

/**
 * Membership couples a User to a Tenant with a set of roles. Authz reads
 * Membership.roles to populate `Principal.roles` on every request.
 *
 * Roles reference platform-default Cedar bundles (TenantAdmin / Author /
 * Viewer / ServicePrincipal). Tenants may add their own roles; those
 * shadow the platform defaults via the policy store's tenant-override
 * resolution.
 */
export interface MembershipDocument {
  membershipId: string;
  tenantId: string;
  userId: string;
  roles: string[];
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
}

export type InviteTokenStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

/**
 * Single-use invite token. The token *value* (an opaque string) is
 * surfaced to the issuing operator EXACTLY ONCE; only the Argon2id hash
 * is persisted. Accepting an invite hashes the presented value and
 * looks it up by `tokenLookup` (a deterministic prefix) to bound the
 * verification work.
 */
export interface InviteTokenDocument {
  tokenId: string;
  tenantId: string;
  email: string;
  /**
   * Argon2id hash of the opaque token. The plaintext is shown to the
   * operator at issue time and is never stored.
   */
  tokenHash: string;
  /**
   * Lookup prefix derived from the token's first bytes. Lets the
   * accept handler narrow candidate rows without scanning every pending
   * invite. Treated as low-cardinality — collisions are tolerated.
   */
  tokenLookup: string;
  /** Roles to grant on the Membership created when this invite is accepted. */
  rolesOnAccept: string[];
  status: InviteTokenStatus;
  expiresAt: string;
  /** Set once on accept. */
  acceptedAt?: string;
  /** UserId minted on accept (or matched if the user already exists). */
  acceptedUserId?: string;
  createdAt: string;
}

// ===================================================================
// Phase A2 — Sessions, API keys, service principals, OAuth tokens.
// ===================================================================

export type AuthSessionStatus =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'evicted'
  /**
   * Phase A5.7 — primary auth succeeded but the user must satisfy
   * an MFA challenge before the session is fully usable.
   * `Identity.MfaChallenge.Submit` flips the status to `'active'`
   * on a successful challenge.
   */
  | 'mfa_pending';

/**
 * Reason a session ended. Set when status flips off `'active'`. Used
 * by the audit feed (Phase A4) and the risk engine (Phase A7) to
 * classify session terminations.
 */
export type SessionEndReason =
  | 'user_logout'
  | 'admin_revoke'
  | 'reuse_detected'
  | 'idle_timeout'
  | 'hard_timeout'
  | 'evicted'
  | 'password_changed'
  | 'tenant_force_relogin';

/**
 * AuthSession — the durable record of an authentication ceremony's
 * outcome. Keyed by `sessionId` (entity_id, stable for the session's
 * lifetime). Refresh tokens rotate IN PLACE: each refresh updates
 * `refreshTokenHash` + `accessTokenHash`. The previous refresh hash
 * lingers for a short grace window so a network blip on the rotation
 * response doesn't lock the user out.
 *
 * Reuse-detection: if a presented refresh token matches the *previous*
 * hash AND the grace window has elapsed, we treat it as suspected
 * theft and emit `Identity.SessionAnomaly` + `RevokeAllForUser`.
 *
 * The browser cookie carries `<sessionId>.<refreshSecret>` so the
 * refresh endpoint can resolve the session in O(1) without a hash
 * scan; the secret is then hash-compared against `refreshTokenHash`.
 */
export interface AuthSessionDocument {
  sessionId: string;
  tenantId: string;
  userId: string;
  /** SHA-256 of the current refresh secret (32 random bytes). */
  refreshTokenHash: string;
  /** Lookup prefix (first 8 hex chars of `refreshTokenHash`). */
  refreshTokenLookup: string;
  /** Previous-rotation refresh hash, kept during the grace window. */
  previousRefreshTokenHash?: string;
  /** ISO timestamp of when the previous hash was last current. */
  previousRotatedAt?: string;
  /**
   * Ring buffer of refresh-token hashes that have rotated past the grace
   * window — capped at `MAX_REVOKED_REFRESH_HASHES` (oldest first;
   * trimmed from the front when full). Presenting any of these on a
   * refresh is unambiguous reuse: the legitimate client moved on to a
   * newer secret long ago. Closes the gap where a stolen original
   * refresh secret falls through `previousRefreshTokenHash` after two
   * or more honest rotations and would otherwise produce a generic
   * SESSION_NOT_FOUND with no anomaly emission.
   */
  revokedRefreshTokenHashes?: string[];
  /**
   * SHA-256 of the current short-lived access secret. Access tokens
   * go in `Authorization: Bearer`; refresh in the cookie. Access
   * rotates with refresh.
   */
  accessTokenHash: string;
  accessTokenLookup: string;
  accessExpiresAt: string;
  /** ISO timestamp of session creation (the original auth ceremony). */
  issuedAt: string;
  lastRefreshedAt: string;
  /** Updated on every authenticated request — drives idle-timeout. */
  lastSeenAt: string;
  /** Hard-timeout cap; sessions cannot be refreshed past this point. */
  hardExpiresAt: string;
  status: AuthSessionStatus;
  /** Initial IP from the auth ceremony. Updated on each refresh. */
  ip?: string;
  /** Initial user-agent from the auth ceremony. Updated on each refresh. */
  userAgent?: string;
  /** Set when status flips off `'active'`. */
  endReason?: SessionEndReason;
  endedAt?: string;
  /**
   * Phase A7.7 — risk-based step-up gate.
   *
   * When the principal middleware computes a risk score above
   * `tenant.riskPolicy.stepUpMfaThreshold`, requests are rejected with
   * `RISK_STEP_UP_REQUIRED` UNLESS this timestamp is in the future. A
   * successful MFA challenge resets it (default window: 5 minutes).
   *
   * Server-side ONLY — never exposed in any cookie / token / response
   * payload (a client-side claim could be forged to bypass the gate).
   */
  riskAcknowledgedUntil?: string;
}

export type ApiKeyStatus = 'active' | 'revoked' | 'rotated';

/**
 * ApiKey — long-lived bearer credential for service-to-service or
 * power-user automation. Bearer scheme: `atlas_<keyId>_<secret>`.
 *
 *   - `keyId` (entity_id, NON-secret) is encoded into the bearer
 *     string for O(1) entity lookup.
 *   - `secret` (32 random bytes, base64url) is hashed via Argon2id
 *     and only the hash persists.
 *
 * Scopes constrain the action set the key can submit. An empty
 * `scopes` array means deny-everything (defensive default — explicit
 * scope grants required).
 *
 * Rotation: `Identity.ApiKey.Rotate` mints a new ApiKey row; the old
 * row's status flips to `'rotated'` with a 24h overlap window during
 * which presentations of the old key still validate (helps clients
 * that can't reload config instantly).
 */
export interface ApiKeyDocument {
  keyId: string;
  tenantId: string;
  /** Argon2id hash of the secret half of the bearer string. */
  secretHash: string;
  /** Operator-visible label. */
  name: string;
  /**
   * Owner. Exactly one of `userId` or `servicePrincipalId` is set;
   * the bearer-auth path infers the principal from whichever is
   * present.
   */
  userId?: string;
  servicePrincipalId?: string;
  /**
   * Action ids this key can submit. Treated as an explicit allow-list
   * — empty means no permitted actions.
   */
  scopes: string[];
  status: ApiKeyStatus;
  issuedAt: string;
  lastUsedAt?: string;
  /** Optional auto-expiry. Unset means "expires on revoke or rotate." */
  expiresAt?: string;
  /** Set on the SUCCESSOR row when minted via rotation. */
  rotatedFromKeyId?: string;
  /** Set on the PREDECESSOR row when rotated away from. */
  rotatedToKeyId?: string;
  /** ISO timestamp of when the rotation overlap window ends. */
  rotationOverlapUntil?: string;
  endedAt?: string;
  endReason?: 'admin_revoke' | 'rotated' | 'expired';
}

export type ServicePrincipalStatus = 'active' | 'disabled';

/**
 * ServicePrincipal — non-human identity owned by a User (the operator
 * who created it). Carries a scope set that bounds the API keys it
 * owns: any key minted under a SP must have `scopes ⊆ sp.scopes`.
 *
 * Phase A2 ships only manual creation. Future SCIM (Phase A4) extends
 * with provisioned service principals from the IDP.
 */
export interface ServicePrincipalDocument {
  spId: string;
  tenantId: string;
  displayName: string;
  /** UserId of the operator who created the SP (audit trail). */
  ownerUserId: string;
  /**
   * Scope ceiling. ApiKeys owned by this SP cannot exceed this set.
   * Empty means the SP exists but cannot be used until scopes are
   * granted.
   */
  scopes: string[];
  status: ServicePrincipalStatus;
  createdAt: string;
  updatedAt: string;
  /** Set when status flips to `'disabled'`. */
  disabledAt?: string;
  disabledBy?: string;
}

export type OAuthAccessTokenStatus = 'active' | 'revoked' | 'expired';

/**
 * OAuthAccessToken — the OAuth 2.0 client_credentials grant outcome.
 * Wire-shape stays standard (`access_token` opaque string); persisted
 * as a hashed entity so the token can be revoked instantly.
 *
 * `tokenId` doubles as the JTI (RFC 7519 JWT ID claim concept) for
 * the revocation list. Querying entities of type 'OAuthAccessToken'
 * with `status='revoked' AND expiresAt > now` gives the active
 * deny-list.
 *
 * Short-lived (typically 1 hour). Hash with SHA-256 — Argon2id is
 * overkill for high-entropy short-lived tokens.
 */
export interface OAuthAccessTokenDocument {
  tokenId: string;
  tenantId: string;
  /** SHA-256 of the opaque access secret. */
  secretHash: string;
  /** Lookup prefix (first 8 hex chars of `secretHash`). */
  secretLookup: string;
  /** The ApiKey that minted this token. */
  apiKeyId: string;
  /** The ServicePrincipal owning the ApiKey (denormalized for audit). */
  servicePrincipalId: string;
  /** Token-side scopes (subset of the ApiKey's scopes at issue time). */
  scopes: string[];
  status: OAuthAccessTokenStatus;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokedReason?: 'admin_revoke' | 'client_revoke' | 'rotated';
}

/**
 * Per-tenant session policy. Stored on
 * `control_plane.tenants.session_policy_json` and read by the
 * session-lifetime middleware. Every value has a platform default;
 * tenants override.
 */
export interface SessionPolicy {
  /**
   * Cap on simultaneously-active sessions for a single user. On
   * Issue, exceeding sessions are evicted oldest-first.
   * Default 10.
   */
  maxConcurrentSessions: number;
  /**
   * Idle-timeout window. A session not seen for this many minutes
   * is rejected with `session_idle` and status flips to `'expired'`.
   * Default 30.
   */
  idleTimeoutMinutes: number;
  /**
   * Absolute lifetime cap. A session older than this many hours is
   * rejected with `session_hard_timeout` and the user must
   * re-authenticate from scratch.
   * Default 24.
   */
  hardTimeoutHours: number;
  /**
   * Grace window during which a previous-rotation refresh token is
   * still accepted (handles network blips on the rotation response).
   * Outside the window, presenting the previous hash triggers reuse
   * detection.
   * Default 30.
   */
  refreshGraceSeconds: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  maxConcurrentSessions: 10,
  idleTimeoutMinutes: 30,
  hardTimeoutHours: 24,
  refreshGraceSeconds: 30,
};

// ===================================================================
// Phase A3 — per-tenant OIDC federation.
// ===================================================================

export type IdentityProviderKind = 'oidc' | 'saml';

export type IdentityProviderStatus = 'configured' | 'active' | 'disabled';

/**
 * Group-to-role mapping rule. Applied on every JWT login: the JWT's
 * group claim (path on `IdentityProvider.attrs.groupClaimPath`) is
 * matched against `group`; matching rules contribute their `roles`
 * to the Membership.
 *
 * Multiple rules can match a single login (a user in groups
 * "Engineering" + "OnCall" gets the union of both rules' roles).
 */
export interface RoleMapping {
  /** Group value to match (exact, case-insensitive). */
  group: string;
  /** Roles granted when the rule matches. */
  roles: string[];
}

/**
 * OIDC discovery document subset Atlas reads. Mirrors the standard
 * OIDC discovery shape (`openid-configuration`); we capture only the
 * fields we use, the rest stays on `attrs.discoveryDocument` for
 * debug.
 */
export interface OidcDiscoveryDocument {
  issuer: string;
  jwks_uri: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  /** Algorithms supported by the IDP for ID-token signing. */
  id_token_signing_alg_values_supported?: string[];
}

/**
 * IdentityProvider entity — per-tenant configuration of an external
 * IDP. Phase A3 ships only `kind=oidc`; Phase A6 extends with
 * `kind=saml`.
 *
 * Multiple IDPs per tenant are supported. On JWT iss-claim resolution
 * we look up by `(tenantId, issuer)` — the IDP's issuer must equal
 * the JWT's `iss` claim exactly. `priority` breaks ties when two
 * IDPs share an issuer (rare; primarily used during cutover from
 * one IDP to another).
 */
export interface IdentityProviderDocument {
  idpId: string;
  tenantId: string;
  kind: IdentityProviderKind;
  /** Operator-visible label. */
  displayName: string;
  /**
   * The exact `iss` claim value JWTs from this IDP carry. Used as
   * the lookup key.
   */
  issuer: string;
  /** Audience the JWT MUST carry. Often the tenant's app URL. */
  audience: string;
  /**
   * Direct JWKS endpoint URL. When provided, discovery is skipped.
   * When absent, discovery resolves it from
   * `<issuer>/.well-known/openid-configuration`.
   */
  jwksUri?: string;
  /**
   * Optional cached discovery document. Set on Configure when
   * discovery succeeds. Refresh via `RotateJwks`.
   */
  discoveryDocument?: OidcDiscoveryDocument;
  /**
   * JIT-provisioning controls.
   *
   * `requireInvite=true` (enterprise default): a JWT for an unknown
   * sub is REJECTED with `JIT_PROVISIONING_DISABLED` unless an
   * `InviteToken` exists for the email; first JWT login activates
   * the pre-provisioned Membership. `requireInvite=false`: any
   * valid JWT mints a User + Membership using
   * `defaultRolesOnFirstLogin`.
   */
  requireInvite: boolean;
  /**
   * Roles granted to JIT-provisioned Memberships when no
   * group-claim mapping matches. Empty = JIT users get no roles
   * (still creates User+Membership, but Membership.roles is []).
   */
  defaultRolesOnFirstLogin: string[];
  /**
   * JWT path to the group claim (defaults to `groups`). Supports
   * dotted paths for nested claims, e.g. `realm_access.roles`.
   */
  groupClaimPath?: string;
  /** Group-to-role mapping rules. Applied in declaration order. */
  roleMappings: RoleMapping[];
  /**
   * Tie-breaker when multiple IDPs share an `issuer` (rare; primarily
   * during cut-overs). Higher = winner.
   */
  priority: number;
  status: IdentityProviderStatus;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  disabledAt?: string;
  disabledBy?: string;
  /**
   * Wall-clock of the last successful JWKS fetch. Used by the cache
   * layer to stay under the bounded-refetch-rate cap on `kid`-miss.
   */
  jwksFetchedAt?: string;
  // ----- Phase A6 — SAML 2.0 fields (only meaningful when kind=saml) ---
  /**
   * SAML IdP entityID. The unique SAML identifier from the IdP's
   * metadata; used as the audience source on AuthnRequest issuer
   * + the IdP-side check on the assertion's Issuer element.
   */
  samlEntityId?: string;
  /** Single-Sign-On URL the SP redirects to (HTTP-Redirect or HTTP-POST). */
  samlSsoUrl?: string;
  /** Optional Single-Logout URL. Phase A6 ships SP-initiated only — SLO is post-A6. */
  samlSloUrl?: string;
  /** PEM-encoded IdP signing cert. The verify path pins to this. */
  samlIdpCert?: string;
  /** NameID format the IdP issues. */
  samlNameIdFormat?: SamlNameIdFormat;
  /** Mapping from SAML attributes to Atlas concepts. */
  samlAttributeMappings?: SamlAttributeMappings;
  /**
   * SP entityID for AuthnRequest issuer. Defaults to
   * `https://<host>/sso/saml/<tenantId>` — overridable per-tenant
   * for IdPs that need a static value.
   */
  samlSpEntityId?: string;
}

// ===================================================================
// Phase A4 — SCIM 2.0 + per-tenant audit export.
// ===================================================================

export type ScimTokenStatus = 'active' | 'revoked' | 'rotated';

/**
 * Per-tenant SCIM bearer token. The IDP's SCIM connector hits Atlas
 * with `Authorization: Bearer <secret>`. The secret is high-entropy
 * + Argon2id-hashed at rest; lookup uses the prefix-bucket pattern.
 *
 * One ACTIVE token per tenant at a time (rotation creates a successor
 * and flips the predecessor to `'rotated'` with an overlap window —
 * same shape as ApiKey rotation).
 */
export interface ScimTokenDocument {
  tokenId: string;
  tenantId: string;
  /** Argon2id hash of the bearer secret. */
  secretHash: string;
  /** SHA-256 prefix for bucket-narrowing on lookup. */
  secretLookup: string;
  /** Operator-visible label (e.g. "Okta production"). */
  name: string;
  status: ScimTokenStatus;
  issuedAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  rotatedFromTokenId?: string;
  rotatedToTokenId?: string;
  rotationOverlapUntil?: string;
  endedAt?: string;
  endReason?: 'admin_revoke' | 'rotated' | 'expired';
}

export type AuditExportDestinationKind = 's3' | 's3-compatible';

/**
 * S3-compatible destination config. The export worker uses this to
 * push JSON-Lines event batches to a customer-owned bucket.
 *
 * `endpoint` lets the customer point at MinIO / Cloudflare R2 / etc.
 * `accessKey`/`secretKey` are stored in plaintext (rotated by the
 * customer); for production deployments the secret half belongs in a
 * separate KMS-fronted secret store (Phase A4 ships the entity-level
 * shape; KMS integration is post-A4 polish).
 */
export interface AuditExportS3Destination {
  kind: AuditExportDestinationKind;
  endpoint?: string;
  bucket: string;
  region: string;
  /** Path prefix inside the bucket. */
  pathPrefix?: string;
  accessKeyId?: string;
  /** Secret key. PRODUCTION: pull from KMS / external secret store. */
  secretAccessKey?: string;
  /** Alternative auth: assume-role ARN (AWS-only). */
  roleArn?: string;
}

export type AuditExportStatus = 'configured' | 'active' | 'disabled';

export type AuditExportCadence = 'hourly' | 'daily';

/**
 * Per-tenant audit export config. One row per tenant. The worker
 * polls active configs, drains events past `cursor` since the last
 * run, serializes, pushes, advances the cursor.
 */
export interface AuditExportConfigDocument {
  configId: string;
  tenantId: string;
  destination: AuditExportS3Destination;
  cadence: AuditExportCadence;
  /** Event store seq (as string for JSON safety) of the last event exported. */
  cursor?: string;
  status: AuditExportStatus;
  /** Optional retention-tier filter — when unset, every tier exports. */
  retentionFilter?: string[];
  createdAt: string;
  updatedAt: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureReason?: string;
}

export type AuditExportRunStatus = 'running' | 'succeeded' | 'failed';

/**
 * One export run. Records what the worker did + what failed when it
 * did. Persisted as an entity so operators can audit "did the
 * 2026-05-04 09:00 export actually push everything?"
 */
export interface AuditExportRunDocument {
  runId: string;
  tenantId: string;
  configId: string;
  startedAt: string;
  endedAt?: string;
  /** Cursor at start (i.e. last-exported seq before this run). */
  fromCursor: string;
  /** Cursor at end on success. */
  toCursor?: string;
  status: AuditExportRunStatus;
  /** Number of events successfully pushed in this run. */
  eventCount?: number;
  /** Bytes of payload pushed. */
  bytes?: number;
  /** Failure detail when status='failed'. */
  failureReason?: string;
}

// ===================================================================
// Phase A5 — MFA stack + passkey primary auth.
// ===================================================================

export type AuthFactorKind = 'totp' | 'webauthn_mfa' | 'passkey';

export type AuthFactorStatus = 'active' | 'revoked' | 'locked';

/** Per-kind attribute payloads. Discriminated by `AuthFactor.kind`. */
export interface TotpFactorAttrs {
  /** AES-256-GCM-encrypted TOTP secret. Plaintext never leaves crypto. */
  encryptedSecret: string;
  /** Identifier of the encryption key used (per-tenant KMS-derived). */
  encryptionKeyId: string;
  /** Issuer string for the otpauth URI (display only). */
  issuer: string;
  /** Account label for the otpauth URI (typically the email). */
  accountLabel: string;
  /** Last counter (= floor(unixTime / step)) at successful verify. */
  lastUsedCounter?: number;
  /** Consecutive failed-verify counter for per-factor lockout. */
  failedAttempts?: number;
}

export interface WebAuthnFactorAttrs {
  credentialId: string;
  /** COSE-encoded public key, base64url. */
  publicKey: string;
  /** Last-known signCount; rejects assertions that don't increment. */
  signCount: number;
  /** AAGUID of the authenticator (debug + revocation by manufacturer). */
  aaguid?: string;
  /** Attestation format (`packed`, `fido-u2f`, `none`, etc). */
  attestationFmt?: string;
  /** True when the credential was created with `userVerification=required`. */
  userVerification?: boolean;
  /** Optional display label set by the user. */
  label?: string;
}

/**
 * Unified factor entity. `kind` discriminates the `attrs` payload —
 * the dispatch + handlers branch on `kind` to coerce the right
 * sub-type.
 */
export interface AuthFactorDocument {
  factorId: string;
  tenantId: string;
  userId: string;
  kind: AuthFactorKind;
  /** Per-kind attrs. Carries the secret material / public key. */
  attrs: TotpFactorAttrs | WebAuthnFactorAttrs;
  status: AuthFactorStatus;
  /** Operator-friendly label. */
  name: string;
  enrolledAt: string;
  lastUsedAt?: string;
  /** Set when status flips off `'active'`. */
  endedAt?: string;
  endReason?: 'admin_revoke' | 'user_revoke' | 'lockout';
  /** ISO timestamp until which the factor is locked (per-factor lockout). */
  lockedUntil?: string;
}

export type RecoveryCodeStatus = 'active' | 'consumed' | 'invalidated';

/**
 * One recovery code. We mint 10 per generation (RFC 6238-adjacent
 * convention); each has independent status. Regenerate flips ALL
 * existing codes for the user to `'invalidated'` and creates a fresh
 * batch.
 */
export interface RecoveryCodeDocument {
  codeId: string;
  tenantId: string;
  userId: string;
  /** Argon2id hash of the plaintext code. */
  codeHash: string;
  /** SHA-256 prefix lookup (8 hex chars). */
  codeLookup: string;
  /** Generation batch id — all codes in the same batch share this. */
  batchId: string;
  status: RecoveryCodeStatus;
  createdAt: string;
  consumedAt?: string;
  invalidatedAt?: string;
}

export type MfaBypassStatus = 'pending' | 'used' | 'expired' | 'revoked';

/**
 * Admin-issued one-shot bypass token. Skips MFA exactly once. 5-minute
 * default TTL; revoked instantly on use.
 */
export interface MfaBypassDocument {
  bypassId: string;
  tenantId: string;
  /** User this bypass was issued to. */
  userId: string;
  /** Admin who issued it. */
  issuedBy: string;
  /** Argon2id hash of the bypass secret. */
  secretHash: string;
  secretLookup: string;
  status: MfaBypassStatus;
  issuedAt: string;
  expiresAt: string;
  /** Set on use. */
  usedAt?: string;
}

/**
 * Tenant-wide identity policy. Stored on `tenants.identity_policy_json`.
 * Distinct from `session_policy_json` (session lifetimes); merging
 * later if the surface gets unwieldy.
 */
export interface IdentityPolicy {
  /** When true, every user's auth ceremony requires a second factor. */
  mfaRequired: boolean;
  /**
   * Acceptable WebAuthn attestation formats. `'none'` is permissive;
   * `'packed' | 'fido-u2f'` enforce real attestation. Default ['none'].
   */
  webauthnAttestation: ReadonlyArray<'none' | 'packed' | 'fido-u2f'>;
  /** Number of recovery codes generated per regen. Default 10. */
  recoveryCodeCount: number;
  /** Per-factor lockout threshold. Default 5. */
  factorLockoutThreshold: number;
  /** Per-factor lockout duration in minutes. Default 15. */
  factorLockoutMinutes: number;
}

export const DEFAULT_IDENTITY_POLICY: IdentityPolicy = {
  mfaRequired: false,
  webauthnAttestation: ['none'],
  recoveryCodeCount: 10,
  factorLockoutThreshold: 5,
  factorLockoutMinutes: 15,
};

// ===================================================================
// Phase A6 — SAML 2.0 federation.
// ===================================================================

export type SamlNameIdFormat =
  | 'emailAddress'
  | 'persistent'
  | 'transient'
  | 'unspecified';

export interface SamlAttributeMappings {
  email: string;
  givenName?: string;
  familyName?: string;
  groups?: string;
}

export type SamlSpKeyStatus = 'active' | 'rotated' | 'revoked';

export interface SamlSpKeyDocument {
  keyId: string;
  tenantId: string;
  encryptedPrivateKey: string;
  encryptionKeyId: string;
  publicCertPem: string;
  keyLength: number;
  status: SamlSpKeyStatus;
  issuedAt: string;
  expiresAt?: string;
  rotatedFromKeyId?: string;
  rotatedToKeyId?: string;
  rotationOverlapUntil?: string;
  endedAt?: string;
}

export interface SamlAssertionReplayDocument {
  recordId: string;
  tenantId: string;
  idpId: string;
  assertionId: string;
  expiresAt: string;
  recordedAt: string;
}

// ===================================================================
// Phase A7 — Risk engine + impersonation + break-glass.
// ===================================================================

export type ImpersonationStatus = 'active' | 'ended' | 'expired' | 'revoked';

export type ImpersonationEndReason =
  | 'operator_ended'
  | 'auto_expired'
  | 'tenant_revoked'
  | 'platform_revoked';

/**
 * ImpersonationSession — operator-as-tenant access for support workflows.
 *
 * An ops engineer (a "platform principal") assumes a target user's identity
 * within a tenant for a bounded window. The session is tracked as an entity
 * so every action emitted while it is active can carry `impersonatedBy` on
 * the audit envelope. Token shape is the same opaque-secret/hash pair we use
 * elsewhere (`<impersonationId>.<secret>` over the wire; SHA-256 hash at
 * rest, prefix lookup for O(1) resolution).
 *
 * Audit retention: every emitted event carries `retention:7y` (per Phase A7
 * platform policy — tenants can lengthen but not shorten).
 */
export interface ImpersonationSessionDocument {
  impersonationId: string;
  /** Target tenant (the customer being supported). */
  tenantId: string;
  /**
   * Operator's principal id. Often `ops:<userId>` — a platform-tenant user
   * with the `PlatformSupport` role. Carried verbatim onto every event
   * emitted under the impersonation as `impersonatedBy`.
   */
  operatorId: string;
  /** UserId being impersonated within the target tenant. */
  targetUserId: string;
  /** Free-form justification (required, non-empty). */
  reason: string;
  /**
   * Ticket / incident URL. Required — every impersonation must reference
   * the support context that motivated it.
   */
  ticketUrl: string;
  /** Window cap in minutes. Sessions older than this are auto-expired. */
  maxDurationMin: number;
  /** SHA-256 of the opaque impersonation token's secret half. */
  tokenHash: string;
  /** Lookup prefix (first 8 hex chars of `tokenHash`). */
  tokenLookup: string;
  status: ImpersonationStatus;
  issuedAt: string;
  expiresAt: string;
  endedAt?: string;
  endReason?: ImpersonationEndReason;
  /** Set when status flips to `'revoked'` — the principal who revoked. */
  revokedBy?: string;
  /**
   * Resource types this impersonation is forbidden from mutating, derived
   * at issue from tenant policy. The middleware refuses
   * write-actions on resources whose entityType matches any entry here.
   */
  readonlyResourceTypes?: ReadonlyArray<string>;
}

export type BreakGlassStatus =
  | 'pending_approval'
  | 'active'
  | 'expired'
  | 'revoked'
  | 'denied';

export type BreakGlassEndReason =
  | 'auto_expired'
  | 'tenant_revoked'
  | 'platform_revoked'
  | 'denied_by_approver';

/**
 * BreakGlassGrant — time-bound emergency role grant.
 *
 * Issued by a platform operator during an incident; activated only after a
 * second operator approves (4-eyes). Self-approval forbidden — the
 * issuer and approver must differ. Auto-expires after `maxDurationMin`;
 * tenant admins can revoke in flight.
 *
 * Scope shape: `grantedRoles` is the role set added to the recipient's
 * principal during the active window. `resourceTypeAllowList` (when set)
 * narrows the grant — actions on entity types outside the list are
 * denied even within the active window.
 *
 * Audit retention: every emitted event carries `retention:10y` (the
 * strictest tier — tenants cannot shorten).
 */
export interface BreakGlassGrantDocument {
  grantId: string;
  tenantId: string;
  /** Operator who issued the grant. */
  issuedBy: string;
  /**
   * Principal id receiving the grant. Often the issuer themselves
   * (operator self-grants are common during incident response — the 4-eyes
   * approver is the safety check).
   */
  grantedTo: string;
  /**
   * Roles granted while `status='active'`. Composed onto the recipient's
   * Principal.roles by the principal middleware.
   */
  grantedRoles: ReadonlyArray<string>;
  /**
   * Optional resource-type allow-list. When set, the grant only applies
   * to actions whose target resource type is in the list. Empty/unset
   * means "applies to every action under the granted roles."
   */
  resourceTypeAllowList?: ReadonlyArray<string>;
  /** Free-form justification. Required, non-empty. */
  justification: string;
  /** Incident URL. Required. */
  incidentUrl: string;
  /** Window cap in minutes. */
  maxDurationMin: number;
  /**
   * Whether the grant requires a second-approver (4-eyes). Defaults true
   * for production tenants — the issuing handler reads tenant policy.
   */
  requireApproval: boolean;
  status: BreakGlassStatus;
  issuedAt: string;
  /**
   * Wall-clock at which the grant auto-expires. Populated at activation;
   * before approval it's the would-be expiry assuming immediate approval.
   */
  expiresAt: string;
  approvedAt?: string;
  approvedBy?: string;
  endedAt?: string;
  endReason?: BreakGlassEndReason;
  revokedBy?: string;
}

/**
 * Risk-engine signals for one auth ceremony / authenticated request.
 * The scorer reduces these to a single `score ∈ [0, 1]`. Default
 * thresholds: `score > 0.7` triggers step-up MFA.
 */
export interface RiskSignals {
  /** Caller IP (v4 or v6 string). */
  ip?: string;
  /**
   * Coarse geo classification — country code or `'unknown'`. The scorer
   * matches this against the user's recent geo set; mismatch raises score.
   */
  geo?: string;
  /** UA category — `'browser' | 'mobile' | 'cli' | 'unknown'`. */
  uaClass?: 'browser' | 'mobile' | 'cli' | 'unknown';
  /** Hour-of-day (0-23) in UTC. Outliers vs user pattern raise score. */
  hourUtc?: number;
  /**
   * Recent failure rate for this user — fraction of last N login
   * attempts that were rejected. 0 = clean; 1 = every attempt failed.
   */
  recentFailureRate?: number;
}

/**
 * Risk-engine output. Bounded `[0, 1]`; the policy layer translates
 * thresholds to step-up requirements.
 */
export interface RiskScore {
  score: number;
  signals: RiskSignals;
  /**
   * Per-signal contributions, for explainability + audit.
   * Sum need not equal `score` (the scorer can reweight or clamp).
   */
  contributions: Readonly<Record<string, number>>;
}

/**
 * Pluggable risk scorer. Apps wire a default impl in `bootstrap`; tests
 * inject a deterministic stub. Returning `score=0` is a no-signal vote.
 */
export type RiskScorer = (signals: RiskSignals) => RiskScore;

/**
 * Per-tenant risk policy. Stored on `tenants.identity_policy_json`
 * alongside the MFA fields; defaults below.
 */
export interface RiskPolicy {
  /**
   * Score above which step-up MFA is required. Default 0.7.
   * Set to 1.1 to disable step-up entirely.
   */
  stepUpMfaThreshold: number;
  /**
   * Score above which the request is hard-denied (step-up insufficient).
   * Default 0.95. Set to 1.1 to disable.
   */
  hardDenyThreshold: number;
}

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  stepUpMfaThreshold: 0.7,
  hardDenyThreshold: 0.95,
};
