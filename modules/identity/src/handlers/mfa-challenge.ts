/**
 * `Identity.MfaChallenge.Submit` — promote an `mfa_pending`
 * AuthSession to `'active'` when the user successfully redeems any
 * configured factor.
 *
 * Accepts any of the four factor flavors the rest of A5 ships:
 *   - TOTP (factorId + presentedCode)
 *   - WebAuthn 2FA (challengeId + assertion response)
 *   - Recovery code (presentedCode)
 *   - MfaBypass token (presentedSecret)
 *
 * The handler delegates to the underlying factor handler for the
 * actual proof verification, then on success persists the session
 * flip + emits `Identity.SessionMfaSatisfied`.
 *
 * The route layer can call this directly OR have the SPA submit a
 * factor-specific challenge first and then call Submit with the
 * envelope of the success event — for now the handler accepts the
 * factor proofs inline so a single round-trip suffices.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  AuthSessionDocument,
  IdentityPolicy,
} from '../types.ts';
import { newEventId } from '../ids.ts';
import { getSessionEntity, putSessionEntity } from '../entities/auth-session.ts';
import { handleTotpChallenge } from './totp.ts';
import { handleWebAuthnAssertFinish } from './webauthn-assert.ts';
import { handleRedeemRecoveryCode } from './recovery-code.ts';
import { handleMfaBypassUse } from './mfa-bypass.ts';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

export type MfaChallengeMethod = 'totp' | 'webauthn' | 'recovery_code' | 'bypass';

export interface MfaChallengeSubmitCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  /** Session in `mfa_pending` status that the challenge promotes. */
  sessionId: string;
  method: MfaChallengeMethod;
  /** TOTP path: factorId + presentedCode. */
  totp?: { factorId: string; presentedCode: string };
  /** WebAuthn path: challengeId + assertion. */
  webauthn?: {
    challengeId: string;
    response: AuthenticationResponseJSON;
    expectedOrigin: string;
    rpId: string;
  };
  /** Recovery-code path: just the plaintext code. */
  recoveryCode?: { presentedCode: string };
  /** Bypass path: the bypass secret. */
  bypass?: { presentedSecret: string };
  policy?: IdentityPolicy;
}

export interface MfaChallengeSubmitResult {
  /** Primary: SessionMfaSatisfied (session flipped to active). */
  envelope: EventEnvelope;
  /** Follow events from the underlying factor verify. */
  follow: ReadonlyArray<EventEnvelope>;
  document: AuthSessionDocument;
}

