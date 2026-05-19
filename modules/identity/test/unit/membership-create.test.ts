/**
 * Unit tests for `handleMembershipCreate` (Layer 1).
 *
 * Lifecycle handler. Branch coverage for envelope shape, the
 * USER_NOT_FOUND guard (user must exist BEFORE membership), the
 * MEMBERSHIP_REQUIRED duplicate guard, and tenant scoping. Existing
 * scenario coverage in `../handlers.test.ts` exercises the dispatcher
 * relation-edge wiring; this file owns pure-handler branches.
 */
import { describe, it, expect } from 'vitest';
import { handleMembershipCreate, handleUserCreate, IdentityError, identityErrorCodes, } from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';
async function seedUser(fx: ReturnType<typeof newFixture>, email = 'user@example.com'): Promise<string> {
    const result = await handleUserCreate({
        tenantId: fx.tenantId,
        correlationId: 'seed',
        principalId: 'admin',
        email,
    }, fx.events);
    await dispatchAll(fx);
    return result.document.userId;
}
describe('handleMembershipCreate — happy path', function () {
    it('emits Identity.MembershipCreated with the documented envelope fields', async function () {
        const fx = newFixture();
        const userId = await seedUser(fx);
        const result = await handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'corr-1',
            principalId: 'admin',
            userId,
            roles: ['Author'],
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.MembershipCreated');
        expect(result.envelope.schemaId).toBe('domain.identity.membership.created.v1');
        expect(result.envelope.idempotencyKey).toBe(`identity.membership.create.${fx.tenantId}.${userId}`);
    });
    it('exact cacheInvalidationTags: Tenant + User + Membership', async function () {
        const fx = newFixture();
        const userId = await seedUser(fx, 'tags@example.com');
        const result = await handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId,
            roles: ['TenantAdmin'],
        }, fx.events, fx.entities);
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `User:${userId}`,
            `Membership:${fx.tenantId}:${userId}`,
        ]);
    });
    it('persists roles as a copy (no aliasing) and defaults status to active', async function () {
        const fx = newFixture();
        const userId = await seedUser(fx);
        const inputRoles = ['Author', 'Editor'];
        const result = await handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId,
            roles: inputRoles,
        }, fx.events, fx.entities);
        expect(result.document.roles).toEqual(['Author', 'Editor']);
        inputRoles.push('SneakyMutation');
        expect(result.document.roles).toEqual(['Author', 'Editor']);
        expect(result.document.status).toBe('active');
    });
    it('honors explicit status override', async function () {
        const fx = newFixture();
        const userId = await seedUser(fx);
        const result = await handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId,
            roles: ['Viewer'],
            status: 'suspended',
        }, fx.events, fx.entities);
        expect(result.document.status).toBe('suspended');
    });
});
describe('handleMembershipCreate — error paths', function () {
    it('rejects when user does not exist with USER_NOT_FOUND', async function () {
        const fx = newFixture();
        await expect(handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'usr-ghost',
            roles: ['Viewer'],
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.USER_NOT_FOUND });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects duplicate membership with MEMBERSHIP_REQUIRED', async function () {
        const fx = newFixture();
        const userId = await seedUser(fx);
        await handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'first',
            principalId: 'admin',
            userId,
            roles: ['Author'],
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        await expect(handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'second',
            principalId: 'admin',
            userId,
            roles: ['Editor'],
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.MEMBERSHIP_REQUIRED });
    });
    it('emits no events on rejection', async function () {
        const fx = newFixture();
        const before = fx.events.events.length;
        await expect(handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'usr-ghost',
            roles: ['Viewer'],
        }, fx.events, fx.entities)).rejects.toThrow();
        expect(fx.events.events.length).toBe(before);
    });
    it('throws IdentityError instances', async function () {
        const fx = newFixture();
        await expect(handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            userId: 'usr-nope',
            roles: ['Viewer'],
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
    });
});
describe('handleMembershipCreate — tenant scoping', function () {
    it('a user with a membership in tenant A can have a separate membership in tenant B', async function () {
        const fx = newFixture('tenant-a');
        // Seed user in BOTH tenants (same userId).
        await handleUserCreate({
            tenantId: 'tenant-a',
            correlationId: 's',
            principalId: 'admin',
            userId: 'shared-user',
            email: 'shared@example.com',
        }, fx.events);
        await handleUserCreate({
            tenantId: 'tenant-b',
            correlationId: 's',
            principalId: 'admin',
            userId: 'shared-user',
            email: 'shared@example.com',
        }, fx.events);
        await dispatchAll(fx);
        const a = await handleMembershipCreate({
            tenantId: 'tenant-a',
            correlationId: 'a',
            principalId: 'admin',
            userId: 'shared-user',
            roles: ['Author'],
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const b = await handleMembershipCreate({
            tenantId: 'tenant-b',
            correlationId: 'b',
            principalId: 'admin',
            userId: 'shared-user',
            roles: ['Viewer'],
        }, fx.events, fx.entities);
        expect(a.document.tenantId).toBe('tenant-a');
        expect(b.document.tenantId).toBe('tenant-b');
        expect(a.envelope.idempotencyKey).not.toBe(b.envelope.idempotencyKey);
    });
});
