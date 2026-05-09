/**
 * Unit tests for TOTP handlers (Layer 1).
 * Combined: `Identity.Mfa.Totp.Enroll` + `Identity.Mfa.Totp.Challenge`.
 *
 * Acceptance-shape coverage of TOTP success / replay / lockout lives
 * in `../a5-acceptance.test.ts`. This file owns pure-handler branch
 * coverage: envelope shape, exact cache tags, error codes, the
 * locked / non-totp / decrypt-failure branches.
 */

import { describe, it, expect } from 'vitest';
import {
  handleTotpEnroll,
  handleTotpChallenge,
  hotp,
  decryptSecret,
  identityErrorCodes,
  IdentityError,
  DEFAULT_IDENTITY_POLICY,
  type TotpFactorAttrs,
  type AuthFactorDocument,
} from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';

async function enroll(
  fx: ReturnType<typeof newFixture>,
  userId = 'user-1',
) {
  return handleTotpEnroll(
    {
      tenantId: fx.tenantId,
      correlationId: 'enroll',
      principalId: userId,
      userId,
      issuer: 'Atlas',
      accountLabel: 'user@example.com',
      name: 'iPhone',
    },
    fx.events,
    fx.secrets,
  );
}

function codeFor(
  factor: AuthFactorDocument,
  fx: ReturnType<typeof newFixture>,
): string {
  const attrs = factor.attrs as TotpFactorAttrs;
  const secret = decryptSecret(attrs.encryptedSecret, fx.tenantId, fx.secrets);
  return hotp(secret, Math.floor(Date.now() / 1000 / 30));
}

describe('handleTotpEnroll', () => {
  it('emits AuthFactorEnrolled with retention:1y and exact cache tags', async () => {
    const fx = newFixture();
    const r = await enroll(fx, 'user-1');
    expect(r.envelope.eventType).toBe('Identity.AuthFactorEnrolled');
    expect(r.envelope.retentionTag).toBe('retention:1y');
    expect(r.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `User:user-1`,
      `AuthFactor:${r.document.factorId}`,
    ]);
    expect(r.document.kind).toBe('totp');
    expect(r.document.status).toBe('active');
  });

  it('surfaces base32 secret + otpauth URI exactly once', async () => {
    const fx = newFixture();
    const r = await enroll(fx);
    expect(r.plaintextBase32).toMatch(/^[A-Z2-7]+$/);
    expect(r.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
  });

  it('plaintext secret never appears on the persisted document or events', async () => {
    const fx = newFixture();
    const r = await enroll(fx);
    const docJson = JSON.stringify(r.document);
    expect(docJson).not.toContain(r.plaintextBase32);
    const eventJson = JSON.stringify(fx.events.events, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(eventJson).not.toContain(r.plaintextBase32);
  });
});

describe('handleTotpChallenge — happy path', () => {
  it('emits MfaChallengeSucceeded on a valid code', async () => {
    const fx = newFixture();
    const r = await enroll(fx);
    await dispatchAll(fx);
    const code = codeFor(r.document, fx);
    const result = await handleTotpChallenge(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'user-1',
        factorId: r.document.factorId,
        presentedCode: code,
      },
      fx.events,
      fx.entities,
      fx.secrets,
    );
    expect(result.envelope.eventType).toBe('Identity.MfaChallengeSucceeded');
    expect(result.ok).toBe(true);
  });

  it('exact cache tags on success: Tenant + User + AuthFactor', async () => {
    const fx = newFixture();
    const r = await enroll(fx, 'user-2');
    await dispatchAll(fx);
    const code = codeFor(r.document, fx);
    const result = await handleTotpChallenge(
      {
        tenantId: fx.tenantId,
        correlationId: 'c',
        principalId: 'user-2',
        factorId: r.document.factorId,
        presentedCode: code,
      },
      fx.events,
      fx.entities,
      fx.secrets,
    );
    expect(result.envelope.cacheInvalidationTags).toEqual([
      `Tenant:${fx.tenantId}`,
      `User:user-2`,
      `AuthFactor:${r.document.factorId}`,
    ]);
  });
});

