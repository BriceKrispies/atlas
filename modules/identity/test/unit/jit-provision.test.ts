/**
 * Unit tests for `handleJitProvision`.
 *
 * Covers:
 *   - Happy path: unknown JWT subject + idp.requireInvite=false →
 *     mints User + Membership, emits both events, both events tagged
 *     with `Tenant:${tenantId}` (I10).
 *   - Failure path: idp.requireInvite=true with no matching User →
 *     throws `JIT_PROVISIONING_DISABLED`, NO events appended (I2/I3
 *     style guarantee at handler scope).
 *
 * Returning-user / role-reconciliation paths are exercised separately
 * by the broader Phase A3 acceptance tests; this file owns the basic
 * I10 contract for the JIT provisioning emit sites.
 */
import { describe, it, expect } from '@atlas/test';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { handleJitProvision, IdentityError, identityErrorCodes, type IdentityProviderDocument, } from '../../src/index.ts';
import { assertEventTags, newFixture } from '../lib/fixtures.ts';
function idp(overrides: Partial<IdentityProviderDocument> = {}): IdentityProviderDocument {
    return {
        idpId: 'idp-1',
        tenantId: 't1',
        kind: 'oidc',
        displayName: 'Acme OIDC',
        issuer: 'https://idp.example.com',
        audience: 'atlas',
        requireInvite: false,
        defaultRolesOnFirstLogin: ['Member'],
        roleMappings: [],
        priority: 0,
        status: 'active',
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
        ...overrides,
    } satisfies IdentityProviderDocument;
}
describe('handleJitProvision — provisions on first login', function () {
    it('mints User + Membership, both events carry Tenant:<tenantId> tag (I10)', async function () {
        const fx = newFixture();
        const result = await handleJitProvision({
            tenantId: fx.tenantId,
            correlationId: 'corr-jit',
            idp: idp({ tenantId: fx.tenantId }),
            claims: {
                sub: 'idp-subject-1',
                email: 'newbie@example.com',
                given_name: 'New',
                family_name: 'Bie',
                raw: { sub: 'idp-subject-1', email: 'newbie@example.com' },
            },
        }, fx.events, fx.entities);
        expect(result.created).toBe(true);
        expect(result.events.length).toBeGreaterThanOrEqual(2);
        // Find UserCreated + MembershipCreated emit-sites.
        const userCreated = result.events.find(function (e) {
            return e.eventType === 'Identity.UserCreated';
        });
        const membershipCreated = result.events.find(function (e) {
            return e.eventType === 'Identity.MembershipCreated';
        });
        expect(userCreated).toBeDefined();
        expect(membershipCreated).toBeDefined();
        // I10 — every event carries the tenant tag, plus the per-user tag.
        assertEventTags(assertDefined(userCreated, 'expect.toBeDefined() just asserted UserCreated emitted'), [`Tenant:${fx.tenantId}`, `User:${result.user.userId}`]);
        assertEventTags(assertDefined(membershipCreated, 'expect.toBeDefined() just asserted MembershipCreated emitted'), [
            `Tenant:${fx.tenantId}`,
            `User:${result.user.userId}`,
            `Membership:${fx.tenantId}:${result.user.userId}`,
        ]);
    });
});
describe('handleJitProvision — requireInvite gate', function () {
    it('rejects unknown subject when idp.requireInvite=true; appends NO events', async function () {
        const fx = newFixture();
        await expect(handleJitProvision({
            tenantId: fx.tenantId,
            correlationId: 'corr-deny',
            idp: idp({ tenantId: fx.tenantId, requireInvite: true }),
            claims: {
                sub: 'idp-unknown',
                email: 'unknown@example.com',
                raw: { sub: 'idp-unknown' },
            },
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
        await expect(handleJitProvision({
            tenantId: fx.tenantId,
            correlationId: 'corr-deny-2',
            idp: idp({ tenantId: fx.tenantId, requireInvite: true }),
            claims: {
                sub: 'idp-unknown-2',
                email: 'unknown2@example.com',
                raw: { sub: 'idp-unknown-2' },
            },
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.JIT_PROVISIONING_DISABLED,
        });
        // No events appended on the deny path.
        expect(fx.events.events).toHaveLength(0);
    });
});
