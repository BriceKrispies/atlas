---
title: BDD scenario — atlas-admin approves a public signup against the real server stack
status: blocked
type: test
owner: module-dev
phase: 0
capability: specs/domains/tenancy/capabilities/public-signup/README.md
vision: []
invariants: [I1, I2, I5, I10, I12]
blocks: []
blocked_by:
  - tenancy/admin-approve-provisions-tenant-db
files_in_scope:
  - specs/domains/tenancy/capabilities/public-signup/README.md
  - packages/platform-core/src/platform-tenant.ts
  - apps/server/src/bootstrap-platform-admin.ts
  - apps/server/src/bootstrap.ts
  - apps/server/test/bootstrap-platform-admin.test.ts
  - playwright.bdd.server.config.ts
  - package.json
  - tests/bdd/features/tenancy/public-signup/admin-approves-signup.feature
  - tests/bdd/steps/tenancy/public-signup/admin-approves-signup.steps.ts
  - tests/bdd/support/server-stack.ts
  - tests/bdd/README.md
  - tests/integration/public-signup.itest.ts
  - adapters/node/src/mailer-stdout.ts
acceptance:
  - pnpm typecheck green
  - pnpm lint green
  - pnpm bdd:server passes the admin-approves-signup scenario end-to-end against real apps/server + Postgres + smtp4dev
  - boot of apps/server emits exactly one Tenancy.PlatformAdmin.Seeded log line on first boot, zero on subsequent boots
  - X-Debug-Principal user:platform-admin:_platform:admin resolves to a Principal with roles=['admin'] via the seeded Membership entity
  - Both StdoutEventMailer and SmtpMailer emit event: 'Mailer.Send.Success' (canonical Domain.Verb.Outcome name)
  - control_plane.email_log row holds full body incl. magic-link URL
  - smtp4dev REST /api/Messages returns the dispatched email
  - per-tenant entities table exists in the newly-provisioned tenant DB
created: 2026-05-17
updated: 2026-05-23
---

## Why

The user wants the full public-signup loop (anonymous submit → admin approve → tenant provision + magic link) to be CLI-driven and verifiable through structured logs + smtp4dev + Postgres. Today there is a `tests/integration/public-signup.itest.ts` that covers most of the flow but (a) the admin actor is a synthesized `X-Debug-Principal: user:admin:<slug>:admin` rather than a real seeded admin entity, and (b) there is no BDD `.feature` for this journey even though BDD is the canonical home for executable specs. This ticket adds the seeded platform admin, the BDD harness that drives `apps/server` (not just the IDB sim), and the scenario that codifies every assertion the user wants to make from the command line.

The work also exercises the agent dispatch chain (`spec-keeper` → `spine-owner` → `module-dev` → `sdet` → `architect` → `observability-architect`) end-to-end, which is the second half of the user's intent: testing the agents alongside the instrumentation.

## Scope

In scope:

- Slice 1: edit `specs/domains/tenancy/capabilities/public-signup/README.md` to add the seeded `platform-admin` actor, the `Tenancy.PlatformAdmin.Seeded` boot event, and a lexicon entry.
- Slice 2: add `PLATFORM_ADMIN_PRINCIPAL_ID` / `PLATFORM_ADMIN_EMAIL` constants, write `seedPlatformAdmin(state)` that idempotently inserts the User + Membership entities in `_platform`, wire it into `bootstrap.ts` after the `_platform` tenant row is created, add an idempotency test.
- Slice 3: add `playwright.bdd.server.config.ts` that boots Postgres + smtp4dev + `apps/server` as webServers with the canonical dev env; add `pnpm bdd:server` script.
- Slice 4: write the BDD feature + steps + `tests/bdd/support/server-stack.ts` helpers (extracted from the itest where reusable).
- Slice 5: update `tests/bdd/README.md` with the `@server` track; refactor the itest to use the seeded admin; rename `StdoutEventMailer`'s `event: 'mailer.sent'` → `event: 'Mailer.Send.Success'` to match `Domain.Verb.Outcome`.