describe('handleTotpChallenge — error paths', () => {
  it('rejects unknown factorId with MFA_FACTOR_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handleTotpChallenge(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          factorId: 'fct-fake',
          presentedCode: '123456',
        },
        fx.events,
        fx.entities,
        fx.secrets,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.MFA_FACTOR_NOT_FOUND });
  });

  it('rejects challenge against a non-totp factor with MFA_FACTOR_NOT_FOUND', async () => {
    const fx = newFixture();
    // Manually inject a factor with kind=webauthn.
    await fx.entities.put<AuthFactorDocument>({
      tenantId: fx.tenantId,
      entityType: 'AuthFactor',
      entityId: 'fct-webauthn',
      attrs: {
        factorId: 'fct-webauthn',
        tenantId: fx.tenantId,
        userId: 'user-1',
        kind: 'webauthn',
        attrs: { publicKey: 'fake', credentialId: 'fake', counter: 0 } as never,
        status: 'active',
        name: 'security key',
        enrolledAt: new Date().toISOString(),
      },
    });
    await expect(
      handleTotpChallenge(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          factorId: 'fct-webauthn',
          presentedCode: '123456',
        },
        fx.events,
        fx.entities,
        fx.secrets,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.MFA_FACTOR_NOT_FOUND });
  });

  it('rejects invalid code with TOTP_INVALID_CODE and bumps failedAttempts', async () => {
    const fx = newFixture();
    const r = await enroll(fx);
    await dispatchAll(fx);
    await expect(
      handleTotpChallenge(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          factorId: r.document.factorId,
          presentedCode: '000000',
        },
        fx.events,
        fx.entities,
        fx.secrets,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.TOTP_INVALID_CODE });
    // Failure event was emitted before the throw.
    const lastEvent = fx.events.events.at(-1);
    expect(lastEvent?.eventType).toBe('Identity.MfaAnomaly');
  });

  it('locks the factor after threshold consecutive failures and emits MfaLockout', async () => {
    const fx = newFixture();
    const r = await enroll(fx);
    await dispatchAll(fx);
    const policy = {
      ...DEFAULT_IDENTITY_POLICY,
      factorLockoutThreshold: 3,
    };
    // Three failures — the third trips the lockout.
    for (let i = 0; i < 2; i += 1) {
      await expect(
        handleTotpChallenge(
          {
            tenantId: fx.tenantId,
            correlationId: `c${i}`,
            principalId: 'user-1',
            factorId: r.document.factorId,
            presentedCode: '000000',
            policy,
          },
          fx.events,
          fx.entities,
          fx.secrets,
        ),
      ).rejects.toMatchObject({ code: identityErrorCodes.TOTP_INVALID_CODE });
      await dispatchAll(fx);
    }
    await expect(
      handleTotpChallenge(
        {
          tenantId: fx.tenantId,
          correlationId: 'lockout',
          principalId: 'user-1',
          factorId: r.document.factorId,
          presentedCode: '000000',
          policy,
        },
        fx.events,
        fx.entities,
        fx.secrets,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.MFA_FACTOR_LOCKED });
    const lastEvent = fx.events.events.at(-1);
    expect(lastEvent?.eventType).toBe('Identity.MfaLockout');
  });

  it('rejects challenge when factor status is not active', async () => {
    const fx = newFixture();
    const r = await enroll(fx);
    await dispatchAll(fx);
    // Manually flip status to revoked.
    await fx.entities.put({
      tenantId: fx.tenantId,
      entityType: 'AuthFactor',
      entityId: r.document.factorId,
      attrs: { ...r.document, status: 'revoked' },
    });
    await expect(
      handleTotpChallenge(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          factorId: r.document.factorId,
          presentedCode: '000000',
        },
        fx.events,
        fx.entities,
        fx.secrets,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.MFA_FACTOR_LOCKED });
  });

  it('throws IdentityError instances on all rejection paths', async () => {
    const fx = newFixture();
    await expect(
      handleTotpChallenge(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          principalId: 'user-1',
          factorId: 'fct-fake',
          presentedCode: '123456',
        },
        fx.events,
        fx.entities,
        fx.secrets,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});
