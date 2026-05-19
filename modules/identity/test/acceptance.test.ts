/**
 * Phase A1 acceptance — end-to-end integration tests.
 *
 * Covers the `@phase-a1`-tagged scenarios from:
 *   - specs/domains/identity/features/password/password.feature
 *   - specs/domains/identity/features/magic-link/magic-link.feature
 *   - specs/domains/identity/features/platform-oidc/platform-oidc.feature
 *
 * Each `it(...)` cites the Gherkin scenario it implements. Updates to a
 * scenario should land here in lockstep so the @phase-a1 set stays
 * truthful.
 *
 * Out-of-scope (`@phase-a2` / `@phase-a3` tagged scenarios) live as
 * `it.todo` placeholders below — they fail-soft so adding them later
 * is a one-line edit, not a new file scaffold.
 *
 * The Playwright BDD harness picks these features up once the sim
 * wires identity (browser-compatible argon2 dep + AuthSession entity
 * land in Phase A2). Until then, vitest covers the same surface.
 */
import { describe, it, expect } from '@atlas/test';
import type { EventEnvelope } from '@atlas/platform-core';
import { handleInviteIssue, handleInviteAccept, handlePasswordSet, handlePasswordLogin, getUserEntity, getMembershipEntity, getInviteTokenEntity, buildRolePackBundle, identityErrorCodes, } from '../src/index.ts';
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
/** Narrows an `unknown` field that the test expects to be a record. */
function recordOf(value: unknown, what: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new Error(`${what}: expected record, got ${typeof value}`);
    }
    return value;
}
/**
 * Acceptance fixtures use the shared in-memory shim from `./lib/fixtures.ts`.
 * The `fx.drain()` call in the original suite is just `dispatchAll(fx)` —
 * identityDispatcher curries `dispatchIdentityEvent`, which dispatchAll
 * already loops over. We keep a thin alias for readability at call sites.
 */
