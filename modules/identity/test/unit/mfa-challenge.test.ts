/**
 * Unit tests for `handleMfaChallengeSubmit` (Layer 1).
 *
 * Dispatch layer over four factor handlers (TOTP / WebAuthn /
 * RecoveryCode / Bypass). Branch coverage focuses on the dispatch
 * itself: session-state guards, method/payload mismatch errors, and
 * the TOTP success path (one factor flavor exercised end-to-end).
 *
 * Per-factor branch coverage lives in `unit/totp.test.ts`,
 * `unit/recovery-code.test.ts`, `unit/mfa-bypass.test.ts`,
 * `unit/webauthn.test.ts`. WebAuthn requires real CBOR-encoded
 * assertions; that branch is covered in `a5-acceptance.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  handleSessionIssue,
  handleTotpEnroll,
  handleMfaChallengeSubmit,
  hotp,
  decryptSecret,
  IdentityError,
  identityErrorCodes,
  type AuthSessionDocument,
  type TotpFactorAttrs,
  type AuthFactorDocument,
} from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';

async function setup(fx: ReturnType<typeof newFixture>, userId = 'user-1') {
  // dispatchAll replays every appended event from the start, so
  // running it after a manual put would overwrite the put. Sequence:
  //   1. enroll TOTP (this is the only handler whose dispatcher we
  //      need to run so the AuthFactor row exists for handleTotpChallenge).
  //   2. dispatchAll — materialises the AuthFactor.
  //   3. Manually inject an AuthSession with status='mfa_pending'
  //      directly via the entity store (bypassing handleSessionIssue
  //      so SessionIssued doesn't enter the event log and survive a
  //      future replay).
  const enroll = await handleTotpEnroll(
    {
      tenantId: fx.tenantId,
      correlationId: 'seed',
      principalId: userId,
      userId,
      issuer: 'Atlas',
      accountLabel: 'user@example.com',
      name: 'iPhone',
    },
    fx.events,
  );
  await dispatchAll(fx);
  const sessionId = `sess-mfa-${userId}`;
  const now = new Date().toISOString();
  await fx.entities.put({
    tenantId: fx.tenantId,
    entityType: 'AuthSession',
    entityId: sessionId,
    attrs: {
      sessionId,
      tenantId: fx.tenantId,
      userId,
      refreshTokenHash: 'placeholder',
      refreshTokenLookup: 'placeholder',
      accessTokenHash: 'placeholder',
      accessTokenLookup: 'placeholder',
      accessExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
      issuedAt: now,
      lastRefreshedAt: now,
      lastSeenAt: now,
      hardExpiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      status: 'mfa_pending',
    },
  });
  return { sessionId, factor: enroll.document };
}

function totpCode(factor: AuthFactorDocument, tenantId: string): string {
  const attrs = factor.attrs as TotpFactorAttrs;
  const secret = decryptSecret(attrs.encryptedSecret, tenantId);
  return hotp(secret, Math.floor(Date.now() / 1000 / 30));
}

describe('handleMfaChallengeSubmit — happy path (TOTP)', () => {
  it('flips mfa_pending session to active and emits SessionMfaSatisfied', async () => {
    const fx = newFixture();
    const { sessionId, factor } = await setup(fx);
    const result = await handleMfaChallengeSubmit(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'user-1',
        sessionId,
        method: 'totp',
        totp: {
          factorId: factor.factorId,
          presentedCode: totpCode(factor, fx.tenantId),
        },
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.SessionMfaSatisfied');
    expect(result.document.status).toBe('active');
  });
});

describe('handleMfaChallengeSubmit — session-state guards', () => {
  it('rejects unknown sessionId with SESSION_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handleMfaChallengeSubmit(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          sessionId: 'sess-fake',
          method: 'totp',
          totp: { factorId: 'fct-x', presentedCode: '123456' },
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SESSION_NOT_FOUND });
  });

  it('returns idempotent NoOp envelope for an already-active session', async () => {
    const fx = newFixture();
    const issued = await handleSessionIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 's',
        principalId: 'user-1',
        userId: 'user-1',
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    // Session is already active (no flip to mfa_pending).
    const result = await handleMfaChallengeSubmit(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'user-1',
        sessionId: issued.document.sessionId,
        method: 'totp',
        totp: { factorId: 'whatever', presentedCode: '000000' },
      },
      fx.events,
      fx.entities,
    );
    // The handler returns a NoOp event without re-running the factor proof.
    expect(result.envelope.eventType).toContain('NoOp');
    expect(result.document.status).toBe('active');
  });

  it('rejects revoked / expired sessions with SESSION_REVOKED', async () => {
    const fx = newFixture();
    const issued = await handleSessionIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 's',
        principalId: 'user-1',
        userId: 'user-1',
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await fx.entities.put({
      tenantId: fx.tenantId,
      entityType: 'AuthSession',
      entityId: issued.document.sessionId,
      attrs: { ...issued.document, status: 'revoked' },
    });
    await expect(
      handleMfaChallengeSubmit(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          sessionId: issued.document.sessionId,
          method: 'totp',
          totp: { factorId: 'x', presentedCode: '000000' },
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SESSION_REVOKED });
  });
});

describe('handleMfaChallengeSubmit — method / payload mismatch', () => {
  async function pendingSessionId(
    fx: ReturnType<typeof newFixture>,
  ): Promise<string> {
    const { sessionId } = await setup(fx);
    return sessionId;
  }

  it('rejects method=totp with missing totp params', async () => {
    const fx = newFixture();
    const sessionId = await pendingSessionId(fx);
    await expect(
      handleMfaChallengeSubmit(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          sessionId,
          method: 'totp',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.MFA_CHALLENGE_INVALID });
  });

  it('rejects method=webauthn with missing webauthn params', async () => {
    const fx = newFixture();
    const sessionId = await pendingSessionId(fx);
    await expect(
      handleMfaChallengeSubmit(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          sessionId,
          method: 'webauthn',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.MFA_CHALLENGE_INVALID });
  });

  it('rejects method=recovery_code with missing recoveryCode params', async () => {
    const fx = newFixture();
    const sessionId = await pendingSessionId(fx);
    await expect(
      handleMfaChallengeSubmit(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          sessionId,
          method: 'recovery_code',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.MFA_CHALLENGE_INVALID });
  });

  it('rejects method=bypass with missing bypass params', async () => {
    const fx = newFixture();
    const sessionId = await pendingSessionId(fx);
    await expect(
      handleMfaChallengeSubmit(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          sessionId,
          method: 'bypass',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.MFA_CHALLENGE_INVALID });
  });

  it('throws IdentityError instances for missing-payload rejections', async () => {
    const fx = newFixture();
    const sessionId = await pendingSessionId(fx);
    await expect(
      handleMfaChallengeSubmit(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          sessionId,
          method: 'totp',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});
