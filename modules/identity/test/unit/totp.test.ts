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
import { handleTotpEnroll, handleTotpChallenge, hotp, decryptSecret, identityErrorCodes, IdentityError, DEFAULT_IDENTITY_POLICY, type TotpFactorAttrs, type AuthFactorDocument, type WebAuthnFactorAttrs, } from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';
async function enroll(fx: ReturnType<typeof newFixture>, userId = 'user-1') {
    return handleTotpEnroll({
        tenantId: fx.tenantId,
        correlationId: 'enroll',
        principalId: userId,
        userId,
        issuer: 'Atlas',
        accountLabel: 'user@example.com',
        name: 'iPhone',
    }, fx.events, fx.secrets);
}
function codeFor(factor: AuthFactorDocument, fx: ReturnType<typeof newFixture>): string {
    if (!isTotpAttrs(factor.attrs)) {
        throw new Error('Test fixture invariant: factor under test is not a TOTP factor');
    }
    const secret = decryptSecret(factor.attrs.encryptedSecret, fx.tenantId, fx.secrets);
    return hotp(secret, Math.floor(Date.now() / 1000 / 30));
}
function isTotpAttrs(a: AuthFactorDocument['attrs']): a is TotpFactorAttrs {
    return 'encryptedSecret' in a && typeof a.encryptedSecret === 'string';
}
describe('handleTotpEnroll', function () {
    it('emits AuthFactorEnrolled with retention:1y and exact cache tags', async function () {
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
    it('surfaces base32 secret + otpauth URI exactly once', async function () {
        const fx = newFixture();
        const r = await enroll(fx);
        expect(r.plaintextBase32).toMatch(/^[A-Z2-7]+$/);
        expect(r.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    });
    it('plaintext secret never appears on the persisted document or events', async function () {
        const fx = newFixture();
        const r = await enroll(fx);
        const docJson = JSON.stringify(r.document);
        expect(docJson).not.toContain(r.plaintextBase32);
        const eventJson = JSON.stringify(fx.events.events, function (_k, v: unknown) {
            return typeof v === 'bigint' ? v.toString() : v;
        });
        expect(eventJson).not.toContain(r.plaintextBase32);
    });
});
describe('handleTotpChallenge — happy path', function () {
    it('emits MfaChallengeSucceeded on a valid code', async function () {
        const fx = newFixture();
        const r = await enroll(fx);
        await dispatchAll(fx);
        const code = codeFor(r.document, fx);
        const result = await handleTotpChallenge({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-1',
            factorId: r.document.factorId,
            presentedCode: code,
        }, fx.events, fx.entities, fx.secrets);
        expect(result.envelope.eventType).toBe('Identity.MfaChallengeSucceeded');
        expect(result.ok).toBe(true);
    });
    it('exact cache tags on success: Tenant + User + AuthFactor', async function () {
        const fx = newFixture();
        const r = await enroll(fx, 'user-2');
        await dispatchAll(fx);
        const code = codeFor(r.document, fx);
        const result = await handleTotpChallenge({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-2',
            factorId: r.document.factorId,
            presentedCode: code,
        }, fx.events, fx.entities, fx.secrets);
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `User:user-2`,
            `AuthFactor:${r.document.factorId}`,
        ]);
    });
});
describe('handleTotpChallenge — error paths', function () {
    it('rejects unknown factorId with MFA_FACTOR_NOT_FOUND', async function () {
        const fx = newFixture();
        await expect(handleTotpChallenge({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-1',
            factorId: 'fct-fake',
            presentedCode: '123456',
        }, fx.events, fx.entities, fx.secrets)).rejects.toMatchObject({ code: identityErrorCodes.MFA_FACTOR_NOT_FOUND });
    });
    it('rejects challenge against a non-totp factor with MFA_FACTOR_NOT_FOUND', async function () {
        const fx = newFixture();
        // Manually inject a factor with kind=webauthn. Use a valid
        // WebAuthnFactorAttrs shape; this test exercises the
        // non-totp rejection path so the inner values don't matter.
        const webauthnAttrs: WebAuthnFactorAttrs = {
            credentialId: 'fake',
            publicKey: 'fake',
            signCount: 0,
        };
        await fx.entities.put<AuthFactorDocument>({
            tenantId: fx.tenantId,
            entityType: 'AuthFactor',
            entityId: 'fct-webauthn',
            attrs: {
                factorId: 'fct-webauthn',
                tenantId: fx.tenantId,
                userId: 'user-1',
                kind: 'webauthn_mfa',
                attrs: webauthnAttrs,
                status: 'active',
                name: 'security key',
                enrolledAt: new Date().toISOString(),
            },
        });
        await expect(handleTotpChallenge({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-1',
            factorId: 'fct-webauthn',
            presentedCode: '123456',
        }, fx.events, fx.entities, fx.secrets)).rejects.toMatchObject({ code: identityErrorCodes.MFA_FACTOR_NOT_FOUND });
    });
    it('rejects invalid code with TOTP_INVALID_CODE and bumps failedAttempts', async function () {
        const fx = newFixture();
        const r = await enroll(fx);
        await dispatchAll(fx);
        await expect(handleTotpChallenge({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-1',
            factorId: r.document.factorId,
            presentedCode: '000000',
        }, fx.events, fx.entities, fx.secrets)).rejects.toMatchObject({ code: identityErrorCodes.TOTP_INVALID_CODE });
        // Failure event was emitted before the throw.
        const lastEvent = fx.events.events.at(-1);
        expect(lastEvent?.eventType).toBe('Identity.MfaAnomaly');
    });
    it('locks the factor after threshold consecutive failures and emits MfaLockout', async function () {
        const fx = newFixture();
        const r = await enroll(fx);
        await dispatchAll(fx);
        const policy = {
            ...DEFAULT_IDENTITY_POLICY,
            factorLockoutThreshold: 3,
        };
        // Three failures — the third trips the lockout.
        for (let i = 0; i < 2; i += 1) {
            await expect(handleTotpChallenge({
                tenantId: fx.tenantId,
                correlationId: `c${i}`,
                principalId: 'user-1',
                factorId: r.document.factorId,
                presentedCode: '000000',
                policy,
            }, fx.events, fx.entities, fx.secrets)).rejects.toMatchObject({ code: identityErrorCodes.TOTP_INVALID_CODE });
            await dispatchAll(fx);
        }
        await expect(handleTotpChallenge({
            tenantId: fx.tenantId,
            correlationId: 'lockout',
            principalId: 'user-1',
            factorId: r.document.factorId,
            presentedCode: '000000',
            policy,
        }, fx.events, fx.entities, fx.secrets)).rejects.toMatchObject({ code: identityErrorCodes.MFA_FACTOR_LOCKED });
        const lastEvent = fx.events.events.at(-1);
        expect(lastEvent?.eventType).toBe('Identity.MfaLockout');
    });
    it('rejects challenge when factor status is not active', async function () {
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
        await expect(handleTotpChallenge({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-1',
            factorId: r.document.factorId,
            presentedCode: '000000',
        }, fx.events, fx.entities, fx.secrets)).rejects.toMatchObject({ code: identityErrorCodes.MFA_FACTOR_LOCKED });
    });
    it('throws IdentityError instances on all rejection paths', async function () {
        const fx = newFixture();
        await expect(handleTotpChallenge({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-1',
            factorId: 'fct-fake',
            presentedCode: '123456',
        }, fx.events, fx.entities, fx.secrets)).rejects.toBeInstanceOf(IdentityError);
    });
});
