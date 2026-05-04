/**
 * Domain types for the identity module.
 *
 * Three first-class entities: `User`, `Membership`, `InviteToken`.
 * Stored on the L3 substrate (`entities` table) — no per-domain tables.
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