Out of scope:

- Adding `atlasctl signups list/approve/deny` commands (user explicitly deferred).
- A dev-mode flag that lets the email body land in operational logs (user explicitly declined; magic-link tokens stay credentials per logging contract).
- Any change to the production mailer adapter beyond the event-name rename.
- BDD coverage of the magic-link redirect / session-cookie crossing (still covered by the existing itest; the BDD scenario asserts up to and including email dispatch).

## Resume prompt

```
Implement the slices in tickets/tenancy/admin-approves-signup-bdd.md per the approved plan at .claude/plans/im-wanting-to-test-sunny-locket.md. Acceptance bar is in the frontmatter. Dispatch the agents named per slice (spec-keeper, spine-owner, module-dev, sdet, architect, frontend-dev, observability-architect). At the end, pnpm bdd:server must pass the admin-approves-signup scenario against real apps/server + Postgres + smtp4dev. Update this ticket's status + log on every state transition.
```

## Notes / log

- 2026-05-17: created (status=scoped). User approved plan at .claude/plans/im-wanting-to-test-sunny-locket.md.
- 2026-05-18: all five slices implemented (status=review). Slice 1 (spec-keeper) edited the public-signup capability spec to document the seeded platform-admin actor + the Tenancy.PlatformAdmin.Seeded boot event + a lexicon entry. Slice 2 (module-dev) added PLATFORM_ADMIN_* constants in @atlas/platform-core, wrote `seedPlatformAdmin(entities)` in apps/server, wired it into bootstrap.ts (idempotent; logs `Tenancy.PlatformAdmin.Seeded` on first run only); principal middleware needed no change (the 4-segment X-Debug-Principal form hydrates roles directly). Slice 3 added playwright.bdd.server.config.ts (3 webServer entries: make db-up + pnpm smtp:up + apps/server with canonical dev env + Windows host-resolver flag) and pnpm bdd:server / pnpm bdd:server:report scripts. Slice 4 (module-dev) wrote the @server-tagged feature, step bindings, and tests/bdd/support/server-stack.ts helpers; uses the in-memory ring buffer via /api/v1/admin/logging/correlation/:correlationId/recent for log-tailing (Option B); extended world.ts + hooks.ts to support an After('@server', …) cleanup hook; added eslint.config.ts ignore for playwright.bdd.server.config.ts. Slice 5 renamed StdoutEventMailer's `event: 'mailer.sent'` → `event: 'Mailer.Send.Success'` (now matches SmtpMailer; canonical Domain.Verb.Outcome name per logging contract), updated the test, updated tests/bdd/README.md with the @sim vs @server track section + new commands table entries, switched tests/integration/public-signup.itest.ts admin headers to `user:platform-admin:_platform:admin` and added a header note about the BDD sibling. Verification: pnpm typecheck green, pnpm lint green, every touched vitest test green (5/5), `pnpm exec bddgen --config playwright.bdd.server.config.ts` exit 0 with all 14 step bindings resolved. `pnpm bdd:server` end-to-end NOT run from this turn — requires Postgres + smtp4dev containers + apps/server to be brought up; operator should run `make db-up && pnpm smtp:up && pnpm bdd:server` to validate the live stack. Architect invariant-gate pass (I1/I2/I5/I10/I12) still pending before move to done.
- 2026-05-23: ticket-sweep — moved `review` → `blocked`. The 2026-05-22 BDD run (see `tenancy/admin-approve-provisions-tenant-db`) showed this scenario fails end-to-end with `approveSignup: 503 TENANT_DATABASE_NOT_PROVISIONED` because admin-approve never provisions the per-tenant DB. The "5/5 slices landed / pending architect" framing overstated readiness: acceptance items "pnpm bdd:server passes end-to-end" and "per-tenant entities table exists in the newly-provisioned tenant DB" are known-red until that gap closes. Added `blocked_by: tenancy/admin-approve-provisions-tenant-db`.
