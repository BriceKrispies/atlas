/**
 * Identity handler unit tests.
 *
 * Exercises user-create / membership-create / invite-issue / invite-accept
 * against in-memory implementations of EventStore, EntityStore, and
 * RelationStore. Asserts the I12 invariant: the dispatcher rebuilds the
 * post-state from event history alone.
 */
import { describe, it, expect } from 'vitest';
import { handleUserCreate, handleMembershipCreate, handleInviteIssue, handleInviteAccept, getUserEntity, getMembershipEntity, getInviteTokenEntity, IdentityError, identityErrorCodes, hashSecret, lookupOf, type UserDocument, } from '../src/index.ts';
import { newFixture, dispatchAll } from './lib/fixtures.ts';
describe('Identity.User.Create', function () {
    it('emits UserCreated with platform + tenant cache tags', async function () {
        const fx = newFixture();
        const result = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'corr-1',
            principalId: 'admin-1',
            email: 'Alice@Example.com',
            primaryIdpSubject: 'sub-alice',
        }, fx.events);
        expect(result.envelope.eventType).toBe('Identity.UserCreated');
        expect(result.envelope.cacheInvalidationTags).toContain('Tenant:t1');
        // Email is normalized to lowercase.
        expect(result.document.email).toBe('alice@example.com');
        expect(result.document.primaryIdpSubject).toBe('sub-alice');
    });
    it('dispatcher persists to platform partition', async function () {
        const fx = newFixture();
        const result = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'p',
            email: 'bob@example.com',
        }, fx.events);
        await dispatchAll(fx);
        const stored = await getUserEntity(fx.entities, fx.tenantId, result.document.userId);
        expect(stored?.email).toBe('bob@example.com');
    });
});
describe('Identity.Membership.Create', function () {
    it('refuses when user does not exist', async function () {
        const fx = newFixture();
        await expect(handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'p',
            userId: 'usr-nonexistent',
            roles: ['Author'],
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.USER_NOT_FOUND });
    });
    it('writes membership + relation edge through dispatcher', async function () {
        const fx = newFixture();
        const userResult = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'p',
            email: 'alice@example.com',
        }, fx.events);
        await dispatchAll(fx);
        await handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'p',
            userId: userResult.document.userId,
            roles: ['TenantAdmin'],
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const m = await getMembershipEntity(fx.entities, fx.tenantId, userResult.document.userId);
        expect(m?.roles).toEqual(['TenantAdmin']);
        // membership.user edge present, pointing at the same-tenant user row.
        const edges = await fx.relations.outgoing(fx.tenantId, 'membership.user', `m:${userResult.document.userId}`);
        expect(edges).toHaveLength(1);
        expect(edges[0]?.toId).toBe(userResult.document.userId);
    });
    it('refuses duplicate membership for same (tenant, user)', async function () {
        const fx = newFixture();
        const userResult = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'p',
            email: 'alice@example.com',
        }, fx.events);
        await dispatchAll(fx);
        await handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'p',
            userId: userResult.document.userId,
            roles: ['Viewer'],
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        await expect(handleMembershipCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'p',
            userId: userResult.document.userId,
            roles: ['Author'],
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
    });
});
describe('Identity.Invite.Issue + Accept', function () {
    it('issues a token, accepts it, and creates User + Membership', async function () {
        const fx = newFixture();
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'charlie@example.com',
            rolesOnAccept: ['Author'],
        }, fx.events);
        expect(issued.plaintextToken.length).toBeGreaterThan(20);
        expect(issued.document.tokenHash).toBe(hashSecret(issued.plaintextToken));
        expect(issued.document.tokenLookup).toBe(lookupOf(issued.plaintextToken));
        await dispatchAll(fx);
        // Persisted invite is in pending.
        const stored = await getInviteTokenEntity(fx.entities, fx.tenantId, issued.document.tokenId);
        expect(stored?.status).toBe('pending');
        const accept = await handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            presentedToken: issued.plaintextToken,
            acceptedEmail: 'charlie@example.com',
            primaryIdpSubject: 'sub-charlie',
        }, fx.events, fx.entities);
        expect(accept.envelope.eventType).toBe('Identity.InviteAccepted');
        // Follow chain: pre-primary UserCreated + MembershipCreated, plus
        // the post-primary SessionIssued (A2.3 wires session creation into
        // invite-accept). The order is [UserCreated, MembershipCreated,
        // ...evictedSessions, SessionIssued] — no evictions on first
        // session for a new user.
        expect(accept.follow.map(function (e) {
            return e.eventType;
        })).toEqual([
            'Identity.UserCreated',
            'Identity.MembershipCreated',
            'Identity.SessionIssued',
        ]);
        await dispatchAll(fx);
        // Invite flipped to accepted.
        const acceptedInvite = await getInviteTokenEntity(fx.entities, fx.tenantId, issued.document.tokenId);
        expect(acceptedInvite?.status).toBe('accepted');
        expect(acceptedInvite?.acceptedUserId).toBe(accept.user.userId);
        // User exists in tenant partition.
        const user = await getUserEntity(fx.entities, fx.tenantId, accept.user.userId);
        expect(user?.email).toBe('charlie@example.com');
        expect(user?.primaryIdpSubject).toBe('sub-charlie');
        // Membership minted with invite's roles.
        const membership = await getMembershipEntity(fx.entities, fx.tenantId, accept.user.userId);
        expect(membership?.roles).toEqual(['Author']);
    });
    it('rejects bogus token', async function () {
        const fx = newFixture();
        await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'dave@example.com',
            rolesOnAccept: ['Viewer'],
        }, fx.events);
        await dispatchAll(fx);
        await expect(handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            presentedToken: 'not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaa',
            acceptedEmail: 'dave@example.com',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.INVITE_NOT_FOUND });
    });
    it('rejects expired token', async function () {
        const fx = newFixture();
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'eve@example.com',
            rolesOnAccept: ['Viewer'],
            ttlSeconds: -1, // already expired
        }, fx.events);
        await dispatchAll(fx);
        await expect(handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            presentedToken: issued.plaintextToken,
            acceptedEmail: 'eve@example.com',
        }, fx.events, fx.entities)).rejects.toMatchObject({ code: identityErrorCodes.INVITE_EXPIRED });
    });
    it('reuses existing user when invite email matches', async function () {
        const fx = newFixture();
        const userResult = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'frank@example.com',
        }, fx.events);
        await dispatchAll(fx);
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'frank@example.com',
            rolesOnAccept: ['Author'],
        }, fx.events);
        await dispatchAll(fx);
        const accept = await handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            presentedToken: issued.plaintextToken,
            acceptedEmail: 'frank@example.com',
        }, fx.events, fx.entities);
        expect(accept.user.userId).toBe(userResult.document.userId);
        // No follow-up UserCreated when reusing — but SessionIssued still
        // lands (A2.3 wires session creation on accept).
        expect(accept.follow.map(function (e) {
            return e.eventType;
        })).toEqual([
            'Identity.MembershipCreated',
            'Identity.SessionIssued',
        ]);
    });
});
describe('I12 — projections rebuild from event history alone', function () {
    it('replaying the full event log reproduces the post-state', async function () {
        const fx = newFixture();
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            email: 'rebuild@example.com',
            rolesOnAccept: ['TenantAdmin'],
        }, fx.events);
        await dispatchAll(fx);
        await handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            presentedToken: issued.plaintextToken,
            acceptedEmail: 'rebuild@example.com',
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        // Snapshot post-state.
        const before = JSON.stringify({
            entities: Array.from(fx.entities.rows.entries()).sort(),
            relations: Array.from(fx.relations.rows.entries()).sort(),
        });
        // Wipe projections, replay events through dispatcher only.
        fx.entities.rows.clear();
        fx.relations.rows.clear();
        await dispatchAll(fx);
        const after = JSON.stringify({
            entities: Array.from(fx.entities.rows.entries()).sort(),
            relations: Array.from(fx.relations.rows.entries()).sort(),
        });
        // The dispatcher stamps `updatedAt` / `createdAt` from `Date.now()`
        // on each put — replay timestamps drift by a few ms. We care that
        // the *shape* (entities by id, edges by id, attrs payload) is
        // identical, not the wall-clock fields. Strip volatile timestamps
        // before comparing.
        function strip(s: string): string {
            return s
                .replace(/"updatedAt":"[^"]+"/g, '"updatedAt":"<t>"')
                .replace(/"createdAt":"[^"]+"/g, '"createdAt":"<t>"');
        }
        expect(strip(before)).toBe(strip(after));
        // Sanity: the rebuilt user is reachable and has the right email.
        const rebuiltUsers = await fx.entities.list<UserDocument>(fx.tenantId, 'User');
        expect(rebuiltUsers.map(function (u) {
            return u.attrs.email;
        })).toContain('rebuild@example.com');
    });
});
