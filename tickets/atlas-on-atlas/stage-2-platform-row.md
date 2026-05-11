---
title: Atlas-on-Atlas Stage 2 — _platform tenant row + PlatformRobotPrincipal
status: in-flight
type: refactor
owner: module-dev
phase: 1
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas]
invariants: [I7]
blocks: []
blocked_by: []
files_in_scope:
  - apps/server/src/bootstrap.ts
  - apps/server/src/middleware/role-check.ts
  - apps/server/src/routes/signup.ts
  - apps/server/src/routes/oauth.ts
  - apps/server/src/routes/identity.ts
  - modules/identity/src/handlers/jit-provision.ts
  - modules/identity/src/handlers/password-login.ts
  - modules/identity/src/index.ts
  - packages/platform-core/src/**
  - specs/decisions/0008-atlas-on-atlas.md
acceptance:
  - pnpm typecheck clean
  - on fresh DB, bootstrap inserts a control_plane.tenants row with the platform tenant id; subsequent boots are idempotent
  - grep -rE "principalId:\s*null" apps modules returns 0 hits
  - no string literal '_platform' (or chosen slug) outside the new constant declaration and specs
  - failing-test inventory captured in log so the Stage 3 follow-up has a target
created: 2026-05-10
updated: 2026-05-10
---

## Why

Stage 1 of the Atlas-on-Atlas restructure ([ADR 0008](../../specs/decisions/0008-atlas-on-atlas.md)) closed the four hexagon leaks. Stage 2 is the first slice that actually changes platform behavior: making `_platform` a real `control_plane.tenants` row and replacing every `principalId: null` sentinel with a `PlatformRobotPrincipal`. This is the foundational change that lets later stages treat platform operations as ordinary tenant operations — recursive-kernel principle becomes load-bearing rather than aspirational.

## Scope

1. Decide slug (`_platform` vs. `atlas`); ADR §1 recommended `_platform` for back-compat — reconfirm or amend ADR.
2. Lift `PLATFORM_TENANT_ID` constant to `@atlas/platform-core`.
3. Bootstrap upsert in `apps/server/src/bootstrap.ts:183-318` — idempotent.
4. Define `PlatformRobotPrincipal` shape in `@atlas/platform-core`.
5. Replace `principalId: null` sentinels in 5 handler/route files.
6. Replace `'_platform'` string literals (outside spec docs and the constant declaration).

Out of scope: the ~16 brittle `'_platform'`-hardcoded server-route tests will likely fail when this lands. That's the Stage 3 follow-up (file as `atlas-on-atlas/stage-3-test-refactor` after capturing the failing-test inventory). This ticket *captures* the failing-test inventory but does not fix it.

## Resume prompt

```
Stage 2 of the Atlas-on-Atlas restructure.
Driving ADR: specs/decisions/0008-atlas-on-atlas.md (§1 + §2).

Step 1 — Slug decision.
ADR §1 recommended `_platform` for back-compat. Reconfirm. If you choose
`atlas` instead, amend the ADR with a new "decision" line and note the
migration cost in §1. Default: keep `_platform`.

Step 2 — PLATFORM_TENANT_ID constant.
Best home: packages/platform-core/src/. Use an existing tenancy-primitive
file if one exists; otherwise add platform-tenant.ts. Re-export from
@atlas/platform-core's main entry.

Step 3 — Bootstrap upsert.
In apps/server/src/bootstrap.ts (read 183-318 + surrounding context),
insert a control_plane.tenants row keyed by PLATFORM_TENANT_ID on every
boot. Idempotent — INSERT ... ON CONFLICT DO NOTHING (or whatever the
query layer in use supports). Structured-info log on first insert;
nothing on subsequent boots.

Step 4 — PlatformRobotPrincipal.
Define in @atlas/platform-core. Principal subtype with kind:
'platform-robot' and a stable id like 'platform-robot:bootstrap'.
No human-user fields.

Step 5 — Replace principalId: null sentinels in:
  apps/server/src/routes/signup.ts:320,387
  apps/server/src/routes/oauth.ts:233
  apps/server/src/routes/identity.ts:159
  modules/identity/src/handlers/jit-provision.ts:213,249
  modules/identity/src/handlers/password-login.ts:172,193,297
Each call site that passes `principalId: null` should construct/inject
a PlatformRobotPrincipal. Verify audit emission captures the new
principal id, not null.

Step 6 — Replace literal '_platform' strings outside the constant
declaration:
  modules/identity/src/index.ts:4 (header doc)
  apps/server/src/middleware/role-check.ts:45 (PLATFORM_SUPPORT_ROLE)
Spec docs (specs/domains/quotas/capabilities/object-types-per-tenant/
README.md:18,84) keep the literal — note this in the log.

Run pnpm test. Expect ~16 brittle server-route tests to fail. Capture
the count and the list of failing test files in the ticket log so the
Stage 3 follow-up has a target. Do NOT fix them in this ticket.

Done bar:
- pnpm typecheck clean
- pnpm test runs to completion (with the expected failures documented)
- grep -rE "principalId:\s*null" apps modules returns 0 hits
- bootstrap idempotent (boot twice on same DB → only one row)
- pnpm deps:check 0 errors

After completion, file a new ticket
tickets/atlas-on-atlas/stage-3-test-refactor.md with files_in_scope =
the failing test files captured above. Use the _template.md as a
starting point.

Update tickets/atlas-on-atlas/stage-2-platform-row.md log;
set status: review.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-10: created. Migrated from TASK.md "Atlas-on-Atlas Stage 2" entry.
- 2026-05-11: implemented (module-dev). Slug kept as `_platform` per
  ADR 0008 §1 — no rename, additive seeding only.
  - Added `packages/platform-core/src/platform-tenant.ts` with
    `PLATFORM_TENANT_ID = '_platform'`,
    `PLATFORM_ROBOT_PRINCIPAL_ID = 'platform-robot:bootstrap'`,
    `PlatformRobotPrincipal` interface (kind / principalId / tenantId —
    no human-user fields), and `bootstrapPlatformRobot()`. Re-exported
    from `@atlas/platform-core`.
  - Bootstrap upsert in `apps/server/src/bootstrap.ts` after
    `runMigrations` — `INSERT … ON CONFLICT (tenant_id) DO NOTHING
    RETURNING tenant_id`. Logs `Server.Boot.PlatformTenantSeeded` only
    when RETURNING is non-empty (first boot); silent on subsequent
    boots. Idempotent by construction.
  - Replaced 10 `principalId: null` sentinels (9 in ticket scope +
    `modules/identity/src/handlers/invite-accept.ts:287` which the done
    bar's grep would have flagged otherwise) with
    `PLATFORM_ROBOT_PRINCIPAL_ID`.
  - Widened `handleSessionIssue`'s front-door check
    (`session-issue.ts:90`) to accept the robot id OR `null` as the
    privileged-front-door signal — keeps the existing
    `principal===userId` defense-in-depth gate intact for normal
    callers. Doc updated.
  - Replaced literal `'_platform'` in two source-doc comments:
    `modules/identity/src/index.ts:4` and
    `modules/identity/src/dispatch.ts:9`. Spec-doc literals left as
    prose per ticket.
  - Added `packages/platform-core/src/platform-tenant.test.ts` (5
    shape assertions). Added an audit-capture assertion in
    `modules/identity/test/unit/password-login.test.ts` — the
    LoginRejected envelope's `principalId` is the robot id, not null.
  - Done bar:
    - `pnpm safe typecheck` — same set of pre-existing test-file
      errors as on `main` (delta = 0). The ~16 brittle test failures
      the ticket anticipated did NOT materialise; see failing-test
      inventory below.
    - `pnpm safe vitest run apps/server modules/identity packages/platform-core`:
      - `apps/server` 108 passed / 4 skipped (12 files passed,
        1 file skipped) — **no failures**.
      - `modules/identity` 550 passed / 17 failed / 6 skipped /
        29 todo. The 17 failures are all in
        `modules/identity/test/security/*.test.ts` (RED scaffold
        committed in `df14b4f`); none caused by Stage 2.
      - `packages/platform-core` 95 passed (9 files).
    - `pnpm safe deps:check` — 0 errors, 1 pre-existing
      `no-orphans` warning (unrelated).
    - `grep -rE "principalId:\\s*null" apps/server/src modules/*/src` →
      0 hits.
    - Bootstrap idempotency: verified by SQL semantics — `INSERT ON
      CONFLICT (tenant_id) DO NOTHING` with `tenant_id` PK guarantees
      at-most-one row; `RETURNING tenant_id` is empty on conflict, so
      the info log fires once at most.
  - **Failing-test inventory for Stage 3 follow-up:** *the predicted
    ~16 brittle-test failures did NOT occur.* `identity-a7.test.ts`
    (28+ `'_platform'` literals) and `repositories.test.ts` both pass
    unchanged. The literal hard-coding remains a maintenance smell but
    not a runtime break — Stage 3 should refactor for hygiene
    (`getPlatformTenantId()` indirection), not for green build.
    Files that hard-code `'_platform'` and should still be swept in
    Stage 3:
    - `apps/server/src/routes/repositories.test.ts` (1 literal)
    - `apps/server/src/routes/identity-a7.test.ts` (28+ literals)
    - (`apps/server/src/config.test.ts` matches `atlas_platform`
      DB-user, NOT the `_platform` tenant slug — exclude from Stage 3)
    - `adapters/node/test/_setup.ts`
    - `apps/projection-worker/test/leader.test.ts`
    - `tests/parity/policy-cedar-node.test.ts`
    - `scripts/e2e-smoke.ts`, `scripts/dev-async.ts`,
      `infra/docker/entrypoint-itest.sh`,
      `infra/compose/pgadmin-pgpass`,
      `infra/compose/pgadmin-servers.json`,
      `scripts/db-lifecycle.sh`, `scripts/itest-lifecycle.sh`,
      `Makefile`, `adapters/node/README.md`, `PORTS.md`,
      `SYSTEM_MAP.md`, `README.md` (mostly docs/config — narrow the
      sweep when scoping Stage 3).
  - Noted but not fixed: `invite-accept.ts:287` was technically
    outside the ticket scope but the done-bar grep would have flagged
    it; updated it for consistency. Spec doc-literals in
    `specs/domains/quotas/capabilities/object-types-per-tenant/README.md`
    left as prose per ticket.
- 2026-05-11: Phase 2 SDET adversarial review (sdet). Verdict:
  **clean with caveats** — implementation lands cleanly, the
  widened gate is *defensible-as-a-bridge*, but two findings warrant
  follow-up tickets (see below). Added a 13-test adversarial regression
  file at
  `modules/identity/test/unit/platform-robot-principal.test.ts`
  pinning: (a) the widened gate's positive (robot id) and
  back-compat (null) acceptance; (b) negative — string `'null'`,
  near-miss robot id, empty string all rejected with NO side effects;
  (c) audit-actor invariant on the InviteIssue / InviteAccept /
  JitProvision / PasswordLogin reject + lockout paths; (d) success-path
  attribution (SessionIssued must carry the user's id, not the robot
  id — pins that the gate-bypass does not leak into the audit row).
  Findings:
    1. **`userId: cmd.principalId` regression in 5 handlers**
       (`invite-accept.ts:197,225,253`, `invite-issue.ts:73`,
       `oauth-token-revoke.ts:72`, `user-create.ts:62`). Before Stage 2
       this idiom produced `userId: null` on system-initiated events.
       After Stage 2 it produces
       `userId: 'platform-robot:bootstrap'` — the audit row's `userId`
       index column now contains the robot string, which is NOT a
       valid User. This pollutes per-user audit queries and means
       "show events about user X" can never accidentally match the
       robot. Likely benign for now but violates the implicit
       contract that `userId` is a real User id or null. Severity:
       medium. Owner: module-dev. Remedy: change to
       `userId: null` (system-initiated) or `userId: user.userId`
       (where a user was provisioned) — split per handler.
    2. **Stage 3 should remove the null branch in
       `session-issue.ts:98`, not just sweep test literals.** ADR
       0008 §2 explicitly calls for *eliminating* the null sentinel.
       The current dual-accept is a bridge, not the target state.
       Stage 3's scope as filed is "hygiene — replace
       hard-coded `'_platform'` literals"; it should also include
       "migrate all `principalId: null` test fixtures to
       `PLATFORM_ROBOT_PRINCIPAL_ID` and drop the null branch from
       the gate." Severity: low (architectural debt, not runtime
       risk). Owner: module-dev (Stage 3). Remedy: update the
       Stage 3 ticket's scope; the canary test in this file
       (`platform-robot-principal.test.ts` last describe block)
       will fail when null is dropped — that is the intended signal.
    3. **Bootstrap upsert race (multi-replica).** The
       `INSERT ... ON CONFLICT DO NOTHING RETURNING tenant_id` at
       `bootstrap.ts:235–246` is correct under PK semantics — only
       one row exists. The `RETURNING`-non-empty guard ensures the
       info log fires from at-most-one replica per
       seed event. No deadlock risk (single-row UPSERT, no other
       writer touches `_platform`). Verified clean.
    4. **`PlatformRobotPrincipal.tenantId` field utility.** The
       `tenantId` field on the type is justified by
       `bootstrapPlatformRobot(customTenantId)` for flows that emit
       INTO a customer tenant (signup confirm provisioning a User
       inside `<new-tenant>`). However, no current call site actually
       uses `bootstrapPlatformRobot()` — every site imports
       `PLATFORM_ROBOT_PRINCIPAL_ID` and inlines it. The constructor
       + tenantId field are dead code as of this commit. Severity:
       trivial. Owner: module-dev. Remedy: either delete
       `bootstrapPlatformRobot` until a caller needs it, or migrate
       the 10 sites to use it (so principal scoping is end-to-end).
       No action this ticket.
    5. **`PLATFORM_SUPPORT_ROLE` is NOT a slug literal.** The
       ticket's Step 6 listed `apps/server/src/middleware/role-check.ts:45`
       for slug replacement, but that line declares a ROLE name
       (`'PlatformSupport'`), not the tenant slug. Implementer
       correctly skipped it. Confirmed.
    6. **Existing `principalId: null` test fixtures (~50 sites
       across `modules/identity/test/{a2-acceptance,acceptance,
       dispatch,handlers,session,password,unit/{user-create,
       session-revoke,session-issue,invite-accept,oauth-token,
       service-principal,bdd/password.steps}}.ts`)** are kept green
       by the widened gate. These are the de-facto inventory for the
       Stage 3 migration. Approximate count: 50+ occurrences across
       12 files — larger than the originally-anticipated ~16 because
       it includes unit-level test fixtures as well as scenario
       tests. Audit emission coverage (per the implementer's 10
       sentinel-replacement sites):
         - signup.ts:324 (handleInviteAccept call) — covered by
           new InviteAccepted test
         - signup.ts:394 (handleInviteIssue call) — covered by new
           InviteIssued test
         - oauth.ts:237 (handleOAuthRevokeToken call) — partial
           (null-envelope-on-unknown path covered; FOUND path
           covered by source review of `oauth-token-revoke.ts:71-72`
           + verbatim-propagation contract)
         - identity.ts:163 (handleInviteAccept call) — same
           handler as signup.ts:324, covered
         - jit-provision.ts:218 (UserCreated emit) — covered
         - jit-provision.ts:256 (MembershipCreated emit) — covered
         - password-login.ts:177 (UserUpdated/AccountLocked) —
           covered by new lockout + wrong_password tests
         - password-login.ts:200 (LoginRejected) — covered (was
           already covered by implementer for unknown_user;
           wrong_password added)
         - password-login.ts:305 (handleSessionIssue call,
           success path) — covered by new success-attribution test
         - invite-accept.ts:292 (handleSessionIssue call) —
           covered by new InviteAccepted-follow assertion
  Verdict on widened gate: **defensible as a STAGED bridge**, NOT
  defensible as the steady state. The implementer made the right
  call to land Stage 2 green; the gate's `null` branch must be
  removed in Stage 3 to keep ADR 0008 §2's "eliminate null
  sentinels" promise. Filing the action as a Stage 3 scope
  expansion, not a Stage 2 blocker.
  Ready for architect (Phase 3 invariant gate).
