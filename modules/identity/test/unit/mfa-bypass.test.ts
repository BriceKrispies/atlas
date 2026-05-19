/**
 * Unit tests for MfaBypass handlers (Layer 1).
 * Combined: `Identity.MfaBypass.{Issue, Use}`.
 */
import { describe, it, expect } from 'vitest';
import { handleMfaBypassIssue, handleMfaBypassUse, IdentityError, identityErrorCodes, } from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';
describe('handleMfaBypassIssue', function () {
    it('emits MfaBypassIssued with retention:1y and exact cache tags', async function () {
        const fx = newFixture();
        const result = await handleMfaBypassIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'user-1',
        }, fx.events);
        expect(result.envelope.eventType).toBe('Identity.MfaBypassIssued');
        expect(result.envelope.retentionTag).toBe('retention:1y');
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `User:user-1`,
            `MfaBypass:${result.document.bypassId}`,
        ]);
        expect(result.document.status).toBe('pending');
        expect(result.document.issuedBy).toBe('admin');
    });
    it('plaintext secret never persists on the document', async function () {
        const fx = newFixture();
        const result = await handleMfaBypassIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'user-2',
        }, fx.events);
        expect(JSON.stringify(result.document)).not.toContain(result.plaintextSecret);
    });
    it('default TTL is 5 minutes', async function () {
        const fx = newFixture();
        const before = Date.now();
        const result = await handleMfaBypassIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'user-3',
        }, fx.events);
        const expiresMs = new Date(result.document.expiresAt).getTime();
        expect(expiresMs - before).toBeGreaterThanOrEqual(5 * 60 * 1000 - 5000);
        expect(expiresMs - before).toBeLessThanOrEqual(5 * 60 * 1000 + 5000);
    });
    it('honors custom ttlSeconds', async function () {
        const fx = newFixture();
        const before = Date.now();
        const result = await handleMfaBypassIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'user-4',
            ttlSeconds: 30,
        }, fx.events);
        const expiresMs = new Date(result.document.expiresAt).getTime();
        expect(expiresMs - before).toBeGreaterThanOrEqual(29 * 1000);
        expect(expiresMs - before).toBeLessThanOrEqual(35 * 1000);
    });
    it('rejects empty principalId with IDENTITY_INVALID (audit-trail requirement)', async function () {
        const fx = newFixture();
        await expect(handleMfaBypassIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: '',
            userId: 'user-1',
        }, fx.events)).rejects.toMatchObject({ code: identityErrorCodes.IDENTITY_INVALID });
        expect(fx.events.events).toHaveLength(0);
    });
});
describe('handleMfaBypassUse', function () {
    async function issue(fx: ReturnType<typeof newFixture>, userId = 'user-5') {
        const r = await handleMfaBypassIssue({
            tenantId: fx.tenantId,
            correlationId: 'i',
            principalId: 'admin',
            userId,
            ttlSeconds: 60,
        }, fx.events);
        await dispatchAll(fx);
        return r;
    }
    it('emits MfaBypassUsed and flips status to used', async function () {
        const fx = newFixture();
        const issued = await issue(fx);
        const result = await handleMfaBypassUse({
            tenantId: fx.tenantId,
            correlationId: 'u',
            principalId: 'user-5',
            userId: 'user-5',
            presentedSecret: issued.plaintextSecret,
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.MfaBypassUsed');
        expect(result.document.status).toBe('used');
        expect(result.document.usedAt).toBeDefined();
    });
    it('rejects unknown bypass with BYPASS_TOKEN_NOT_FOUND', async function () {
        const fx = newFixture();
        await expect(handleMfaBypassUse({
            tenantId: fx.tenantId,
            correlationId: 'u',
            principalId: 'user-1',
            userId: 'user-1',
            presentedSecret: 'totally-not-a-real-bypass-secret',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.BYPASS_TOKEN_NOT_FOUND });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects already-used bypass with BYPASS_TOKEN_USED on second redeem', async function () {
        const fx = newFixture();
        const issued = await issue(fx);
        await handleMfaBypassUse({
            tenantId: fx.tenantId,
            correlationId: 'u1',
            principalId: 'user-5',
            userId: 'user-5',
            presentedSecret: issued.plaintextSecret,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        await expect(handleMfaBypassUse({
            tenantId: fx.tenantId,
            correlationId: 'u2',
            principalId: 'user-5',
            userId: 'user-5',
            presentedSecret: issued.plaintextSecret,
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.BYPASS_TOKEN_USED });
    });
    it('rejects expired bypass (issuedAt + ttl in the past) with BYPASS_TOKEN_EXPIRED', async function () {
        const fx = newFixture();
        const issued = await handleMfaBypassIssue({
            tenantId: fx.tenantId,
            correlationId: 'i',
            principalId: 'admin',
            userId: 'user-6',
            ttlSeconds: 1,
        }, fx.events);
        await dispatchAll(fx);
        // Manually backdate expiresAt to simulate elapsed time.
        await fx.entities.put({
            tenantId: fx.tenantId,
            entityType: 'MfaBypass',
            entityId: issued.document.bypassId,
            attrs: {
                ...issued.document,
                expiresAt: new Date(Date.now() - 60000).toISOString(),
            },
        });
        await expect(handleMfaBypassUse({
            tenantId: fx.tenantId,
            correlationId: 'u',
            principalId: 'user-6',
            userId: 'user-6',
            presentedSecret: issued.plaintextSecret,
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.BYPASS_TOKEN_EXPIRED });
    });
    it('throws IdentityError instances for every rejection', async function () {
        const fx = newFixture();
        await expect(handleMfaBypassUse({
            tenantId: fx.tenantId,
            correlationId: 'u',
            principalId: 'user-1',
            userId: 'user-1',
            presentedSecret: 'fake',
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
    });
});
