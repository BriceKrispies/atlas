/**
 * Unit tests for `handleSessionRevoke` and `handleSessionRevokeAllForUser`
 * (Layer 1).
 *
 * Both handlers in one file — they share the same Identity.SessionEnded
 * shape and tenant-scoping concerns. Branch coverage focuses on:
 *   - exact envelope + cacheInvalidationTags
 *   - per-`reason` end-reason persistence
 *   - SESSION_NOT_FOUND on unknown / cross-tenant id (revoke)
 *   - idempotency: re-revoke succeeds (handler tolerates re-application)
 *   - revoke-all: empty when no active sessions; only ACTIVE included
 *     (already-revoked / evicted not re-revoked)
 *   - tenant scoping: tenant B sessions invisible to revoke-all in
 *     tenant A
 */
import { describe, it, expect } from '@atlas/test';
import { handleSessionIssue, handleSessionRevoke, handleSessionRevokeAllForUser, IdentityError, identityErrorCodes, } from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';
async function issue(fx: ReturnType<typeof newFixture>, userId = 'user-1'): Promise<string> {
    const result = await handleSessionIssue({
        tenantId: fx.tenantId,
        correlationId: 'seed',
        principalId: userId,
        userId,
    }, fx.events, fx.entities);
    await dispatchAll(fx);
    return result.document.sessionId;
}
describe('handleSessionRevoke — happy path', function () {
    it('emits Identity.SessionEnded with status=revoked and the reason persisted', async function () {
        const fx = newFixture();
        const sessionId = await issue(fx);
        const result = await handleSessionRevoke({
            tenantId: fx.tenantId,
            correlationId: 'corr-1',
            principalId: 'user-1',
            sessionId,
            reason: 'admin_revoke',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.SessionEnded');
        expect(result.envelope.schemaId).toBe('domain.identity.session.ended.v1');
        expect(result.document.status).toBe('revoked');
        expect(result.document.endReason).toBe('admin_revoke');
    });
    it('exact cacheInvalidationTags: Tenant + User + Session', async function () {
        const fx = newFixture();
        const sessionId = await issue(fx, 'user-2');
        const result = await handleSessionRevoke({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-2',
            sessionId,
            reason: 'admin_revoke',
        }, fx.events, fx.entities);
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `User:user-2`,
            `Session:${sessionId}`,
        ]);
    });
    it('payload carries the ended document and reason', async function () {
        const fx = newFixture();
        const sessionId = await issue(fx);
        const result = await handleSessionRevoke({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-1',
            sessionId,
            reason: 'admin_revoke',
        }, fx.events, fx.entities);
        const payload = result.envelope.payload;
        if (!payload || typeof payload !== 'object'
            || !('document' in payload) || !('reason' in payload)) {
            throw new Error('expected revoke event payload with document + reason');
        }
        const doc = payload.document;
        if (!doc || typeof doc !== 'object'
            || !('status' in doc) || !('endReason' in doc)) {
            throw new Error('expected payload.document with status + endReason');
        }
        expect(doc.status).toBe('revoked');
        expect(doc.endReason).toBe('admin_revoke');
        expect(payload.reason).toBe('admin_revoke');
    });
    it('is idempotent at the handler level — second revoke also succeeds', async function () {
        const fx = newFixture();
        const sessionId = await issue(fx);
        const first = await handleSessionRevoke({
            tenantId: fx.tenantId,
            correlationId: 'first',
            principalId: 'user-1',
            sessionId,
            reason: 'admin_revoke',
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        // Second revoke does not throw — handler tolerates re-application.
        const second = await handleSessionRevoke({
            tenantId: fx.tenantId,
            correlationId: 'second',
            principalId: 'user-1',
            sessionId,
            reason: 'admin_revoke',
        }, fx.events, fx.entities);
        expect(first.envelope.eventId).not.toBe(second.envelope.eventId);
        expect(second.document.status).toBe('revoked');
    });
});
describe('handleSessionRevoke — error paths', function () {
    it('rejects unknown sessionId with SESSION_NOT_FOUND', async function () {
        const fx = newFixture();
        await expect(handleSessionRevoke({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-1',
            sessionId: 'sess-fake',
            reason: 'admin_revoke',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.SESSION_NOT_FOUND });
        expect(fx.events.events).toHaveLength(0);
    });
    it("rejects cross-tenant revoke with SESSION_NOT_FOUND (defensive)", async function () {
        const fx = newFixture('tenant-a');
        // Issue in tenant B.
        const seeded = await handleSessionIssue({
            tenantId: 'tenant-b',
            correlationId: 'seed',
            principalId: 'user-1',
            userId: 'user-1',
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        // Try to revoke under tenant A.
        await expect(handleSessionRevoke({
            tenantId: 'tenant-a',
            correlationId: 'cross',
            principalId: 'user-1',
            sessionId: seeded.document.sessionId,
            reason: 'admin_revoke',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.SESSION_NOT_FOUND });
    });
    it('throws IdentityError instances', async function () {
        const fx = newFixture();
        await expect(handleSessionRevoke({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            sessionId: 'sess-fake',
            reason: 'admin_revoke',
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
    });
});
describe('handleSessionRevokeAllForUser', function () {
    it('emits one SessionEnded per active session for the user', async function () {
        const fx = newFixture();
        const a = await issue(fx, 'user-1');
        const b = await issue(fx, 'user-1');
        const c = await issue(fx, 'user-1');
        const result = await handleSessionRevokeAllForUser({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'user-1',
            reason: 'admin_revoke',
        }, fx.events, fx.entities);
        expect(result.envelopes).toHaveLength(3);
        expect(new Set(result.revokedSessionIds)).toEqual(new Set([a, b, c]));
        expect(result.envelopes.every(function (e) {
            return e.eventType === 'Identity.SessionEnded';
        })).toBe(true);
    });
    it('returns empty arrays when the user has no active sessions', async function () {
        const fx = newFixture();
        const result = await handleSessionRevokeAllForUser({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'user-with-no-sessions',
            reason: 'admin_revoke',
        }, fx.events, fx.entities);
        expect(result.envelopes).toEqual([]);
        expect(result.revokedSessionIds).toEqual([]);
    });
    it('does not re-revoke sessions that are already revoked', async function () {
        const fx = newFixture();
        const a = await issue(fx, 'user-1');
        const b = await issue(fx, 'user-1');
        // Pre-revoke `a`.
        await handleSessionRevoke({
            tenantId: fx.tenantId,
            correlationId: 'pre',
            principalId: 'user-1',
            sessionId: a,
            reason: 'admin_revoke',
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const result = await handleSessionRevokeAllForUser({
            tenantId: fx.tenantId,
            correlationId: 'all',
            principalId: 'admin',
            userId: 'user-1',
            reason: 'admin_revoke',
        }, fx.events, fx.entities);
        expect(result.revokedSessionIds).toEqual([b]);
    });
    it('emits cache tags including User:<userId> and Session:<sessionId> per envelope', async function () {
        const fx = newFixture();
        const sessionId = await issue(fx, 'user-1');
        const result = await handleSessionRevokeAllForUser({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'user-1',
            reason: 'admin_revoke',
        }, fx.events, fx.entities);
        expect(result.envelopes[0]?.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `User:user-1`,
            `Session:${sessionId}`,
        ]);
    });
});
describe('Session revoke — tenant scoping', function () {
    it("revoke-all in tenant A does not touch tenant B's sessions for the same userId", async function () {
        const fx = newFixture('tenant-a');
        // Seed sessions for shared-user in BOTH tenants.
        const aSession = await handleSessionIssue({
            tenantId: 'tenant-a',
            correlationId: 's',
            principalId: 'shared-user',
            userId: 'shared-user',
        }, fx.events, fx.entities);
        const bSession = await handleSessionIssue({
            tenantId: 'tenant-b',
            correlationId: 's',
            principalId: 'shared-user',
            userId: 'shared-user',
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const result = await handleSessionRevokeAllForUser({
            tenantId: 'tenant-a',
            correlationId: 'c',
            principalId: 'admin',
            userId: 'shared-user',
            reason: 'admin_revoke',
        }, fx.events, fx.entities);
        expect(result.revokedSessionIds).toEqual([aSession.document.sessionId]);
        expect(result.revokedSessionIds).not.toContain(bSession.document.sessionId);
    });
});
