/**
 * Unit tests for `handleUserCreate` (Layer 1).
 *
 * Lifecycle handler — non-credential. Branch coverage for envelope
 * shape, optional fields, and the caller-supplied vs generated userId
 * paths. Existing scenario coverage in `../handlers.test.ts` exercises
 * the dispatcher rebuild; this file owns pure-handler branches.
 *
 * Idempotency note: `idempotencyKey` is `identity.user.create.<tenant>.<userId>`.
 * If the caller supplies the same `userId`, retries collide upstream
 * via the ingress idempotency check. Handler does not deduplicate.
 */
import { describe, it, expect } from '@atlas/test';
import { handleUserCreate } from '../../src/index.ts';
import { newFixture } from '../lib/fixtures.ts';
describe('handleUserCreate — happy path', function () {
    it('emits Identity.UserCreated with the documented envelope fields', async function () {
        const fx = newFixture();
        const result = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'corr-1',
            principalId: 'admin-1',
            email: 'alice@example.com',
        }, fx.events);
        expect(result.envelope.eventType).toBe('Identity.UserCreated');
        expect(result.envelope.schemaId).toBe('domain.identity.user.created.v1');
        expect(result.envelope.schemaVersion).toBe(1);
        expect(result.envelope.tenantId).toBe(fx.tenantId);
        expect(result.envelope.correlationId).toBe('corr-1');
        expect(result.envelope.principalId).toBe('admin-1');
        expect(result.envelope.causationId).toBeNull();
        expect(result.envelope.idempotencyKey).toBe(`identity.user.create.${fx.tenantId}.${result.document.userId}`);
    });
    it('exact cacheInvalidationTags: Tenant + User', async function () {
        const fx = newFixture();
        const result = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'bob@example.com',
        }, fx.events);
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `User:${result.document.userId}`,
        ]);
    });
    it('normalizes email to lowercase', async function () {
        const fx = newFixture();
        const result = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'MIXED@Example.COM',
        }, fx.events);
        expect(result.document.email).toBe('mixed@example.com');
    });
    it('honors caller-supplied userId (atlasctl bootstrap path)', async function () {
        const fx = newFixture();
        const result = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            userId: 'usr-fixed-bootstrap',
            email: 'boot@example.com',
        }, fx.events);
        expect(result.document.userId).toBe('usr-fixed-bootstrap');
        expect(result.envelope.idempotencyKey).toBe(`identity.user.create.${fx.tenantId}.usr-fixed-bootstrap`);
    });
    it('generates a userId when not provided', async function () {
        const fx = newFixture();
        const result = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'gen@example.com',
        }, fx.events);
        expect(result.document.userId).toMatch(/^[a-z0-9_-]+$/i);
        expect(result.document.userId.length).toBeGreaterThan(5);
    });
    it('defaults status to active and primaryIdpSubject to null', async function () {
        const fx = newFixture();
        const result = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'def@example.com',
        }, fx.events);
        expect(result.document.status).toBe('active');
        expect(result.document.primaryIdpSubject).toBeNull();
    });
});
describe('handleUserCreate — configuration knobs', function () {
    it('persists primaryIdpSubject when provided', async function () {
        const fx = newFixture();
        const result = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'idp@example.com',
            primaryIdpSubject: 'sub-google-12345',
        }, fx.events);
        expect(result.document.primaryIdpSubject).toBe('sub-google-12345');
    });
    it('persists givenName / familyName when provided, omits when not', async function () {
        const fx = newFixture();
        const withNames = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'named@example.com',
            givenName: 'Ada',
            familyName: 'Lovelace',
        }, fx.events);
        expect(withNames.document.givenName).toBe('Ada');
        expect(withNames.document.familyName).toBe('Lovelace');
        const withoutNames = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'noname@example.com',
        }, fx.events);
        expect(withoutNames.document.givenName).toBeUndefined();
        expect(withoutNames.document.familyName).toBeUndefined();
    });
    it('persists passwordHash when provided', async function () {
        const fx = newFixture();
        const result = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'hashed@example.com',
            passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc...',
        }, fx.events);
        expect(result.document.passwordHash).toBe('$argon2id$v=19$m=65536,t=3,p=4$abc...');
    });
    it('honors explicit status override', async function () {
        const fx = newFixture();
        const result = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'pending@example.com',
            status: 'suspended',
        }, fx.events);
        expect(result.document.status).toBe('suspended');
    });
});
describe('handleUserCreate — tenant scoping', function () {
    it('produces tenant-scoped cache tags and idempotency keys', async function () {
        const fx = newFixture('tenant-a');
        const a = await handleUserCreate({
            tenantId: 'tenant-a',
            correlationId: 'c',
            principalId: 'admin',
            userId: 'shared-id',
            email: 'a@example.com',
        }, fx.events);
        const b = await handleUserCreate({
            tenantId: 'tenant-b',
            correlationId: 'c',
            principalId: 'admin',
            userId: 'shared-id',
            email: 'b@example.com',
        }, fx.events);
        const aTags = a.envelope.cacheInvalidationTags;
        const bTags = b.envelope.cacheInvalidationTags;
        if (!aTags || !bTags) {
            throw new Error('cacheInvalidationTags must be present (Invariant I10)');
        }
        expect(aTags[0]).toBe('Tenant:tenant-a');
        expect(bTags[0]).toBe('Tenant:tenant-b');
        expect(a.envelope.idempotencyKey).not.toBe(b.envelope.idempotencyKey);
    });
});
