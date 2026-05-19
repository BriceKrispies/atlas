/**
 * AuthSession handler tests.
 *
 * Covers Issue / Refresh / Revoke / RevokeAllForUser end-to-end against
 * in-memory adapters. Asserts:
 *   - rotation in place (sessionId stable)
 *   - reuse-detection within and outside the grace window
 *   - hard-timeout + idle-timeout enforcement
 *   - concurrent-session eviction (oldest-first)
 *   - I12: dispatcher reproduces post-state from event log
 */
import { describe, it, expect } from 'vitest';
import type { EventEnvelope } from '@atlas/platform-core';
import { handleSessionIssue, handleSessionRefresh, handleSessionRevoke, handleSessionRevokeAllForUser, getSessionEntity, listActiveSessionsForUser, IdentityError, identityErrorCodes, DEFAULT_SESSION_POLICY, hashSecret, type AuthSessionDocument, } from '../src/index.ts';
import { newFixture, dispatchAll } from './lib/fixtures.ts';
/** Type-guard form of the record check — flips `unknown` to a record. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
/** Reads a record-shaped payload, throwing if the shape is wrong. */
function payloadRecord(env: EventEnvelope): Record<string, unknown> {
    if (!isRecord(env.payload)) {
        throw new Error(`expected object-shaped payload on ${env.eventType} (${env.eventId})`);
    }
    return env.payload;
}
describe('Identity.AuthSession.Issue', function () {
    it('mints session, returns plaintext + cookie payload, persists', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c-1',
            principalId: null,
            userId: 'usr-alice',
            ip: '127.0.0.1',
            userAgent: 'test-agent',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.SessionIssued');
        expect(result.plaintextRefreshToken.length).toBeGreaterThan(20);
        expect(result.plaintextAccessToken.length).toBeGreaterThan(20);
        expect(result.cookiePayload).toBe(`${result.document.sessionId}.${result.plaintextRefreshToken}`);
        expect(result.document.refreshTokenHash).toBe(hashSecret(result.plaintextRefreshToken));
        expect(result.document.status).toBe('active');
        expect(result.document.ip).toBe('127.0.0.1');
        await dispatchAll(fx);
        const stored = await getSessionEntity(fx.entities, fx.tenantId, result.document.sessionId);
        expect(stored?.status).toBe('active');
    });
    it('evicts oldest session when at concurrent-cap', async function () {
        const fx = newFixture();
        const policy = { ...DEFAULT_SESSION_POLICY, maxConcurrentSessions: 2 };
        const first = await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice', policy }, fx.events, fx.entities);
        await dispatchAll(fx);
        // Force a tiny delay so issuedAt timestamps differ deterministically.
        await new Promise(function (r) {
            return setTimeout(r, 5);
        });
        const second = await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c2', principalId: null, userId: 'usr-alice', policy }, fx.events, fx.entities);
        await dispatchAll(fx);
        await new Promise(function (r) {
            return setTimeout(r, 5);
        });
        const third = await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c3', principalId: null, userId: 'usr-alice', policy }, fx.events, fx.entities);
        expect(third.follow.map(function (e) {
            return e.eventType;
        })).toEqual(['Identity.SessionEnded']);
        const evictedFollow = third.follow[0];
        if (!evictedFollow)
            throw new Error('expected SessionEnded follow event');
        expect(payloadRecord(evictedFollow)['reason']).toBe('evicted');
        await dispatchAll(fx);
        // After eviction: only 2 active sessions for the user — the one
        // we just issued + the second. The first was evicted.
        const active = await listActiveSessionsForUser(fx.entities, fx.tenantId, 'usr-alice');
        expect(active.map(function (s) {
            return s.sessionId;
        }).sort()).toEqual([second.document.sessionId, third.document.sessionId].sort());
        const evictedRow = await getSessionEntity(fx.entities, fx.tenantId, first.document.sessionId);
        expect(evictedRow?.status).toBe('evicted');
    });
});
describe('Identity.AuthSession.Refresh', function () {
    it('rotates tokens; sessionId stable; previousRefreshTokenHash set', async function () {
        const fx = newFixture();
        const issued = await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice' }, fx.events, fx.entities);
        await dispatchAll(fx);
        const refreshed = await handleSessionRefresh({
            tenantId: fx.tenantId,
            correlationId: 'c2',
            sessionId: issued.document.sessionId,
            presentedRefreshSecret: issued.plaintextRefreshToken,
        }, fx.events, fx.entities);
        expect(refreshed.envelope.eventType).toBe('Identity.SessionRefreshed');
        expect(refreshed.document?.sessionId).toBe(issued.document.sessionId);
        expect(refreshed.document?.refreshTokenHash).not.toBe(issued.document.refreshTokenHash);
        expect(refreshed.document?.previousRefreshTokenHash).toBe(issued.document.refreshTokenHash);
        expect(refreshed.plaintextRefreshToken).not.toBe(issued.plaintextRefreshToken);
    });
    it('rejects unknown sessionId with SESSION_NOT_FOUND', async function () {
        const fx = newFixture();
        await expect(handleSessionRefresh({
            tenantId: fx.tenantId,
            correlationId: 'c',
            sessionId: 'ses-nope',
            presentedRefreshSecret: 'whatever',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.SESSION_NOT_FOUND });
    });
    it('rejects wrong refresh secret with SESSION_NOT_FOUND (no leak)', async function () {
        const fx = newFixture();
        const issued = await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice' }, fx.events, fx.entities);
        await dispatchAll(fx);
        await expect(handleSessionRefresh({
            tenantId: fx.tenantId,
            correlationId: 'c2',
            sessionId: issued.document.sessionId,
            presentedRefreshSecret: 'wrong-secret-totally-not-the-real-one-aaaa',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.SESSION_NOT_FOUND });
    });
    it('reuse OUTSIDE grace triggers RevokeAllForUser + SessionAnomaly', async function () {
        const fx = newFixture();
        const policy = { ...DEFAULT_SESSION_POLICY, refreshGraceSeconds: 0 };
        const issued = await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice', policy }, fx.events, fx.entities);
        await dispatchAll(fx);
        // First refresh succeeds.
        await handleSessionRefresh({
            tenantId: fx.tenantId,
            correlationId: 'c2',
            sessionId: issued.document.sessionId,
            presentedRefreshSecret: issued.plaintextRefreshToken,
            policy,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        // Second issue: another active session for the same user (the one
        // about to be defensively revoked alongside the original).
        const sibling = await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c3', principalId: null, userId: 'usr-alice', policy }, fx.events, fx.entities);
        await dispatchAll(fx);
        // Replay the OLD plaintext (now stale). With grace=0, this falls
        // outside the window immediately and should trigger reuse-detection.
        await new Promise(function (r) {
            return setTimeout(r, 10);
        });
        let caught: unknown;
        try {
            await handleSessionRefresh({
                tenantId: fx.tenantId,
                correlationId: 'c4',
                sessionId: issued.document.sessionId,
                presentedRefreshSecret: issued.plaintextRefreshToken,
                policy,
            }, fx.events, fx.entities);
        }
        catch (e) {
            caught = e;
        }
        if (!(caught instanceof IdentityError)) {
            throw new Error(`expected IdentityError, got ${String(caught)}`);
        }
        expect(caught.code).toBe(identityErrorCodes.SESSION_REUSE_DETECTED);
        await dispatchAll(fx);
        // Both sessions revoked, plus an anomaly event in the log.
        const original = await getSessionEntity(fx.entities, fx.tenantId, issued.document.sessionId);
        const siblingNow = await getSessionEntity(fx.entities, fx.tenantId, sibling.document.sessionId);
        expect(original?.status).toBe('revoked');
        expect(original?.endReason).toBe('reuse_detected');
        expect(siblingNow?.status).toBe('revoked');
        const anomalies = fx.events.events.filter(function (e) {
            return e.eventType === 'Identity.SessionAnomaly';
        });
        expect(anomalies.length).toBe(1);
    });
    it('reuse INSIDE grace rotates again (network blip recovery)', async function () {
        const fx = newFixture();
        const policy = { ...DEFAULT_SESSION_POLICY, refreshGraceSeconds: 60 };
        const issued = await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice', policy }, fx.events, fx.entities);
        await dispatchAll(fx);
        const first = await handleSessionRefresh({
            tenantId: fx.tenantId,
            correlationId: 'c2',
            sessionId: issued.document.sessionId,
            presentedRefreshSecret: issued.plaintextRefreshToken,
            policy,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        // Client retries with the original (now-previous) token. Should
        // succeed because we're well within the 60s grace.
        const second = await handleSessionRefresh({
            tenantId: fx.tenantId,
            correlationId: 'c3',
            sessionId: issued.document.sessionId,
            presentedRefreshSecret: issued.plaintextRefreshToken,
            policy,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        expect(second.envelope.eventType).toBe('Identity.SessionRefreshed');
        expect(second.document?.sessionId).toBe(issued.document.sessionId);
        // The "new previous" is now the first-rotation hash — not the
        // original. The client gets fresh plaintexts on this branch too.
        expect(second.document?.previousRefreshTokenHash).toBe(first.document?.refreshTokenHash);
    });
    it('hard-timeout flips to expired and rejects', async function () {
        const fx = newFixture();
        const issued = await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice' }, fx.events, fx.entities);
        // Force the session past hardExpiresAt.
        await dispatchAll(fx);
        const past = new Date(Date.now() - 1000).toISOString();
        await fx.entities.put({
            tenantId: fx.tenantId,
            entityType: 'AuthSession',
            entityId: issued.document.sessionId,
            attrs: { ...issued.document, hardExpiresAt: past } satisfies AuthSessionDocument,
            schemaVersion: 1,
        });
        await expect(handleSessionRefresh({
            tenantId: fx.tenantId,
            correlationId: 'c2',
            sessionId: issued.document.sessionId,
            presentedRefreshSecret: issued.plaintextRefreshToken,
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.SESSION_HARD_TIMEOUT });
    });
    it('idle-timeout rejects when lastSeenAt is too old', async function () {
        const fx = newFixture();
        const policy = { ...DEFAULT_SESSION_POLICY, idleTimeoutMinutes: 1 };
        const issued = await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice', policy }, fx.events, fx.entities);
        await dispatchAll(fx);
        const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        await fx.entities.put({
            tenantId: fx.tenantId,
            entityType: 'AuthSession',
            entityId: issued.document.sessionId,
            attrs: { ...issued.document, lastSeenAt: stale } satisfies AuthSessionDocument,
            schemaVersion: 1,
        });
        await expect(handleSessionRefresh({
            tenantId: fx.tenantId,
            correlationId: 'c2',
            sessionId: issued.document.sessionId,
            presentedRefreshSecret: issued.plaintextRefreshToken,
            policy,
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.SESSION_IDLE_TIMEOUT });
    });
});
describe('Identity.AuthSession.Revoke', function () {
    it('flips status to revoked, records reason', async function () {
        const fx = newFixture();
        const issued = await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice' }, fx.events, fx.entities);
        await dispatchAll(fx);
        const result = await handleSessionRevoke({
            tenantId: fx.tenantId,
            correlationId: 'c2',
            principalId: 'usr-alice',
            sessionId: issued.document.sessionId,
            reason: 'user_logout',
        }, fx.events, fx.entities);
        expect(result.document.status).toBe('revoked');
        expect(result.document.endReason).toBe('user_logout');
        await dispatchAll(fx);
        const stored = await getSessionEntity(fx.entities, fx.tenantId, issued.document.sessionId);
        expect(stored?.status).toBe('revoked');
    });
});
describe('Identity.AuthSession.RevokeAllForUser', function () {
    it('emits SessionEnded per active session, returns ids', async function () {
        const fx = newFixture();
        await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice' }, fx.events, fx.entities);
        await dispatchAll(fx);
        await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c2', principalId: null, userId: 'usr-alice' }, fx.events, fx.entities);
        await dispatchAll(fx);
        const result = await handleSessionRevokeAllForUser({
            tenantId: fx.tenantId,
            correlationId: 'c3',
            principalId: null,
            userId: 'usr-alice',
            reason: 'password_changed',
        }, fx.events, fx.entities);
        expect(result.envelopes.length).toBe(2);
        expect(result.revokedSessionIds.length).toBe(2);
        await dispatchAll(fx);
        const active = await listActiveSessionsForUser(fx.entities, fx.tenantId, 'usr-alice');
        expect(active).toHaveLength(0);
    });
});
describe('I12 — sessions replay from event log alone', function () {
    it('full Issue + Refresh + Revoke chain reproduces post-state', async function () {
        const fx = newFixture();
        const issued = await handleSessionIssue({ tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice' }, fx.events, fx.entities);
        await dispatchAll(fx);
        await handleSessionRefresh({
            tenantId: fx.tenantId,
            correlationId: 'c2',
            sessionId: issued.document.sessionId,
            presentedRefreshSecret: issued.plaintextRefreshToken,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        await handleSessionRevoke({
            tenantId: fx.tenantId,
            correlationId: 'c3',
            principalId: 'usr-alice',
            sessionId: issued.document.sessionId,
            reason: 'user_logout',
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        function strip(s: string): string {
            return s
                .replace(/"updatedAt":"[^"]+"/g, '"updatedAt":"<t>"')
                .replace(/"createdAt":"[^"]+"/g, '"createdAt":"<t>"');
        }
        const before = strip(JSON.stringify(Array.from(fx.entities.rows.entries()).sort()));
        fx.entities.rows.clear();
        fx.relations.rows.clear();
        await dispatchAll(fx);
        const after = strip(JSON.stringify(Array.from(fx.entities.rows.entries()).sort()));
        expect(before).toBe(after);
    });
});
