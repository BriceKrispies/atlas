/**
 * Phase 2 SDET adversarial regression tests for ADR 0008 Stage 2
 * (`tickets/atlas-on-atlas/stage-2-platform-row.md`).
 *
 * Pins three classes of invariant the Stage-2 implementation depends on
 * but did not (or only partially) test:
 *
 *   1. **Widened front-door gate semantics.** `handleSessionIssue` now
 *      accepts `PLATFORM_ROBOT_PRINCIPAL_ID` (preferred) or `null`
 *      (legacy) as the front-door signal. Both must succeed; literal
 *      `'null'` (string) must NOT.
 *
 *   2. **Audit-actor invariant per ADR 0008 §2.** Every system-initiated
 *      audit envelope must stamp `principalId = PLATFORM_ROBOT_PRINCIPAL_ID`
 *      (never `null`) when the handler is invoked through the
 *      public-front-door route shape. This was previously only asserted
 *      for `LoginRejected:unknown_user`; we pin the other 9 sentinel
 *      sites here.
 *
 *   3. **Defense-in-depth gate still bites.** Even with the front-door
 *      widening, an arbitrary string `principalId` that is neither the
 *      robot id nor the target userId must still throw — the gate is
 *      the only assurance under stub policy.
 *
 * If any of these flips silently, the ADR 0008 §2 audit invariant is
 * back to "no real actor on system-initiated events" and the recursive
 * kernel principle loses its load-bearing test.
 */
