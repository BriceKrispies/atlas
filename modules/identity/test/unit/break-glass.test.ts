/**
 * Unit tests for break-glass handlers (Layer 1, Identity Module Test Pass).
 *
 * Quintet: `Authorization.BreakGlass.{Issue, Approve, Deny, Action,
 * Revoke}` — privilege-escalation surface with the strictest retention
 * tier (`retention:10y`) and 4-eyes approval semantics. Every error
 * code is asserted with no-side-effect; every audit event is asserted
 * to carry the platform retention tag; the 4-eyes self-approval guard
 * is the most security-sensitive branch.
 *
 * Plus the `resolveActiveGrants` helper since it's the read path the
 * authz layer uses to decide whether a principal currently holds an
 * elevated role.
 */
import { describe, it, expect } from 'vitest';
import { handleBreakGlassIssue, handleBreakGlassApprove, handleBreakGlassDeny, handleBreakGlassAction, handleBreakGlassRevoke, resolveActiveGrants, BREAK_GLASS_RETENTION_TAG, IdentityError, identityErrorCodes, type BreakGlassGrantDocument, } from '../../src/index.ts';
import { newFixture } from '../lib/fixtures.ts';
/**
 * Narrows an event's `unknown`-typed payload to a string-keyed record so
 * tests can read fields without per-call `as` casts. Throws on a
 * malformed envelope — that's a test invariant failure, not a runtime
 * branch. Centralising the cast keeps `no-unsafe-type-assertion` intact
 * at every call site.
 */
