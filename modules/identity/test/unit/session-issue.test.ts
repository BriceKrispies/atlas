/**
 * Unit tests for `handleSessionIssue` (Layer 1, Identity Module Test Pass).
 *
 * Scope: branch coverage of the handler. NOT a scenario test — for
 * sequence coverage (Issue → Refresh → Revoke chains, hard-timeout +
 * idle-timeout interaction) see `../session.test.ts`.
 *
 * These tests assert:
 *   - happy path: envelope shape (eventType, schemaId, schemaVersion,
 *     idempotencyKey format, exact `cacheInvalidationTags`), result
 *     shape (cookiePayload format, plaintexts surfaced once), document
 *     shape (timestamps derived from policy + accessTtl).
 *   - configuration knobs: custom `policy`, custom
 *     `accessTokenTtlSeconds`, optional `ip` / `userAgent` passthrough.
 *   - error paths: every IdentityError branch the handler can reach.
 *   - eviction edges: at-cap (evict 1), over-cap (evict N), under-cap
 *     (no evictions); follow-event ordering; per-evicted-session cache
 *     tags.
 *   - tenant scoping: cap calculation is per-tenant — sessions in
 *     tenant B do not contribute to tenant A's cap.
 *
 * Idempotency note: `handleSessionIssue` mints a fresh `sessionId` on
 * every call; the envelope's `idempotencyKey` is therefore unique per
 * call (`identity.session.issue.${sessionId}`). Retries produce
 * distinct sessions by design — there is no "retry returns same
 * result" semantics at this handler. Idempotency is enforced on the
 * issuing intent (which uses the IntentEnvelope's `idempotencyKey`)
 * one level up, in the ingress pipeline. No idempotency assertion in
 * this file.
 */