export async function handleMfaChallengeSubmit(
  cmd: MfaChallengeSubmitCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<MfaChallengeSubmitResult> {
  const session = await getSessionEntity(entities, cmd.tenantId, cmd.sessionId);
  if (!session) {
    throw new IdentityError(
      codes.SESSION_NOT_FOUND,
      `session not found: ${cmd.sessionId}`,
      404,
    );
  }
  if (session.status !== 'mfa_pending') {
    // Idempotent for already-active sessions: return the session as-is
    // with a synthetic NoOp envelope.
    if (session.status === 'active') {
      return idempotentNoOp(cmd, session);
    }
    throw new IdentityError(
      codes.SESSION_REVOKED,
      `session ${cmd.sessionId} is in status ${session.status}, expected mfa_pending`,
      401,
    );
  }

  const follow: EventEnvelope[] = [];
  switch (cmd.method) {
    case 'totp': {
      if (!cmd.totp) {
        throw new IdentityError(
          codes.MFA_CHALLENGE_INVALID,
          'method=totp requires totp.{factorId,presentedCode}',
          400,
        );
      }
      const r = await handleTotpChallenge(
        {
          tenantId: cmd.tenantId,
          correlationId: cmd.correlationId,
          principalId: cmd.principalId,
          factorId: cmd.totp.factorId,
          presentedCode: cmd.totp.presentedCode,
          ...(cmd.policy !== undefined ? { policy: cmd.policy } : {}),
        },
        eventStore,
        entities,
      );
      follow.push(r.envelope);
      break;
    }
    case 'webauthn': {
      if (!cmd.webauthn) {
        throw new IdentityError(
          codes.MFA_CHALLENGE_INVALID,
          'method=webauthn requires webauthn.*',
          400,
        );
      }
      const r = await handleWebAuthnAssertFinish(
        {
          tenantId: cmd.tenantId,
          correlationId: cmd.correlationId,
          principalId: cmd.principalId,
          challengeId: cmd.webauthn.challengeId,
          response: cmd.webauthn.response,
          expectedOrigin: cmd.webauthn.expectedOrigin,
          rpId: cmd.webauthn.rpId,
          factorKind: 'webauthn_mfa',
        },
        eventStore,
        entities,
      );
      // The asserted user must match the session's user — defends
      // against "log in as A's primary then redeem B's WebAuthn".
      if (r.userId !== session.userId) {
        throw new IdentityError(
          codes.MFA_CHALLENGE_INVALID,
          'WebAuthn credential belongs to a different user',
          403,
        );
      }
      follow.push(r.envelope);
      break;
    }
    case 'recovery_code': {
      if (!cmd.recoveryCode) {
        throw new IdentityError(
          codes.MFA_CHALLENGE_INVALID,
          'method=recovery_code requires recoveryCode.presentedCode',
          400,
        );
      }
      const r = await handleRedeemRecoveryCode(
        {
          tenantId: cmd.tenantId,
          correlationId: cmd.correlationId,
          principalId: cmd.principalId,
          userId: session.userId,
          presentedCode: cmd.recoveryCode.presentedCode,
        },
        eventStore,
        entities,
      );
      follow.push(r.envelope);
      break;
    }
    case 'bypass': {
      if (!cmd.bypass) {
        throw new IdentityError(
          codes.MFA_CHALLENGE_INVALID,
          'method=bypass requires bypass.presentedSecret',
          400,
        );
      }
      const r = await handleMfaBypassUse(
        {
          tenantId: cmd.tenantId,
          correlationId: cmd.correlationId,
          principalId: cmd.principalId,
          userId: session.userId,
          presentedSecret: cmd.bypass.presentedSecret,
        },
        eventStore,
        entities,
      );
      follow.push(r.envelope);
      break;
    }
    default: {
      throw new IdentityError(
        codes.MFA_CHALLENGE_INVALID,
        `unknown method: ${String(cmd.method)}`,
        400,
      );
    }
  }

  // Promote the session.
  const occurredAt = new Date().toISOString();
  const promoted: AuthSessionDocument = {
    ...session,
    status: 'active',
    lastSeenAt: occurredAt,
  };
  await putSessionEntity(entities, promoted);
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.SessionMfaSatisfied',
    schemaId: 'domain.identity.session.mfa_satisfied.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.session.mfa-satisfied.${cmd.sessionId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: session.userId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${session.userId}`,
      `Session:${cmd.sessionId}`,
    ],
    retentionTag: 'retention:1y',
    payload: { document: promoted, method: cmd.method },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, follow, document: promoted };
}

function idempotentNoOp(
  cmd: MfaChallengeSubmitCommand,
  session: AuthSessionDocument,
): MfaChallengeSubmitResult {
  return {
    envelope: {
      eventId: newEventId(),
      eventType: 'Identity.SessionMfaSatisfied.NoOp',
      schemaId: 'domain.identity.session.mfa_satisfied.noop.v1',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      tenantId: cmd.tenantId,
      correlationId: cmd.correlationId,
      idempotencyKey: `identity.session.mfa-noop.${cmd.sessionId}.${Date.now()}`,
      causationId: null,
      principalId: cmd.principalId,
      userId: session.userId,
      cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `Session:${cmd.sessionId}`],
      retentionTag: 'retention:1y',
      payload: { sessionId: cmd.sessionId, alreadyActive: true },
    },
    follow: [],
    document: session,
  };
}