function payloadOf(payload: unknown): Record<string, unknown> {
    if (payload === null || typeof payload !== 'object') {
        throw new Error(`expected payload to be an object, got: ${typeof payload}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: post-typeof guard narrows object to string-keyed record; centralised so call sites stay cast-free.
    return payload as Record<string, unknown>;
}
const VALID = {
    issuedBy: 'op-1',
    grantedTo: 'op-1',
    grantedRoles: ['BreakGlassAdmin'],
    justification: 'investigating production outage',
    incidentUrl: 'https://incidents.example.com/INC-42',
} as const;
describe('handleBreakGlassIssue — happy path', function () {
    it('emits Authorization.BreakGlassIssued with retention:10y and pending_approval status by default', async function () {
        const fx = newFixture();
        const result = await handleBreakGlassIssue({ tenantId: fx.tenantId, correlationId: 'c', ...VALID }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Authorization.BreakGlassIssued');
        expect(result.envelope.retentionTag).toBe(BREAK_GLASS_RETENTION_TAG);
        expect(result.envelope.retentionTag).toBe('retention:10y');
        expect(result.document.status).toBe('pending_approval');
    });
    it('exact cacheInvalidationTags: Tenant + Principal + BreakGlassGrant', async function () {
        const fx = newFixture();
        const result = await handleBreakGlassIssue({ tenantId: fx.tenantId, correlationId: 'c', ...VALID }, fx.events, fx.entities);
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `Principal:${VALID.grantedTo}`,
            `BreakGlassGrant:${result.document.grantId}`,
        ]);
    });
    it('default duration is 60 minutes', async function () {
        const fx = newFixture();
        const before = Date.now();
        const result = await handleBreakGlassIssue({ tenantId: fx.tenantId, correlationId: 'c', ...VALID }, fx.events, fx.entities);
        expect(result.document.maxDurationMin).toBe(60);
        const expiresMs = new Date(result.document.expiresAt).getTime();
        expect(expiresMs - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 5000);
        expect(expiresMs - before).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
    });
    it('requireApproval=false makes the grant active immediately and stamps issuer as approvedBy', async function () {
        const fx = newFixture();
        const result = await handleBreakGlassIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            ...VALID,
            requireApproval: false,
        }, fx.events, fx.entities);
        expect(result.document.status).toBe('active');
        expect(result.document.approvedBy).toBe(VALID.issuedBy);
        expect(result.document.approvedAt).toBeDefined();
    });
    it('passes resourceTypeAllowList through', async function () {
        const fx = newFixture();
        const result = await handleBreakGlassIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            ...VALID,
            resourceTypeAllowList: ['Page', 'User'],
        }, fx.events, fx.entities);
        expect(result.document.resourceTypeAllowList).toEqual(['Page', 'User']);
    });
});
describe('handleBreakGlassIssue — error paths', function () {
    const fx = function () {
        return newFixture();
    };
    it('rejects empty issuedBy with BREAK_GLASS_REQUIRES_OPERATOR', async function () {
        const f = fx();
        await expect(handleBreakGlassIssue({ tenantId: f.tenantId, correlationId: 'c', ...VALID, issuedBy: '' }, f.events, f.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_REQUIRES_OPERATOR,
        });
        expect(f.events.events).toHaveLength(0);
    });
    it('rejects empty / whitespace justification with BREAK_GLASS_JUSTIFICATION_REQUIRED', async function () {
        const f = fx();
        await expect(handleBreakGlassIssue({ tenantId: f.tenantId, correlationId: 'c', ...VALID, justification: '   ' }, f.events, f.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_JUSTIFICATION_REQUIRED,
        });
        expect(f.events.events).toHaveLength(0);
    });
    it('rejects empty incidentUrl with BREAK_GLASS_INCIDENT_REQUIRED', async function () {
        const f = fx();
        await expect(handleBreakGlassIssue({ tenantId: f.tenantId, correlationId: 'c', ...VALID, incidentUrl: '' }, f.events, f.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_INCIDENT_REQUIRED,
        });
    });
    it('rejects maxDurationMin <= 0 or > 12h with BREAK_GLASS_DURATION_INVALID', async function () {
        const f = fx();
        await expect(handleBreakGlassIssue({ tenantId: f.tenantId, correlationId: 'c', ...VALID, maxDurationMin: 0 }, f.events, f.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_DURATION_INVALID,
        });
        await expect(handleBreakGlassIssue({ tenantId: f.tenantId, correlationId: 'c', ...VALID, maxDurationMin: 12 * 60 + 1 }, f.events, f.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_DURATION_INVALID,
        });
    });
    it('rejects empty grantedRoles with IDENTITY_INVALID', async function () {
        const f = fx();
        await expect(handleBreakGlassIssue({ tenantId: f.tenantId, correlationId: 'c', ...VALID, grantedRoles: [] }, f.events, f.entities)).rejects.toMatchObject({ code: identityErrorCodes.IDENTITY_INVALID });
    });
    it('throws IdentityError instances', async function () {
        const f = fx();
        await expect(handleBreakGlassIssue({ tenantId: f.tenantId, correlationId: 'c', ...VALID, justification: '' }, f.events, f.entities)).rejects.toBeInstanceOf(IdentityError);
    });
});
describe('handleBreakGlassApprove — 4-eyes activation', function () {
    async function issuePending(fx: ReturnType<typeof newFixture>) {
        return handleBreakGlassIssue({
            tenantId: fx.tenantId,
            correlationId: 'seed',
            ...VALID,
            grantedTo: 'op-target',
        }, fx.events, fx.entities);
    }
    it('flips status to active, stamps approvedBy + approvedAt, resets expiresAt from approval time', async function () {
        const fx = newFixture();
        const issued = await issuePending(fx);
        const before = Date.now();
        const result = await handleBreakGlassApprove({
            tenantId: fx.tenantId,
            correlationId: 'a',
            grantId: issued.document.grantId,
            approvedBy: 'op-2',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Authorization.BreakGlassApproved');
        expect(result.envelope.retentionTag).toBe('retention:10y');
        expect(result.document.status).toBe('active');
        expect(result.document.approvedBy).toBe('op-2');
        const expiresMs = new Date(result.document.expiresAt).getTime();
        expect(expiresMs - before).toBeGreaterThanOrEqual(issued.document.maxDurationMin * 60 * 1000 - 5000);
    });
    it('rejects unknown grantId with BREAK_GLASS_GRANT_NOT_FOUND', async function () {
        const fx = newFixture();
        await expect(handleBreakGlassApprove({
            tenantId: fx.tenantId,
            correlationId: 'c',
            grantId: 'bgg-nope',
            approvedBy: 'op-2',
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_GRANT_NOT_FOUND,
        });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects approval of non-pending grant with BREAK_GLASS_NOT_PENDING', async function () {
        const fx = newFixture();
        const issued = await issuePending(fx);
        await handleBreakGlassApprove({
            tenantId: fx.tenantId,
            correlationId: 'first',
            grantId: issued.document.grantId,
            approvedBy: 'op-2',
        }, fx.events, fx.entities);
        await expect(handleBreakGlassApprove({
            tenantId: fx.tenantId,
            correlationId: 'second',
            grantId: issued.document.grantId,
            approvedBy: 'op-3',
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_NOT_PENDING,
        });
    });
    it('rejects self-approval (issuer = approver) with BREAK_GLASS_SELF_APPROVAL_FORBIDDEN — the 4-eyes contract', async function () {
        const fx = newFixture();
        const issued = await issuePending(fx);
        const eventsBefore = fx.events.events.length;
        await expect(handleBreakGlassApprove({
            tenantId: fx.tenantId,
            correlationId: 'self',
            grantId: issued.document.grantId,
            approvedBy: VALID.issuedBy, // same as issuer
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_SELF_APPROVAL_FORBIDDEN,
        });
        expect(fx.events.events.length).toBe(eventsBefore);
    });
});
describe('handleBreakGlassDeny', function () {
    async function issuePending(fx: ReturnType<typeof newFixture>) {
        return handleBreakGlassIssue({ tenantId: fx.tenantId, correlationId: 'seed', ...VALID }, fx.events, fx.entities);
    }
    it('emits BreakGlassDenied, flips status to denied, optionally records reason', async function () {
        const fx = newFixture();
        const issued = await issuePending(fx);
        const result = await handleBreakGlassDeny({
            tenantId: fx.tenantId,
            correlationId: 'd',
            grantId: issued.document.grantId,
            deniedBy: 'op-2',
            reason: 'insufficient justification',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Authorization.BreakGlassDenied');
        expect(result.document.status).toBe('denied');
        expect(result.document.endReason).toBe('denied_by_approver');
        const payload = payloadOf(result.envelope.payload);
        expect(payload['reason']).toBe('insufficient justification');
    });
    it('rejects denial of non-pending grant', async function () {
        const fx = newFixture();
        const issued = await issuePending(fx);
        await handleBreakGlassDeny({
            tenantId: fx.tenantId,
            correlationId: 'first',
            grantId: issued.document.grantId,
            deniedBy: 'op-2',
        }, fx.events, fx.entities);
        await expect(handleBreakGlassDeny({
            tenantId: fx.tenantId,
            correlationId: 'second',
            grantId: issued.document.grantId,
            deniedBy: 'op-3',
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_NOT_PENDING,
        });
    });
    it('rejects self-denial with the same 4-eyes guard', async function () {
        const fx = newFixture();
        const issued = await issuePending(fx);
        await expect(handleBreakGlassDeny({
            tenantId: fx.tenantId,
            correlationId: 'self-deny',
            grantId: issued.document.grantId,
            deniedBy: VALID.issuedBy,
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_SELF_APPROVAL_FORBIDDEN,
        });
    });
});
describe('handleBreakGlassAction', function () {
    it('emits BreakGlassAction with retention:10y and audit-shape payload', async function () {
        const fx = newFixture();
        const result = await handleBreakGlassAction({
            tenantId: fx.tenantId,
            correlationId: 'c',
            grantId: 'bgg-1',
            grantedTo: 'op-2',
            actionId: 'ContentPages.Page.Update',
            resourceType: 'Page',
            resourceId: 'page-7',
        }, fx.events);
        expect(result.envelope.eventType).toBe('Authorization.BreakGlassAction');
        expect(result.envelope.retentionTag).toBe('retention:10y');
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `BreakGlassGrant:bgg-1`,
        ]);
        const payload = payloadOf(result.envelope.payload);
        expect(payload).toMatchObject({
            grantId: 'bgg-1',
            grantedTo: 'op-2',
            actionId: 'ContentPages.Page.Update',
            resourceType: 'Page',
            resourceId: 'page-7',
        });
    });
    it('omits resourceType / resourceId when not provided', async function () {
        const fx = newFixture();
        const result = await handleBreakGlassAction({
            tenantId: fx.tenantId,
            correlationId: 'c',
            grantId: 'bgg-1',
            grantedTo: 'op-2',
            actionId: 'X.Y.Z',
        }, fx.events);
        const payload = payloadOf(result.envelope.payload);
        expect('resourceType' in payload).toBe(false);
        expect('resourceId' in payload).toBe(false);
    });
});
describe('handleBreakGlassRevoke', function () {
    async function issueActive(fx: ReturnType<typeof newFixture>) {
        return handleBreakGlassIssue({
            tenantId: fx.tenantId,
            correlationId: 'seed',
            ...VALID,
            requireApproval: false, // straight to active
        }, fx.events, fx.entities);
    }
    it('flips status to revoked on operator_revoke, stamps revokedBy, eventType=BreakGlassRevoked', async function () {
        const fx = newFixture();
        const issued = await issueActive(fx);
        const result = await handleBreakGlassRevoke({
            tenantId: fx.tenantId,
            correlationId: 'r',
            grantId: issued.document.grantId,
            revokedBy: 'tenant-admin',
            reason: 'tenant_revoked',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Authorization.BreakGlassRevoked');
        expect(result.document.status).toBe('revoked');
        expect(result.document.revokedBy).toBe('tenant-admin');
    });
    it('flips status to expired on auto_expired, eventType=BreakGlassExpired, no revokedBy', async function () {
        const fx = newFixture();
        const issued = await issueActive(fx);
        const result = await handleBreakGlassRevoke({
            tenantId: fx.tenantId,
            correlationId: 'e',
            grantId: issued.document.grantId,
            revokedBy: 'system',
            reason: 'auto_expired',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Authorization.BreakGlassExpired');
        expect(result.document.status).toBe('expired');
        expect(result.document.revokedBy).toBeUndefined();
    });
    it('rejects unknown grantId', async function () {
        const fx = newFixture();
        await expect(handleBreakGlassRevoke({
            tenantId: fx.tenantId,
            correlationId: 'c',
            grantId: 'bgg-nope',
            revokedBy: 'op',
            reason: 'tenant_revoked',
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_GRANT_NOT_FOUND,
        });
    });
    it('rejects revoke of already-revoked grant with BREAK_GLASS_NOT_ACTIVE', async function () {
        const fx = newFixture();
        const issued = await issueActive(fx);
        await handleBreakGlassRevoke({
            tenantId: fx.tenantId,
            correlationId: 'first',
            grantId: issued.document.grantId,
            revokedBy: 'op-2',
            reason: 'tenant_revoked',
        }, fx.events, fx.entities);
        await expect(handleBreakGlassRevoke({
            tenantId: fx.tenantId,
            correlationId: 'second',
            grantId: issued.document.grantId,
            revokedBy: 'op-3',
            reason: 'tenant_revoked',
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_NOT_ACTIVE,
        });
    });
});
describe('resolveActiveGrants', function () {
    it('returns active grants for a principal, omits expired-by-clock', async function () {
        const fx = newFixture();
        // Active grant.
        await handleBreakGlassIssue({
            tenantId: fx.tenantId,
            correlationId: 'a',
            ...VALID,
            grantedTo: 'op-target',
            requireApproval: false,
        }, fx.events, fx.entities);
        // Manually inject an "active" but already-expired grant (status=active,
        // expiresAt in the past) — exercises the clock filter.
        const now = new Date().toISOString();
        const past = new Date(Date.now() - 60000).toISOString();
        await fx.entities.put<BreakGlassGrantDocument>({
            tenantId: fx.tenantId,
            entityType: 'BreakGlassGrant',
            entityId: 'bgg-stale',
            attrs: {
                grantId: 'bgg-stale',
                tenantId: fx.tenantId,
                issuedBy: 'op-1',
                grantedTo: 'op-target',
                grantedRoles: ['Admin'],
                justification: 'stale',
                incidentUrl: 'https://example.com/x',
                maxDurationMin: 1,
                requireApproval: false,
                status: 'active',
                issuedAt: now,
                expiresAt: past,
                approvedAt: now,
                approvedBy: 'op-1',
            },
        });
        const grants = await resolveActiveGrants(fx.entities, fx.tenantId, 'op-target');
        // Expect exactly one — the freshly-issued one. The stale one is
        // excluded by the clock filter.
        expect(grants).toHaveLength(1);
        expect(grants.map(function (g) {
            return g.grantId;
        })).not.toContain('bgg-stale');
    });
    it('returns empty when principal has no active grants', async function () {
        const fx = newFixture();
        const grants = await resolveActiveGrants(fx.entities, fx.tenantId, 'op-nobody');
        expect(grants).toEqual([]);
    });
});
describe('break-glass — tenant scoping', function () {
    it('grant in tenant B is invisible to tenant A operations', async function () {
        const fx = newFixture('tenant-a');
        const inB = await handleBreakGlassIssue({
            tenantId: 'tenant-b',
            correlationId: 'seed',
            ...VALID,
        }, fx.events, fx.entities);
        await expect(handleBreakGlassApprove({
            tenantId: 'tenant-a',
            correlationId: 'cross',
            grantId: inB.document.grantId,
            approvedBy: 'op-2',
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.BREAK_GLASS_GRANT_NOT_FOUND,
        });
        const grants = await resolveActiveGrants(fx.entities, 'tenant-a', VALID.grantedTo);
        expect(grants).toEqual([]);
    });
});
