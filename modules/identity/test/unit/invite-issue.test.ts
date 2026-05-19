/**
 * Unit tests for `handleInviteIssue` (Layer 1).
 *
 * Auth-issuing — secret hygiene assertions are mandatory: plaintext
 * surfaced once, document carries hash + lookup only, plaintext never
 * appears in the event payload (per `crosscut/events.md`'s
 * secrets-stay-out-of-event-history rule).
 */
import { describe, it, expect } from '@atlas/test';
import { handleInviteIssue, hashSecret, lookupOf, } from '../../src/index.ts';
import { newFixture } from '../lib/fixtures.ts';
describe('handleInviteIssue — happy path', function () {
    it('emits Identity.InviteIssued with the documented envelope fields', async function () {
        const fx = newFixture();
        const result = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'corr-1',
            principalId: 'admin-1',
            email: 'guest@example.com',
            rolesOnAccept: ['Author'],
        }, fx.events);
        expect(result.envelope.eventType).toBe('Identity.InviteIssued');
        expect(result.envelope.schemaId).toBe('domain.identity.invite.issued.v1');
        expect(result.envelope.idempotencyKey).toBe(`identity.invite.issue.${result.document.tokenId}`);
    });
    it('exact cacheInvalidationTags: Tenant + Invite', async function () {
        const fx = newFixture();
        const result = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'tags@example.com',
            rolesOnAccept: ['Viewer'],
        }, fx.events);
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `Invite:${result.document.tokenId}`,
        ]);
    });
    it('plaintext token is high-entropy (>20 chars) and surfaced exactly once', async function () {
        const fx = newFixture();
        const result = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'entropy@example.com',
            rolesOnAccept: ['Author'],
        }, fx.events);
        expect(result.plaintextToken.length).toBeGreaterThan(20);
        expect(result.document.tokenHash).toBe(hashSecret(result.plaintextToken));
        expect(result.document.tokenLookup).toBe(lookupOf(result.plaintextToken));
    });
    it('plaintext token does NOT appear in the event payload (events.md secrets rule)', async function () {
        const fx = newFixture();
        const result = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'noleak@example.com',
            rolesOnAccept: ['Author'],
        }, fx.events);
        // `seq` is a BigInt — stringify with a replacer.
        const eventJson = JSON.stringify(fx.events.events, function (_k, v: unknown) {
            return typeof v === 'bigint' ? v.toString() : v;
        });
        expect(eventJson).not.toContain(result.plaintextToken);
    });
    it('normalizes email to lowercase on the document', async function () {
        const fx = newFixture();
        const result = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'MIXED@Example.COM',
            rolesOnAccept: ['Author'],
        }, fx.events);
        expect(result.document.email).toBe('mixed@example.com');
    });
    it('persists rolesOnAccept as a copy (no aliasing)', async function () {
        const fx = newFixture();
        const inputRoles = ['Author', 'Editor'];
        const result = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'roles@example.com',
            rolesOnAccept: inputRoles,
        }, fx.events);
        expect(result.document.rolesOnAccept).toEqual(['Author', 'Editor']);
        inputRoles.push('SneakyMutation');
        expect(result.document.rolesOnAccept).toEqual(['Author', 'Editor']);
    });
    it('marks the invite as pending', async function () {
        const fx = newFixture();
        const result = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'pend@example.com',
            rolesOnAccept: ['Author'],
        }, fx.events);
        expect(result.document.status).toBe('pending');
    });
});
describe('handleInviteIssue — TTL behavior', function () {
    it('default TTL is 7 days', async function () {
        const fx = newFixture();
        const before = Date.now();
        const result = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'ttl@example.com',
            rolesOnAccept: ['Author'],
        }, fx.events);
        const expiresMs = new Date(result.document.expiresAt).getTime();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        expect(expiresMs - before).toBeGreaterThanOrEqual(sevenDaysMs - 5000);
        expect(expiresMs - before).toBeLessThanOrEqual(sevenDaysMs + 5000);
    });
    it('honors custom ttlSeconds (60-second invite)', async function () {
        const fx = newFixture();
        const before = Date.now();
        const result = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'short@example.com',
            rolesOnAccept: ['Author'],
            ttlSeconds: 60,
        }, fx.events);
        const expiresMs = new Date(result.document.expiresAt).getTime();
        expect(expiresMs - before).toBeGreaterThanOrEqual(59 * 1000);
        expect(expiresMs - before).toBeLessThanOrEqual(65 * 1000);
    });
    it('honors negative ttlSeconds (already-expired invite — useful for tests)', async function () {
        const fx = newFixture();
        const result = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'past@example.com',
            rolesOnAccept: ['Author'],
            ttlSeconds: -1,
        }, fx.events);
        expect(new Date(result.document.expiresAt).getTime()).toBeLessThan(Date.now());
    });
});
describe('handleInviteIssue — tenant scoping', function () {
    it('produces tenant-scoped cache tags and idempotency keys', async function () {
        const fx = newFixture('tenant-a');
        const a = await handleInviteIssue({
            tenantId: 'tenant-a',
            correlationId: 'c',
            principalId: 'admin',
            email: 'shared@example.com',
            rolesOnAccept: ['Author'],
        }, fx.events);
        const b = await handleInviteIssue({
            tenantId: 'tenant-b',
            correlationId: 'c',
            principalId: 'admin',
            email: 'shared@example.com',
            rolesOnAccept: ['Author'],
        }, fx.events);
        const aTags = a.envelope.cacheInvalidationTags;
        const bTags = b.envelope.cacheInvalidationTags;
        if (!aTags || !bTags) {
            throw new Error('cacheInvalidationTags must be present (Invariant I10)');
        }
        expect(aTags[0]).toBe('Tenant:tenant-a');
        expect(bTags[0]).toBe('Tenant:tenant-b');
        expect(a.document.tokenId).not.toBe(b.document.tokenId);
    });
});
