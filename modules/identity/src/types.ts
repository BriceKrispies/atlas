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

export type AuthSessionStatus = 'active' | 'expired' | 'revoked' | 'evicted';

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
}
