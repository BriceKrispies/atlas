import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  AuthFactorDocument,
  IdentityPolicy,
  TotpFactorAttrs,
} from '../types.ts';
import { DEFAULT_IDENTITY_POLICY } from '../types.ts';
import { newAuthFactorId, newEventId } from '../ids.ts';
import {
  buildOtpauthUri,
  decryptSecret,
  encryptSecret,
  encryptionKeyIdForTenant,
  generateTotpSecret,
  verifyTotp,
} from '../crypto/totp.ts';
import { getAuthFactorEntity } from '../entities/auth-factor.ts';

// =====================================================================
// Enroll (begin + finish).
// =====================================================================

export interface TotpEnrollBeginCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  userId: string;
  /** Issuer string for the otpauth URI display. */
  issuer: string;
  /** Account label — typically the user's email. */
  accountLabel: string;
  /** Operator-friendly label stored on the factor. */
  name: string;
}

export interface TotpEnrollBeginResult {
  /**
   * The enrolled (but not-yet-confirmed) factor document. Status is
   * `'active'` because Atlas's enroll-then-finish two-phase shape would
   * leave room for half-set state; the simpler model is "enroll mints
   * an active factor; user MUST verify via challenge before relying
   * on it." The user-facing flow renders the QR + asks for a code; if
   * they get it wrong they revoke + re-enroll.
   */
  document: AuthFactorDocument;
  /** Plaintext secret, base32-encoded, for manual entry. Surfaced ONCE. */
  plaintextBase32: string;
  /** otpauth URI for QR rendering. Surfaced ONCE. */
  otpauthUri: string;
  envelope: EventEnvelope;
}

/**
 * `Identity.Mfa.Totp.Enroll` — mint a new TOTP factor.
 *
 * The dispatcher persists the factor; the caller surfaces the
 * plaintext secret + otpauth URI to the user EXACTLY ONCE.
 */
export async function handleTotpEnroll(
  cmd: TotpEnrollBeginCommand,
  eventStore: EventStore,
): Promise<TotpEnrollBeginResult> {
  const occurredAt = new Date().toISOString();
  const factorId = newAuthFactorId();
  const secret = generateTotpSecret();
  const encrypted = encryptSecret(secret, cmd.tenantId);
  const attrs: TotpFactorAttrs = {
    encryptedSecret: encrypted,
    encryptionKeyId: encryptionKeyIdForTenant(cmd.tenantId),
    issuer: cmd.issuer,
    accountLabel: cmd.accountLabel,
  };
  const document: AuthFactorDocument = {
    factorId,
    tenantId: cmd.tenantId,
    userId: cmd.userId,
    kind: 'totp',
    attrs,
    status: 'active',
    name: cmd.name,
    enrolledAt: occurredAt,
  };
  // The QR + secret are returned in-band — never persisted.
  const otpauthUri = buildOtpauthUri({
    issuer: cmd.issuer,
    accountLabel: cmd.accountLabel,
    secret,
  });
  // base32 the secret for manual entry (no padding).
  const { base32Encode } = await import('../crypto/totp.ts');
  const plaintextBase32 = base32Encode(secret);

  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.AuthFactorEnrolled',
    schemaId: 'domain.identity.auth_factor.enrolled.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.factor.enroll.${factorId}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.userId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${cmd.userId}`,
      `AuthFactor:${factorId}`,
    ],
    retentionTag: 'retention:1y',
    payload: { document, source: 'totp_enroll' },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document, plaintextBase32, otpauthUri };
}

// =====================================================================
// Challenge (verify presented code).
// =====================================================================

export interface TotpChallengeCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  factorId: string;
  presentedCode: string;
  /** Per-tenant lockout policy (default DEFAULT_IDENTITY_POLICY). */
  policy?: IdentityPolicy;
}

export interface TotpChallengeResult {
  envelope: EventEnvelope;
  document: AuthFactorDocument;
  /** True on success. False on bad code (also throws — see below). */
  ok: boolean;
}

/**
 * `Identity.Mfa.Totp.Challenge` — verify a presented TOTP code.
 *
 * On success: emits `Identity.MfaChallengeSucceeded`, resets failure
 * counter, advances `lastUsedCounter` (replay protection).
 *
 * On failure: increments failure counter; trips per-factor lockout
 * after `policy.factorLockoutThreshold` consecutive bad codes;
 * throws `TOTP_INVALID_CODE` (and `MFA_FACTOR_LOCKED` once the
 * threshold is met).
 */