import { describe, it, expect } from '@atlas/test';
import { handleSessionIssue, hashSecret, lookupOf, IdentityError, identityErrorCodes, DEFAULT_SESSION_POLICY, type AuthSessionDocument, type SessionPolicy, } from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';
function sessionDocFromPayload(payload: unknown): AuthSessionDocument {
    if (!payload || typeof payload !== 'object' || !('document' in payload)) {
        throw new Error('expected event payload with `document` field');
    }
    const doc = payload.document;
    if (!doc || typeof doc !== 'object') {
        throw new Error('expected event payload.document to be an object');
    }
    // Tests already pinned the producing handler — the document field on
    // session events is always an `AuthSessionDocument` by construction.
    return doc as AuthSessionDocument;
}
describe('handleSessionIssue — happy path', function () {
    it('emits Identity.SessionIssued with full envelope shape', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'corr-1',
            principalId: 'user-1',
            userId: 'user-1',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.SessionIssued');
        expect(result.envelope.schemaId).toBe('domain.identity.session.issued.v1');
        expect(result.envelope.schemaVersion).toBe(1);
        expect(result.envelope.tenantId).toBe('t1');
        expect(result.envelope.correlationId).toBe('corr-1');
        expect(result.envelope.principalId).toBe('user-1');
        expect(result.envelope.userId).toBe('user-1');
        expect(result.envelope.causationId).toBeNull();
        // idempotencyKey is `identity.session.issue.${sessionId}`; sessionId
        // is freshly generated each call, so we assert the prefix shape.
        expect(result.envelope.idempotencyKey).toMatch(/^identity\.session\.issue\.[a-z0-9_-]+$/i);
        expect(result.envelope.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
    it('emits cacheInvalidationTags exactly: Tenant + User + Session', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-2',
            userId: 'user-2',
        }, fx.events, fx.entities);
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `User:user-2`,
            `Session:${result.document.sessionId}`,
        ]);
    });
    it('returns plaintexts and cookiePayload formatted as <sessionId>.<refreshSecret>', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-3',
            userId: 'user-3',
        }, fx.events, fx.entities);
        expect(result.plaintextRefreshToken.length).toBeGreaterThan(20);
        expect(result.plaintextAccessToken.length).toBeGreaterThan(20);
        expect(result.cookiePayload).toBe(`${result.document.sessionId}.${result.plaintextRefreshToken}`);
    });
    it('persists hashes (not plaintexts) on the AuthSession document', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-4',
            userId: 'user-4',
        }, fx.events, fx.entities);
        expect(result.document.refreshTokenHash).toBe(hashSecret(result.plaintextRefreshToken));
        expect(result.document.refreshTokenLookup).toBe(lookupOf(result.plaintextRefreshToken));
        expect(result.document.accessTokenHash).toBe(hashSecret(result.plaintextAccessToken));
        expect(result.document.accessTokenLookup).toBe(lookupOf(result.plaintextAccessToken));
        // Plaintexts MUST NOT appear anywhere on the persisted document.
        const docJson = JSON.stringify(result.document);
        expect(docJson).not.toContain(result.plaintextRefreshToken);
        expect(docJson).not.toContain(result.plaintextAccessToken);
    });
    it('marks the new document active with status=active and follow=[]', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-5',
            userId: 'user-5',
        }, fx.events, fx.entities);
        expect(result.document.status).toBe('active');
        expect(result.follow).toEqual([]);
    });
    it('appends the SessionIssued event to the EventStore', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-6',
            userId: 'user-6',
        }, fx.events, fx.entities);
        expect(fx.events.events).toHaveLength(1);
        expect(fx.events.events[0]?.eventId).toBe(result.envelope.eventId);
    });
});
describe('handleSessionIssue — configuration knobs', function () {
    it('honors custom accessTokenTtlSeconds (overrides the 1-hour default)', async function () {
        const fx = newFixture();
        const before = Date.now();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-7',
            userId: 'user-7',
            accessTokenTtlSeconds: 30,
        }, fx.events, fx.entities);
        const accessExpiresMs = new Date(result.document.accessExpiresAt).getTime();
        // Should be ~30 seconds from the issuance time; allow generous slop
        // for cross-platform clock skew.
        expect(accessExpiresMs - before).toBeGreaterThanOrEqual(29 * 1000);
        expect(accessExpiresMs - before).toBeLessThanOrEqual(35 * 1000);
    });
    it('honors custom session policy (hardTimeoutHours)', async function () {
        const fx = newFixture();
        const policy: SessionPolicy = {
            ...DEFAULT_SESSION_POLICY,
            hardTimeoutHours: 1, // 1 hour instead of default
        };
        const before = Date.now();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-8',
            userId: 'user-8',
            policy,
        }, fx.events, fx.entities);
        const hardExpiresMs = new Date(result.document.hardExpiresAt).getTime();
        expect(hardExpiresMs - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
        expect(hardExpiresMs - before).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
    });
    it('passes through optional ip', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-9',
            userId: 'user-9',
            ip: '198.51.100.42',
        }, fx.events, fx.entities);
        expect(result.document.ip).toBe('198.51.100.42');
    });
    it('passes through optional userAgent', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-10',
            userId: 'user-10',
            userAgent: 'Mozilla/5.0 atlasctl/0.1',
        }, fx.events, fx.entities);
        expect(result.document.userAgent).toBe('Mozilla/5.0 atlasctl/0.1');
    });
    it('omits ip and userAgent fields when not provided', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'user-11',
            userId: 'user-11',
        }, fx.events, fx.entities);
        expect(result.document.ip).toBeUndefined();
        expect(result.document.userAgent).toBeUndefined();
    });
});
describe('handleSessionIssue — error paths', function () {
    it('throws IdentityError with code IDENTITY_INVALID when principalId !== userId', async function () {
        const fx = newFixture();
        await expect(handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'attacker-1',
            userId: 'victim-1',
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
        await expect(handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'attacker-1',
            userId: 'victim-1',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.IDENTITY_INVALID });
    });
    it('rejects mismatched-principal request before any side effect (no event emitted)', async function () {
        const fx = newFixture();
        await expect(handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'attacker-2',
            userId: 'victim-2',
        }, fx.events, fx.entities)).rejects.toThrow();
        expect(fx.events.events).toHaveLength(0);
    });
    it('allows principalId=null (front-door auth flows: password-login, invite-accept)', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            userId: 'first-time-user',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.SessionIssued');
        expect(result.document.userId).toBe('first-time-user');
    });
});
describe('handleSessionIssue — concurrent-session cap', function () {
    async function issueN(fx: ReturnType<typeof newFixture>, userId: string, n: number, policy?: SessionPolicy): Promise<void> {
        for (let i = 0; i < n; i += 1) {
            await handleSessionIssue({
                tenantId: fx.tenantId,
                correlationId: `c-${i}`,
                principalId: userId,
                userId,
                ...(policy ? { policy } : {}),
            }, fx.events, fx.entities);
            // Materialize entities so the next issue sees the prior session.
            await dispatchAll(fx);
        }
    }
    it('does not evict when under the cap', async function () {
        const fx = newFixture();
        const policy: SessionPolicy = {
            ...DEFAULT_SESSION_POLICY,
            maxConcurrentSessions: 5,
        };
        await issueN(fx, 'cap-user-1', 3, policy);
        // Last issue should have no evictions.
        const lastEvent = fx.events.events.at(-1);
        expect(lastEvent?.eventType).toBe('Identity.SessionIssued');
        // No SessionEnded events emitted at all.
        const ended = fx.events.events.filter(function (e) {
            return e.eventType === 'Identity.SessionEnded';
        });
        expect(ended).toHaveLength(0);
    });
    it('evicts oldest session when at the cap (evict 1, follow before primary)', async function () {
        const fx = newFixture();
        const policy: SessionPolicy = {
            ...DEFAULT_SESSION_POLICY,
            maxConcurrentSessions: 2,
        };
        // Get to exactly cap=2.
        await issueN(fx, 'cap-user-2', 2, policy);
        // Now issue one more — should evict the oldest.
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c-evict',
            principalId: 'cap-user-2',
            userId: 'cap-user-2',
            policy,
        }, fx.events, fx.entities);
        expect(result.follow).toHaveLength(1);
        expect(result.follow[0]?.eventType).toBe('Identity.SessionEnded');
        // The evicted event was appended BEFORE the primary in the event log.
        const events = fx.events.events;
        const lastTwo = events.slice(-2);
        expect(lastTwo[0]?.eventType).toBe('Identity.SessionEnded');
        expect(lastTwo[1]?.eventType).toBe('Identity.SessionIssued');
        expect(lastTwo[1]?.eventId).toBe(result.envelope.eventId);
    });
    it('evicts N when over the cap by N', async function () {
        // Pre-seed 5 active sessions, then drop the cap to 2 via the next issue.
        // After issuing the new session, we should be exactly at cap (2),
        // meaning 4 evictions occurred (5 + 1 new - 2 cap = 4 evicted).
        const fx = newFixture();
        const looseCap: SessionPolicy = {
            ...DEFAULT_SESSION_POLICY,
            maxConcurrentSessions: 10,
        };
        await issueN(fx, 'cap-user-3', 5, looseCap);
        const tightCap: SessionPolicy = {
            ...DEFAULT_SESSION_POLICY,
            maxConcurrentSessions: 2,
        };
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c-shrink',
            principalId: 'cap-user-3',
            userId: 'cap-user-3',
            policy: tightCap,
        }, fx.events, fx.entities);
        expect(result.follow).toHaveLength(4);
        expect(result.follow.every(function (e) {
            return e.eventType === 'Identity.SessionEnded';
        })).toBe(true);
    });
    it('evicted SessionEnded events have cache tags pointing at the EVICTED sessionId', async function () {
        const fx = newFixture();
        const policy: SessionPolicy = {
            ...DEFAULT_SESSION_POLICY,
            maxConcurrentSessions: 1,
        };
        // Issue first session, then a second — the first should be evicted.
        const first = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c1',
            principalId: 'cap-user-4',
            userId: 'cap-user-4',
            policy,
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const second = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c2',
            principalId: 'cap-user-4',
            userId: 'cap-user-4',
            policy,
        }, fx.events, fx.entities);
        expect(second.follow).toHaveLength(1);
        const evictEvent = second.follow[0];
        expect(evictEvent?.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `User:cap-user-4`,
            `Session:${first.document.sessionId}`,
        ]);
        // The eviction event's payload carries the evicted session document
        // with status='evicted', endReason='evicted'.
        const payload = evictEvent?.payload;
        const doc = sessionDocFromPayload(payload);
        expect(doc.sessionId).toBe(first.document.sessionId);
        expect(doc.status).toBe('evicted');
        expect(doc.endReason).toBe('evicted');
        expect(payload && typeof payload === 'object' && 'reason' in payload && payload.reason)
            .toBe('evicted');
    });
});
describe('handleSessionIssue — tenant scoping', function () {
    it('cap calculation is per-tenant — tenant B sessions do not count toward tenant A cap', async function () {
        // Two tenants share one fixture so we exercise the per-tenant query.
        const fx = newFixture();
        const policy: SessionPolicy = {
            ...DEFAULT_SESSION_POLICY,
            maxConcurrentSessions: 2,
        };
        // Pre-seed tenant B with 5 active sessions for the same userId.
        for (let i = 0; i < 5; i += 1) {
            await handleSessionIssue({
                tenantId: 'tenant-b',
                correlationId: `tb-${i}`,
                principalId: 'shared-user',
                userId: 'shared-user',
                policy,
            }, fx.events, fx.entities);
            await dispatchAll(fx);
        }
        // Even though tenant B has 5 sessions for shared-user, tenant A's
        // first issue should NOT trigger any eviction.
        const result = await handleSessionIssue({
            tenantId: 'tenant-a',
            correlationId: 'ta-1',
            principalId: 'shared-user',
            userId: 'shared-user',
            policy,
        }, fx.events, fx.entities);
        expect(result.follow).toEqual([]);
    });
});
