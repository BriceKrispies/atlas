/**
 * Identifier helpers for the identity module.
 *
 * All helpers use cryptographically secure randomness (`node:crypto`'s
 * `randomBytes`). Identifiers carry a short human-readable prefix so they
 * can be grepped in logs without ambiguity.
 *
 * Identifiers in this module are NOT secrets — secrets live next to them
 * in their entity (e.g. `AuthSession.refreshTokenHash`). But several IDs
 * (`sessionId`, `apiKeyId`, `oauthTokenId`) are exposed in cookies / bearer
 * strings, so guessability still matters: predictable IDs let an attacker
 * narrow brute-force ranges or build an existence oracle. Hence
 * `crypto.randomBytes` rather than `Math.random()`.
 */

import { randomBytes } from 'node:crypto';

/**
 * 16 bytes → 128 bits of entropy → ~22 base64url characters. Comfortable
 * margin against birthday collisions across the lifetime of the platform
 * even with billions of IDs per type.
 */
function token(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

export function newEventId(): string {
  return `evt-${token()}`;
}

export function newUserId(): string {
  return `usr-${token()}`;
}

export function newMembershipId(): string {
  return `mbr-${token()}`;
}

export function newInviteTokenId(): string {
  return `inv-${token()}`;
}

/**
 * Membership entity_id is deterministic from `userId`. One Membership per
 * user-per-tenant; this lets handlers do an idempotent upsert without a
 * uniqueness index lookup. (The substrate's
 * (tenant_id, entity_type, entity_id) PK enforces uniqueness for free.)
 */
export function membershipEntityIdFor(userId: string): string {
  return `m:${userId}`;
}

// ===================================================================
// Phase A2 — sessions, API keys, service principals, OAuth tokens.
// ===================================================================

export function newSessionId(): string {
  return `ses-${token()}`;
}

/**
 * ApiKey ids appear *non-secret* inside the bearer string
 * (`atlas_<keyId>_<secret>`), so the format is chosen for human
 * glanceability — the `ak_` prefix lets operators recognize it on
 * sight as an ApiKey identifier.
 */
export function newApiKeyId(): string {
  return `ak_${token()}`;
}

export function newServicePrincipalId(): string {
  return `sp-${token()}`;
}

/**
 * OAuth access token ids double as the JTI (revocation-list key).
 */
export function newOAuthTokenId(): string {
  return `ot-${token()}`;
}

/**
 * IdentityProvider ids — per-tenant. Substrate's PK includes
 * `tenantId`, so collisions across tenants are fine.
 */
export function newIdentityProviderId(): string {
  return `idp-${token()}`;
}

/** Phase A4 — SCIM tokens, audit export configs, audit export runs. */
export function newScimTokenId(): string {
  return `scimtok-${token()}`;
}
export function newAuditExportConfigId(): string {
  return `audex-${token()}`;
}
export function newAuditExportRunId(): string {
  return `audexrun-${token()}`;
}

/** Phase A5 — MFA factors, recovery codes, bypass tokens. */
export function newAuthFactorId(): string {
  return `fct-${token()}`;
}
export function newRecoveryCodeId(): string {
  return `rec-${token()}`;
}
export function newRecoveryBatchId(): string {
  return `recbatch-${token()}`;
}
export function newMfaBypassId(): string {
  return `mfabp-${token()}`;
}

/** Phase A6 — SAML SP signing keys + replay records. */
export function newSamlSpKeyId(): string {
  return `samlk-${token()}`;
}
export function newSamlReplayRecordId(assertionId: string): string {
  const safe = assertionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return `samlrpl-${safe}`;
}