export async function handleTotpChallenge(
  cmd: TotpChallengeCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<TotpChallengeResult> {
  const policy = cmd.policy ?? DEFAULT_IDENTITY_POLICY;
  const factor = await getAuthFactorEntity(entities, cmd.tenantId, cmd.factorId);
  if (!factor) {
    throw new IdentityError(
      codes.MFA_FACTOR_NOT_FOUND,
      `auth factor not found: ${cmd.factorId}`,
      404,
    );
  }
  if (factor.kind !== 'totp') {
    throw new IdentityError(
      codes.MFA_FACTOR_NOT_FOUND,
      `factor ${cmd.factorId} is not a TOTP factor (kind=${factor.kind})`,
      400,
    );
  }
  if (factor.status !== 'active') {
    throw new IdentityError(
      codes.MFA_FACTOR_LOCKED,
      `factor ${cmd.factorId} is in status ${factor.status}`,
      401,
    );
  }
  if (factor.lockedUntil && new Date(factor.lockedUntil).getTime() > Date.now()) {
    throw new IdentityError(
      codes.MFA_FACTOR_LOCKED,
      `factor is locked until ${factor.lockedUntil}`,
      401,
    );
  }
  const totpAttrs = factor.attrs as TotpFactorAttrs;
  let secret: Buffer;
  try {
    secret = decryptSecret(totpAttrs.encryptedSecret, cmd.tenantId);
  } catch (e) {
    throw new IdentityError(
      codes.MFA_CHALLENGE_INVALID,
      `failed to decrypt TOTP secret: ${(e as Error).message}`,
      500,
    );
  }
  const result = verifyTotp(secret, cmd.presentedCode, {
    ...(totpAttrs.lastUsedCounter !== undefined
      ? { lastUsedCounter: totpAttrs.lastUsedCounter }
      : {}),
  });
  const occurredAt = new Date().toISOString();

  if (!result.ok) {
    // Failure path: bump counter, possibly lock, emit anomaly.
    const failed = (totpAttrs.failedAttempts ?? 0) + 1;
    const willLock = failed >= policy.factorLockoutThreshold;
    const updatedAttrs: TotpFactorAttrs = {
      ...totpAttrs,
      failedAttempts: failed,
    };
    const updated: AuthFactorDocument = {
      ...factor,
      attrs: updatedAttrs,
      ...(willLock
        ? {
            status: 'locked',
            lockedUntil: new Date(
              Date.now() + policy.factorLockoutMinutes * 60 * 1000,
            ).toISOString(),
            endedAt: occurredAt,
            endReason: 'lockout',
          }
        : {}),
    };
    const envelope: EventEnvelope = {
      eventId: newEventId(),
      eventType: willLock ? 'Identity.MfaLockout' : 'Identity.MfaAnomaly',
      schemaId: willLock
        ? 'domain.identity.mfa.lockout.v1'
        : 'domain.identity.mfa.anomaly.v1',
      schemaVersion: 1,
      occurredAt,
      tenantId: cmd.tenantId,
      correlationId: cmd.correlationId,
      idempotencyKey: `identity.mfa.totp.${willLock ? 'lockout' : 'failure'}.${cmd.factorId}.${occurredAt}`,
      causationId: null,
      principalId: cmd.principalId,
      userId: factor.userId,
      cacheInvalidationTags: [
        `Tenant:${cmd.tenantId}`,
        `User:${factor.userId}`,
        `AuthFactor:${cmd.factorId}`,
      ],
      retentionTag: 'retention:1y',
      payload: {
        document: updated,
        reason: willLock ? 'totp_failure_threshold' : 'totp_invalid_code',
      },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    throw willLock
      ? new IdentityError(
          codes.MFA_FACTOR_LOCKED,
          `factor locked after ${failed} failures`,
          401,
        )
      : new IdentityError(codes.TOTP_INVALID_CODE, 'invalid TOTP code', 401);
  }

  // Success path: persist matched counter + reset failure counter.
  const updatedAttrs: TotpFactorAttrs = {
    ...totpAttrs,
    lastUsedCounter: result.matchedCounter ?? totpAttrs.lastUsedCounter ?? 0,
    failedAttempts: 0,
  };
  const updated: AuthFactorDocument = {
    ...factor,
    attrs: updatedAttrs,
    lastUsedAt: occurredAt,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.MfaChallengeSucceeded',
    schemaId: 'domain.identity.mfa.challenge_succeeded.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.mfa.totp.success.${cmd.factorId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: factor.userId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${factor.userId}`,
      `AuthFactor:${cmd.factorId}`,
    ],
    retentionTag: 'retention:1y',
    payload: { document: updated, method: 'totp' },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document: updated, ok: true };
}
