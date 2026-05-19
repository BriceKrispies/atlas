/**
 * Cross-tenant isolation contract for `modules/identity/src/queries.ts`.
 *
 * Mechanically asserts Invariants I7 + I9 at the query layer: every read
 * exposed by `queries.ts` is scoped to a single tenant via the
 * `IdentityQueryDeps.tenantId` parameter. Seeding both `tenant-a` and
 * `tenant-b` rows into the SAME entity store and then probing each query
 * from `tenant-a`'s perspective MUST never surface a `tenant-b` row.
 *
 * The test fixture uses the in-memory `EntityStore` shim from
 * `test/lib/fixtures.ts`, which honours the `tenantId` argument the way
 * the production Postgres adapter does (filters by the column on every
 * read). If a future query forgets to thread `tenantId` through, the
 * fixture will return cross-tenant rows and the matching assertion here
 * fires.
 *
 * Coverage: every export from `queries.ts`:
 *   - getUser, getUserByEmail, getUserByIdpSubject, listAllUsers
 *   - getMembership, listMemberships
 *   - getInviteToken
 *   - getSession, listOwnSessions, findSessionsByAccessTokenLookup
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { AUTH_SESSION_ENTITY_TYPE, INVITE_TOKEN_ENTITY_TYPE, MEMBERSHIP_ENTITY_TYPE, USER_ENTITY_TYPE, findSessionsByAccessTokenLookup, getInviteToken, getMembership, getSession, getUser, getUserByEmail, getUserByIdpSubject, listAllUsers, listMemberships, listOwnSessions, membershipEntityIdFor, type AuthSessionDocument, type IdentityQueryDeps, type InviteTokenDocument, type MembershipDocument, type UserDocument, } from '../src/index.ts';
import { InMemoryEntityStore, InMemoryRelationStore } from './lib/fixtures.ts';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
let entities: InMemoryEntityStore;
let relations: InMemoryRelationStore;
function depsFor(tenantId: string): IdentityQueryDeps {
    return {
        tenantId,
        principalId: 'usr-anon',
        correlationId: 'corr-iso',
        entities,
        relations,
    };
}
function userDoc(tenantId: string, userId: string, overrides: Partial<UserDocument> = {}): UserDocument {
    return {
        userId,
        email: `${userId}@${tenantId}.example`,
        status: 'active',
        primaryIdpSubject: `idp-${userId}`,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
        ...overrides,
    };
}
async function seedUser(tenantId: string, doc: UserDocument): Promise<void> {
    await entities.put<UserDocument>({
        tenantId,
        entityType: USER_ENTITY_TYPE,
        entityId: doc.userId,
        attrs: doc,
        schemaVersion: 1,
    });
}
async function seedMembership(doc: MembershipDocument): Promise<void> {
    await entities.put<MembershipDocument>({
        tenantId: doc.tenantId,
        entityType: MEMBERSHIP_ENTITY_TYPE,
        entityId: membershipEntityIdFor(doc.userId),
        attrs: doc,
        schemaVersion: 1,
    });
}
async function seedInvite(tenantId: string, doc: InviteTokenDocument): Promise<void> {
    await entities.put<InviteTokenDocument>({
        tenantId,
        entityType: INVITE_TOKEN_ENTITY_TYPE,
        entityId: doc.tokenId,
        attrs: doc,
        schemaVersion: 1,
    });
}
async function seedSession(tenantId: string, doc: AuthSessionDocument): Promise<void> {
    await entities.put<AuthSessionDocument>({
        tenantId,
        entityType: AUTH_SESSION_ENTITY_TYPE,
        entityId: doc.sessionId,
        attrs: doc,
        schemaVersion: 1,
    });
}
beforeEach(function () {
    entities = new InMemoryEntityStore();
    relations = new InMemoryRelationStore();
});
// ----------------------------------------------------------------------
// Users
// ----------------------------------------------------------------------
describe('cross-tenant isolation: User queries', function () {
    it('getUser scoped to tenant A never returns tenant B rows', async function () {
        await seedUser(TENANT_A, userDoc(TENANT_A, 'usr-shared'));
        await seedUser(TENANT_B, userDoc(TENANT_B, 'usr-shared'));
        const aResult = await getUser(depsFor(TENANT_A), 'usr-shared');
        const bResult = await getUser(depsFor(TENANT_B), 'usr-shared');
        const aUser = assertDefined(aResult, 'tenant A seeded usr-shared above');
        expect(aUser.email).toBe(`usr-shared@${TENANT_A}.example`);
        const bUser = assertDefined(bResult, 'tenant B seeded usr-shared above');
        expect(bUser.email).toBe(`usr-shared@${TENANT_B}.example`);
    });
    it('getUser returns null when target user only exists in another tenant (I7)', async function () {
        // Seed B but not A.
        await seedUser(TENANT_B, userDoc(TENANT_B, 'usr-bonly'));
        const aResult = await getUser(depsFor(TENANT_A), 'usr-bonly');
        expect(aResult).toBeNull();
    });
    it('getUserByEmail does not leak across tenants', async function () {
        await seedUser(TENANT_B, userDoc(TENANT_B, 'usr-b1', { email: 'shared@example.com' }));
        const aResult = await getUserByEmail(depsFor(TENANT_A), 'shared@example.com');
        expect(aResult).toBeNull();
    });
    it('getUserByIdpSubject does not leak across tenants', async function () {
        await seedUser(TENANT_B, userDoc(TENANT_B, 'usr-b1', { primaryIdpSubject: 'sub-shared' }));
        const aResult = await getUserByIdpSubject(depsFor(TENANT_A), 'sub-shared');
        expect(aResult).toBeNull();
    });
    it('listAllUsers returns only the requested tenant\'s users', async function () {
        await seedUser(TENANT_A, userDoc(TENANT_A, 'usr-a1'));
        await seedUser(TENANT_A, userDoc(TENANT_A, 'usr-a2'));
        await seedUser(TENANT_B, userDoc(TENANT_B, 'usr-b1'));
        const aResult = await listAllUsers(depsFor(TENANT_A));
        expect(aResult.map(function (u) {
            return u.userId;
        }).sort()).toEqual(['usr-a1', 'usr-a2']);
        // Crucially: no `usr-b1` regardless of how listAllUsers filters internally.
        expect(aResult.some(function (u) {
            return u.userId === 'usr-b1';
        })).toBe(false);
    });
});
// ----------------------------------------------------------------------
// Memberships
// ----------------------------------------------------------------------
describe('cross-tenant isolation: Membership queries', function () {
    function membership(tenantId: string, userId: string): MembershipDocument {
        return {
            membershipId: `mem-${tenantId}-${userId}`,
            tenantId,
            userId,
            roles: ['Member'],
            status: 'active',
            createdAt: '2026-05-01T00:00:00Z',
            updatedAt: '2026-05-01T00:00:00Z',
        };
    }
    it('getMembership does not return another tenant\'s membership for the same userId', async function () {
        await seedMembership(membership(TENANT_B, 'usr-shared'));
        const aResult = await getMembership(depsFor(TENANT_A), 'usr-shared');
        expect(aResult).toBeNull();
    });
    it('listMemberships returns only the requested tenant\'s rows', async function () {
        await seedMembership(membership(TENANT_A, 'usr-a1'));
        await seedMembership(membership(TENANT_A, 'usr-a2'));
        await seedMembership(membership(TENANT_B, 'usr-b1'));
        const aResult = await listMemberships(depsFor(TENANT_A));
        expect(aResult.map(function (m) {
            return m.userId;
        }).sort()).toEqual(['usr-a1', 'usr-a2']);
        expect(aResult.every(function (m) {
            return m.tenantId === TENANT_A;
        })).toBe(true);
    });
});
// ----------------------------------------------------------------------
// Invite tokens
// ----------------------------------------------------------------------
describe('cross-tenant isolation: InviteToken query', function () {
    function invite(tenantId: string, tokenId: string): InviteTokenDocument {
        // Build through a `satisfies` pin so any future field add to
        // InviteTokenDocument shows up here as a compile error instead of
        // silently leaving a partial test record behind a double-cast.
        return {
            tokenId,
            tenantId,
            email: `invitee@${tenantId}.example`,
            tokenHash: 'h',
            tokenLookup: 'l',
            rolesOnAccept: ['Member'],
            expiresAt: '2026-06-01T00:00:00Z',
            status: 'pending',
            createdAt: '2026-05-01T00:00:00Z',
        } satisfies InviteTokenDocument;
    }
    it('getInviteToken scoped to tenant A never returns tenant B token (I7)', async function () {
        await seedInvite(TENANT_B, invite(TENANT_B, 'tok-shared'));
        const aResult = await getInviteToken(depsFor(TENANT_A), 'tok-shared');
        expect(aResult).toBeNull();
    });
});
// ----------------------------------------------------------------------
// Sessions
// ----------------------------------------------------------------------
describe('cross-tenant isolation: Session queries', function () {
    function session(tenantId: string, sessionId: string, userId: string, accessTokenLookup = 'lookup-shared'): AuthSessionDocument {
        // `satisfies` keeps the test record honest with the real shape — if
        // AuthSessionDocument gains a required field, this stops compiling.
        return {
            sessionId,
            tenantId,
            userId,
            status: 'active',
            issuedAt: '2026-05-01T00:00:00Z',
            lastSeenAt: '2026-05-01T00:00:00Z',
            lastRefreshedAt: '2026-05-01T00:00:00Z',
            accessExpiresAt: '2026-05-02T00:00:00Z',
            hardExpiresAt: '2026-05-02T00:00:00Z',
            accessTokenHash: 'ah',
            accessTokenLookup,
            refreshTokenHash: 'rh',
            refreshTokenLookup: 'rl',
        } satisfies AuthSessionDocument;
    }
    it('getSession scoped to tenant A never returns tenant B session', async function () {
        await seedSession(TENANT_B, session(TENANT_B, 'sess-shared', 'usr-b'));
        const aResult = await getSession(depsFor(TENANT_A), 'sess-shared');
        expect(aResult).toBeNull();
    });
    it('listOwnSessions returns only sessions for the requested tenant + user', async function () {
        await seedSession(TENANT_A, session(TENANT_A, 'sess-a1', 'usr-shared'));
        await seedSession(TENANT_B, session(TENANT_B, 'sess-b1', 'usr-shared'));
        const aResult = await listOwnSessions(depsFor(TENANT_A), 'usr-shared');
        expect(aResult.map(function (s) {
            return s.sessionId;
        })).toEqual(['sess-a1']);
        expect(aResult.every(function (s) {
            return s.tenantId === TENANT_A;
        })).toBe(true);
    });
    it('findSessionsByAccessTokenLookup never crosses tenant boundary even with the same lookup prefix', async function () {
        // Both sessions share a lookup prefix — the *only* thing keeping them
        // apart is `tenantId`. If query misses the tenant filter, this test
        // fires.
        const sharedLookup = 'lookup-collision';
        await seedSession(TENANT_A, session(TENANT_A, 'sess-a', 'usr-a', sharedLookup));
        await seedSession(TENANT_B, session(TENANT_B, 'sess-b', 'usr-b', sharedLookup));
        const aResult = await findSessionsByAccessTokenLookup(depsFor(TENANT_A), sharedLookup);
        expect(aResult.map(function (s) {
            return s.sessionId;
        })).toEqual(['sess-a']);
        expect(aResult.every(function (s) {
            return s.tenantId === TENANT_A;
        })).toBe(true);
    });
});
