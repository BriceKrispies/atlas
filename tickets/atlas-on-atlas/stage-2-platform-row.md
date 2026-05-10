---
title: Atlas-on-Atlas Stage 2 — _platform tenant row + PlatformRobotPrincipal
status: scoped
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