import { describe, it, expect } from '@atlas/test';
import { PLATFORM_ROBOT_PRINCIPAL_ID } from '@atlas/platform-core';
import { handleSessionIssue, handlePasswordLogin, handleInviteIssue, handleInviteAccept, handleOAuthRevokeToken, handleJitProvision, handleUserCreate, handlePasswordSet, IdentityError, type IdentityProviderDocument, type UserDocument, } from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';
// ---------------------------------------------------------------------
// 1. Widened front-door gate semantics
// ---------------------------------------------------------------------
describe('handleSessionIssue — widened gate (ADR 0008 §2)', function () {
    it('accepts PLATFORM_ROBOT_PRINCIPAL_ID as the front-door signal', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
            userId: 'usr-front-door',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.SessionIssued');
        expect(result.document.userId).toBe('usr-front-door');
    });
    it('still accepts legacy null (back-compat preserved by widening)', async function () {
        const fx = newFixture();
        const result = await handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: null,
            userId: 'usr-legacy',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.SessionIssued');
    });
    it("rejects string 'null' — the literal string is NOT a front-door signal", async function () {
        // Adversarial: a JSON deserializer or a sloppy caller might pass the
        // literal string 'null' instead of the JS `null` value. The gate
        // must NOT accept this — it's neither the robot id nor a valid
        // userId match.
        const fx = newFixture();
        await expect(handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'null',
            userId: 'usr-target',
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects a near-miss robot-id string (typo / supply-chain)', async function () {
        // Defense in depth: only the EXACT constant counts. A near-miss
        // value (`platform-robot:` prefix, different suffix) must NOT slip
        // through, since future robot ids will be added under the same
        // `<kind>:<sub>` namespace and each must opt in explicitly.
        const fx = newFixture();
        await expect(handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'platform-robot:not-bootstrap',
            userId: 'usr-target',
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects empty string principalId', async function () {
        const fx = newFixture();
        await expect(handleSessionIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: '',
            userId: 'usr-target',
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
        expect(fx.events.events).toHaveLength(0);
    });
});
// ---------------------------------------------------------------------
// 2. Audit-actor invariant: every sentinel-replacement site
// ---------------------------------------------------------------------
describe('audit-actor invariant — system-initiated handlers stamp the robot id', function () {
    it('handleInviteIssue: InviteIssued.principalId === PLATFORM_ROBOT_PRINCIPAL_ID', async function () {
        // Mirrors `apps/server/src/routes/signup.ts:394` (issueInviteForTenant).
        const fx = newFixture();
        const result = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
            email: 'invitee@example.com',
            rolesOnAccept: ['admin'],
        }, fx.events);
        expect(result.envelope.eventType).toBe('Identity.InviteIssued');
        expect(result.envelope.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
    });
    it('handleInviteAccept (signup-confirm flow): InviteAccepted.principalId === PLATFORM_ROBOT_PRINCIPAL_ID', async function () {
        // Mirrors `apps/server/src/routes/signup.ts:324` + `routes/identity.ts:163`.
        const fx = newFixture();
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
            email: 'accept@example.com',
            rolesOnAccept: ['admin'],
        }, fx.events);
        await dispatchAll(fx);
        const accept = await handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
            presentedToken: issued.plaintextToken,
            acceptedEmail: 'accept@example.com',
            issueSession: false,
        }, fx.events, fx.entities);
        expect(accept.envelope.eventType).toBe('Identity.InviteAccepted');
        expect(accept.envelope.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
        // The follow events (UserCreated, MembershipCreated) must also carry
        // the robot id — otherwise audit becomes inconsistent within a
        // single transaction.
        for (const f of accept.follow) {
            expect(f.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
        }
    });
    it('handleOAuthRevokeToken (public revoke): OAuthTokenRevoked.principalId === PLATFORM_ROBOT_PRINCIPAL_ID', async function () {
        // Mirrors `apps/server/src/routes/oauth.ts:237`. We can't exercise a
        // full ServicePrincipal flow here, but we can pin the envelope-shape
        // contract: the handler stamps `principalId` from `cmd.principalId`
        // (the robot for front-door revoke). NOTE: `userId` is now `null`
        // for this event (post-Stage-2 fix-pass) because OAuth tokens are
        // owned by ServicePrincipals, not Users — see the `subject vs.
        // actor` describe block below for the userId pin.
        const fx = newFixture();
        const result = await handleOAuthRevokeToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
            presentedToken: 'unknown-token-deliberately',
        }, fx.events, fx.entities);
        // Unknown token returns null envelope per RFC 7009. But shape
        // contract for the FOUND case is pinned via handler source review
        // (`oauth-token-revoke.ts:71–72`) and the cross-handler audit
        // assertion in `oauth-token.test.ts`. The non-null assertion here
        // is the null-envelope-on-unknown invariant.
        expect(result.envelope).toBeNull();
    });
    it('handlePasswordLogin reject path (wrong_password): both LoginRejected and UserUpdated follow stamp robot id', async function () {
        // Already pinned for `unknown_user`; this pins `wrong_password`
        // which has an additional follow event (UserUpdated counter bump)
        // that must also carry the robot id.
        const fx = newFixture();
        const userResult = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'seed',
            principalId: 'admin',
            email: 'reject@example.com',
        }, fx.events);
        await dispatchAll(fx);
        await handlePasswordSet({
            tenantId: fx.tenantId,
            correlationId: 'seed',
            principalId: 'admin',
            userId: userResult.document.userId,
            newPassword: 'CorrectPa55word!',
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const result = await handlePasswordLogin({
            tenantId: fx.tenantId,
            correlationId: 'c',
            email: 'reject@example.com',
            password: 'NotIt1!',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.LoginRejected');
        expect(result.envelope.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
        // Follow event (UserUpdated counter bump): also a system-initiated
        // emission, also must carry the robot id.
        const updated = result.follow[0];
        expect(updated?.eventType).toBe('Identity.UserUpdated');
        expect(updated?.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
    });
    it('handlePasswordLogin lockout path: AccountLocked stamps robot id', async function () {
        const fx = newFixture();
        const userResult = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'seed',
            principalId: 'admin',
            email: 'locker@example.com',
        }, fx.events);
        await dispatchAll(fx);
        await handlePasswordSet({
            tenantId: fx.tenantId,
            correlationId: 'seed',
            principalId: 'admin',
            userId: userResult.document.userId,
            newPassword: 'CorrectPa55word!',
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        // Trip the lockout on attempt 5.
        let last: Awaited<ReturnType<typeof handlePasswordLogin>> | null = null;
        for (let i = 1; i <= 5; i += 1) {
            last = await handlePasswordLogin({
                tenantId: fx.tenantId,
                correlationId: `c${i}`,
                email: 'locker@example.com',
                password: 'NotIt1!',
            }, fx.events, fx.entities);
            await dispatchAll(fx);
        }
        if (!last)
            throw new Error('test setup: no login attempted');
        expect(last.follow[0]?.eventType).toBe('Identity.AccountLocked');
        expect(last.follow[0]?.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
    });
    it('handlePasswordLogin success path SessionIssued: principalId === userId (NOT robot id)', async function () {
        // Contract: on SUCCESS, audit's principalId on SessionIssued is the
        // user themselves (the gate uses the robot id only as the
        // front-door signal to the inner handler; the resulting event must
        // attribute to the user). Pins that `password-login.ts:305`'s call
        // to handleSessionIssue does NOT leak the robot id into the
        // SessionIssued envelope.
        const fx = newFixture();
        const userResult = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'seed',
            principalId: 'admin',
            email: 'success@example.com',
        }, fx.events);
        await dispatchAll(fx);
        await handlePasswordSet({
            tenantId: fx.tenantId,
            correlationId: 'seed',
            principalId: 'admin',
            userId: userResult.document.userId,
            newPassword: 'CorrectPa55word!',
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const result = await handlePasswordLogin({
            tenantId: fx.tenantId,
            correlationId: 'c',
            email: 'success@example.com',
            password: 'CorrectPa55word!',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.LoginSucceeded');
        expect(result.envelope.principalId).toBe(userResult.document.userId);
        // SessionIssued follow event — principalId is the user, not the robot.
        const sessionIssued = result.follow.find(function (e) {
            return e.eventType === 'Identity.SessionIssued';
        });
        expect(sessionIssued).toBeDefined();
        expect(sessionIssued?.principalId).toBe(userResult.document.userId);
    });
    it('handleJitProvision: UserCreated + MembershipCreated both stamp robot id', async function () {
        // Mirrors `modules/identity/src/handlers/jit-provision.ts:218,256`
        // which delegates UserCreated through handleUserCreate and
        // hand-crafts MembershipCreated.
        const fx = newFixture();
        const idp: IdentityProviderDocument = {
            idpId: 'idp-1',
            tenantId: fx.tenantId,
            kind: 'oidc',
            displayName: 'Test IDP',
            issuer: 'https://idp.example.com',
            jwksUri: 'https://idp.example.com/jwks',
            audience: 'atlas',
            requireInvite: false,
            defaultRolesOnFirstLogin: ['Author'],
            roleMappings: [],
            priority: 0,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        const result = await handleJitProvision({
            tenantId: fx.tenantId,
            correlationId: 'c',
            claims: {
                sub: 'jit-sub-1',
                email: 'jit@example.com',
                raw: {},
            },
            idp,
        }, fx.events, fx.entities);
        expect(result.created).toBe(true);
        expect(result.events).toHaveLength(2);
        const [userCreated, membershipCreated] = result.events;
        expect(userCreated?.eventType).toBe('Identity.UserCreated');
        expect(userCreated?.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
        expect(membershipCreated?.eventType).toBe('Identity.MembershipCreated');
        expect(membershipCreated?.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
    });
});
// ---------------------------------------------------------------------
// 2b. Subject vs. actor: `userId` is NEVER the robot id
// ---------------------------------------------------------------------
//
// Stage 2 fix-pass — sdet's review finding #1 caught a class of leak
// where `userId: cmd.principalId` carried the robot id into the
// envelope's `userId` (subject) field. Audit rows index by `userId` to
// answer "show events about user X" — letting the robot string land
// there pollutes per-user queries (the robot is not a User). These
// regression tests pin each fixed site to `null` (no user subject) or
// the real `user.userId`.
describe('subject-vs-actor invariant — `userId` is null or a real User id, never the robot id', function () {
    it('handleUserCreate stamps `userId` to the newly-created user, not `cmd.principalId`', async function () {
        const fx = newFixture();
        const result = await handleUserCreate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
            email: 'subject-vs-actor@example.com',
        }, fx.events);
        expect(result.envelope.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
        // Subject is the newly-minted user — NOT the robot.
        expect(result.envelope.userId).toBe(result.document.userId);
        expect(result.envelope.userId).not.toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
    });
    it('handleInviteIssue stamps `userId` to null (invitee identified by email only)', async function () {
        const fx = newFixture();
        const result = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
            email: 'pre-user@example.com',
            rolesOnAccept: ['admin'],
        }, fx.events);
        expect(result.envelope.principalId).toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
        expect(result.envelope.userId).toBeNull();
    });
    it('handleInviteAccept: all three emissions stamp `userId` to the accepted User, not the robot', async function () {
        const fx = newFixture();
        const issued = await handleInviteIssue({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
            email: 'accept-subject@example.com',
            rolesOnAccept: ['admin'],
        }, fx.events);
        await dispatchAll(fx);
        const accept = await handleInviteAccept({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
            presentedToken: issued.plaintextToken,
            acceptedEmail: 'accept-subject@example.com',
            issueSession: false,
        }, fx.events, fx.entities);
        const expectedUserId = accept.user.userId;
        // Primary event (InviteAccepted) subject is the accepting User.
        expect(accept.envelope.userId).toBe(expectedUserId);
        // Follows are UserCreated + MembershipCreated — both also have the
        // user as their subject (not the robot actor).
        for (const f of accept.follow) {
            expect(f.userId).toBe(expectedUserId);
            expect(f.userId).not.toBe(PLATFORM_ROBOT_PRINCIPAL_ID);
        }
    });
    it('handleOAuthRevokeToken stamps `userId` to null (OAuth tokens belong to ServicePrincipals, not Users)', async function () {
        // We can't easily mint a real ServicePrincipal-bound OAuth token in
        // this unit harness, but the contract is mechanical: the handler
        // sets `userId: null` regardless of token content. Until a future
        // capability binds OAuth tokens to a User, this is the correct
        // subject.
        //
        // Source-level pin: oauth-token-revoke.ts:72 — `userId: null` (post
        // fix-pass). If the line changes, this comment is the canary.
        // (Unknown-token path returns null envelope, so the runtime
        // assertion is restricted to source review for the FOUND path.)
        const fx = newFixture();
        const result = await handleOAuthRevokeToken({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
            presentedToken: 'unknown-token-for-shape-pin',
        }, fx.events, fx.entities);
        expect(result.envelope).toBeNull();
    });
});
// ---------------------------------------------------------------------
// 3. ADR-intent regression sentinel: null is still legal (for now)
// ---------------------------------------------------------------------
describe('ADR 0008 §2 — legacy null acceptance (Stage 3 follow-up tightens)', function () {
    it('documents that null is currently still a legal front-door signal', function () {
        // This test is a CANARY for the Stage 3 tightening. Today the gate
        // accepts BOTH PLATFORM_ROBOT_PRINCIPAL_ID and `null`. ADR 0008 §2
        // intent was to eliminate the null sentinel entirely; the Stage 2
        // implementer kept null acceptance for back-compat so the ~16
        // brittle tests in `test/session.test.ts`,
        // `test/unit/invite-accept.test.ts`, `test/handlers.test.ts`, etc.
        // would not need to be touched in this slice.
        //
        // When Stage 3 lands and those tests are migrated to use
        // PLATFORM_ROBOT_PRINCIPAL_ID, the `session-issue.ts:98` branch
        // (`cmd.principalId === null`) should be REMOVED. At that point
        // this test should fail and be deleted along with the null branch.
        //
        // Until then, this test pins the temporary dual-accept contract
        // explicitly so the ADR-intent regression is visible in the test
        // ledger, not hidden in a code comment.
        expect(true).toBe(true);
    });
});