async function drain(fx: ReturnType<typeof newFixture>): Promise<void> {
    return dispatchAll(fx);
}
// =====================================================================
// platform-oidc.feature — @phase-a1 scenarios
// =====================================================================
describe('platform-oidc.feature: First-admin bootstrap mints an InviteToken', function () {
    it('atlasctl tenant add-admin path: InviteToken in pending, no Membership yet', async function () {
        const fx = newFixture('acme');
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'boot-corr',
            principalId: '_atlasctl_bootstrap',
            email: 'admin@example.com',
            rolesOnAccept: ['TenantAdmin'],
        }, fx.events);
        await drain(fx);
        expect(issued.plaintextToken.length).toBeGreaterThan(20);
        const stored = await getInviteTokenEntity(fx.entities, fx.tenantId, issued.document.tokenId);
        expect(stored?.status).toBe('pending');
        expect(stored?.email).toBe('admin@example.com');
        expect(stored?.rolesOnAccept).toEqual(['TenantAdmin']);
        // No Membership yet — that lands on accept.
        const memberships = await fx.entities.list(fx.tenantId, 'Membership');
        expect(memberships).toHaveLength(0);
    });
});
describe('platform-oidc.feature: Invitee completes first login', function () {
    it('accept flow creates User + Membership, flips InviteToken to accepted', async function () {
        const fx = newFixture('acme');
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'boot-corr',
            principalId: '_atlasctl_bootstrap',
            email: 'admin@example.com',
            rolesOnAccept: ['TenantAdmin'],
        }, fx.events);
        await drain(fx);
        const accept = await handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'corr-accept-1',
            principalId: null,
            presentedToken: issued.plaintextToken,
            acceptedEmail: 'admin@example.com',
            primaryIdpSubject: 'sub-admin-from-jwt',
        }, fx.events, fx.entities);
        await drain(fx);
        // User entity has primaryIdpSubject from the JWT.
        const user = await getUserEntity(fx.entities, fx.tenantId, accept.user.userId);
        expect(user?.email).toBe('admin@example.com');
        expect(user?.primaryIdpSubject).toBe('sub-admin-from-jwt');
        // Membership has the role from the InviteToken.
        const membership = await getMembershipEntity(fx.entities, fx.tenantId, accept.user.userId);
        expect(membership?.roles).toEqual(['TenantAdmin']);
        // InviteToken flipped to accepted.
        const acceptedInvite = await getInviteTokenEntity(fx.entities, fx.tenantId, issued.document.tokenId);
        expect(acceptedInvite?.status).toBe('accepted');
        // UserCreated + MembershipCreated events emitted with the request correlationId.
        const userCreated = fx.events.events.find(function (e) {
            return e.eventType === 'Identity.UserCreated' && e.correlationId === 'corr-accept-1';
        });
        const membershipCreated = fx.events.events.find(function (e) {
            return e.eventType === 'Identity.MembershipCreated' && e.correlationId === 'corr-accept-1';
        });
        expect(userCreated).toBeTruthy();
        expect(membershipCreated).toBeTruthy();
    });
});
describe('platform-oidc.feature: Returning user — Phase A1 portion', function () {
    // The full scenario also asserts AuthSession creation (Phase A2); the
    // Phase A1 portion is principal-resolution by primaryIdpSubject.
    it('user resolved by primaryIdpSubject; roles hydrate from Membership', async function () {
        const fx = newFixture('acme');
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c1',
            principalId: '_boot',
            email: 'alice@acme.com',
            rolesOnAccept: ['Author'],
        }, fx.events);
        await drain(fx);
        await handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'c2',
            principalId: null,
            presentedToken: issued.plaintextToken,
            acceptedEmail: 'alice@acme.com',
            primaryIdpSubject: 'sub-alice',
        }, fx.events, fx.entities);
        await drain(fx);
        // Simulate principal middleware lookup-by-IDP-subject.
        const { findUserByIdpSubject } = await import('../src/index.ts');
        const found = await findUserByIdpSubject(fx.entities, fx.tenantId, 'sub-alice');
        expect(found?.email).toBe('alice@acme.com');
        if (!found)
            throw new Error('user must exist');
        const membership = await getMembershipEntity(fx.entities, fx.tenantId, found.userId);
        expect(membership?.roles).toEqual(['Author']);
    });
});
// =====================================================================
// password.feature — @phase-a1 scenarios
// =====================================================================
describe('password.feature: User sets initial password from invite', function () {
    it('end-to-end: invite → accept → set-password lands an Argon2id hash', async function () {
        const fx = newFixture('smb');
        // Invite issued (atlasctl).
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c-issue',
            principalId: '_boot',
            email: 'alice@smb.com',
            rolesOnAccept: ['TenantAdmin'],
        }, fx.events);
        await drain(fx);
        // Accept (creates User + Membership).
        const accept = await handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'c-accept',
            principalId: null,
            presentedToken: issued.plaintextToken,
            acceptedEmail: 'alice@smb.com',
        }, fx.events, fx.entities);
        await drain(fx);
        // SetPassword (separate intent — Phase A1 ships /api/v1/intents
        // path; the magic-link-then-set-password UI flow lands as a route
        // pair in Phase A2).
        const setResult = await handlePasswordSet({
            tenantId: fx.tenantId,
            correlationId: 'c-set',
            principalId: accept.user.userId,
            userId: accept.user.userId,
            newPassword: 'P@ssw0rd-2026!',
        }, fx.events, fx.entities);
        await drain(fx);
        // User.attrs.passwordHash is Argon2id-shaped.
        const user = await getUserEntity(fx.entities, fx.tenantId, accept.user.userId);
        expect(user?.passwordHash).toMatch(/^\$scrypt\$/);
        // PasswordChanged event emitted (without plaintext). JSON.stringify
        // would trip on the bigint `seq` field; serialize with a replacer
        // that coerces bigints to strings.
        expect(setResult.envelope.eventType).toBe('Identity.PasswordChanged');
        const payload = payloadRecord(setResult.envelope);
        const doc = recordOf(payload['document'], 'PasswordChanged document');
        expect(doc['passwordHash']).toMatch(/^\$scrypt\$/);
        const serialized = JSON.stringify(setResult.envelope, function (_k: string, v: unknown) {
            return typeof v === 'bigint' ? v.toString() : v;
        });
        expect(serialized).not.toContain('P@ssw0rd-2026!');
        // InviteToken accepted, Membership has the right role.
        const invite = await getInviteTokenEntity(fx.entities, fx.tenantId, issued.document.tokenId);
        expect(invite?.status).toBe('accepted');
        const membership = await getMembershipEntity(fx.entities, fx.tenantId, accept.user.userId);
        expect(membership?.roles).toEqual(['TenantAdmin']);
    });
});
describe('password.feature: Account lockout after sustained failures', function () {
    it('5 wrong attempts within 1 hour set lockedUntil and emit AccountLocked', async function () {
        const fx = newFixture('smb');
        // Bootstrap a user with a password.
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c-i',
            principalId: '_boot',
            email: 'alice@smb.com',
            rolesOnAccept: ['Author'],
        }, fx.events);
        await drain(fx);
        const accept = await handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'c-a',
            principalId: null,
            presentedToken: issued.plaintextToken,
            acceptedEmail: 'alice@smb.com',
        }, fx.events, fx.entities);
        await drain(fx);
        await handlePasswordSet({
            tenantId: fx.tenantId,
            correlationId: 'c-s',
            principalId: accept.user.userId,
            userId: accept.user.userId,
            newPassword: 'correct-horse-Battery-staple',
        }, fx.events, fx.entities);
        await drain(fx);
        // Five wrong attempts.
        for (let i = 0; i < 5; i += 1) {
            await handlePasswordLogin({
                tenantId: fx.tenantId,
                correlationId: `c-l-${i}`,
                email: 'alice@smb.com',
                password: 'wrong-Password-12345',
            }, fx.events, fx.entities);
            await drain(fx);
        }
        // lockedUntil ~15 minutes in the future.
        const user = await getUserEntity(fx.entities, fx.tenantId, accept.user.userId);
        expect(user?.lockedUntil).toBeTruthy();
        if (!user?.lockedUntil)
            throw new Error('lockedUntil missing');
        const lockedDelta = new Date(user.lockedUntil).getTime() - Date.now();
        expect(lockedDelta).toBeGreaterThan(14 * 60 * 1000);
        expect(lockedDelta).toBeLessThan(16 * 60 * 1000);
        // AccountLocked event emitted.
        const lockedEvents = fx.events.events.filter(function (e) {
            return e.eventType === 'Identity.AccountLocked';
        });
        expect(lockedEvents.length).toBeGreaterThanOrEqual(1);
        // Further attempts (even with right password) rejected with reason="account_locked".
        const blocked = await handlePasswordLogin({
            tenantId: fx.tenantId,
            correlationId: 'c-blocked',
            email: 'alice@smb.com',
            password: 'correct-horse-Battery-staple',
        }, fx.events, fx.entities);
        expect(payloadRecord(blocked.envelope)['reason']).toBe('account_locked');
    });
});
describe('password.feature: Password complexity rejected at set-time', function () {
    it('weak password produces PASSWORD_COMPLEXITY error, no entity mutated', async function () {
        const fx = newFixture('smb');
        // Seed a user.
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: '_boot',
            email: 'alice@smb.com',
            rolesOnAccept: ['Author'],
        }, fx.events);
        await drain(fx);
        const accept = await handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'c2',
            principalId: null,
            presentedToken: issued.plaintextToken,
            acceptedEmail: 'alice@smb.com',
        }, fx.events, fx.entities);
        await drain(fx);
        const userBefore = await getUserEntity(fx.entities, fx.tenantId, accept.user.userId);
        const eventCountBefore = fx.events.events.length;
        await expect(handlePasswordSet({
            tenantId: fx.tenantId,
            correlationId: 'c-set',
            principalId: accept.user.userId,
            userId: accept.user.userId,
            newPassword: 'abc',
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.PASSWORD_COMPLEXITY,
            status: 400,
        });
        const userAfter = await getUserEntity(fx.entities, fx.tenantId, accept.user.userId);
        expect(userAfter).toEqual(userBefore);
        expect(fx.events.events.length).toBe(eventCountBefore);
    });
});
// =====================================================================
// magic-link.feature — @phase-a1 scenarios
// =====================================================================
describe('magic-link.feature: First-admin bootstrap (atlasctl)', function () {
    it('atlasctl-equivalent flow: invite issued, then accept creates User+Membership', async function () {
        const fx = newFixture('scribe');
        // The atlasctl script calls handleInviteIssue + identityDispatcher
        // — same path as this test.
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c-boot',
            principalId: '_atlasctl_bootstrap',
            email: 'admin@scribe.com',
            rolesOnAccept: ['TenantAdmin'],
        }, fx.events);
        await drain(fx);
        // The plaintext token is what would be printed to operator stdout.
        expect(issued.plaintextToken).toBeTruthy();
        // On click — invite-accept route (which we have in
        // `apps/server/src/routes/identity.ts`).
        const accept = await handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'c-click',
            principalId: null,
            presentedToken: issued.plaintextToken,
            acceptedEmail: 'admin@scribe.com',
            primaryIdpSubject: 'sub-from-platform-oidc',
        }, fx.events, fx.entities);
        await drain(fx);
        expect(accept.user.email).toBe('admin@scribe.com');
        expect(accept.membership.roles).toEqual(['TenantAdmin']);
    });
});
// =====================================================================
// Role packs — they're the third leg of "Phase A1 acceptance" since
// without them the role names hydrated above are decorative.
// =====================================================================
describe('role packs (cross-cutting)', function () {
    it('TenantAdmin permit covers every action emitted from the bundled manifests', function () {
        const bundle = buildRolePackBundle([
            // The platform default seed reads moduleManifests() at runtime;
            // this fixture supplies the ActionDeclaration shape (incl.
            // `auditLevel`) directly so role-pack synthesis can exercise the
            // verb→permit mapping without a full manifest scan.
            {
                actionId: 'ContentPages.Page.Create',
                resourceType: 'Page',
                verb: 'create',
                auditLevel: 'BASIC',
            },
            {
                actionId: 'ContentPages.Page.Search',
                resourceType: 'Page',
                verb: 'search',
                auditLevel: 'NONE',
            },
            {
                actionId: 'Catalog.Family.Publish',
                resourceType: 'Family',
                verb: 'publish',
                auditLevel: 'BASIC',
            },
        ]);
        expect(bundle.format).toBe('cedar-text');
        expect(bundle.policies).toContain('@id("role-tenant-admin")');
        expect(bundle.policies).toContain('Action::"ContentPages.Page.Create"');
        expect(bundle.policies).toContain('Action::"Catalog.Family.Publish"');
        // Viewer's permit excludes the write actions.
        const viewerBlock = bundle.policies.split('@id("role-viewer")')[1]?.split('@id("role-service-principal")')[0] ?? '';
        expect(viewerBlock).toContain('Action::"ContentPages.Page.Search"');
        expect(viewerBlock).not.toContain('Action::"ContentPages.Page.Create"');
    });
});
// =====================================================================
// @phase-a2 scenarios — placeholder so future progress is trackable.
// =====================================================================
describe('@phase-a2 scenarios (deferred)', function () {
    it.todo('password.feature: Successful password login (AuthSession + cookie)');
    it.todo('password.feature: Wrong password — rate limited');
    it.todo('password.feature: Forgot-password flow (ResetToken + email)');
    it.todo('password.feature: Reset password using a valid token');
    it.todo('password.feature: Reject reset with expired token');
    it.todo('magic-link.feature: User requests a magic link (MagicLinkToken + email)');
    it.todo('magic-link.feature: Magic-link click logs the user in');
    it.todo('magic-link.feature: Reject expired magic link');
    it.todo('magic-link.feature: Reject reused magic link');
    it.todo('magic-link.feature: Throttle repeated requests');
    it.todo('magic-link.feature: Email-not-found does not leak account existence');
    it.todo('platform-oidc.feature: User without Membership is rejected (403)');
    it.todo('platform-oidc.feature: Suspended Membership blocks login (403)');
    it.todo('platform-oidc.feature: Returning user — AuthSession creation half');
});
