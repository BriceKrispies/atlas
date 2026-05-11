---
title: Atlas-on-Atlas Stage 3 — drop dual-accept null branch + migrate test fixtures + verify worker
status: scoped
type: refactor
owner: module-dev
phase: 1
capability:
adr: specs/decisions/0008-atlas-on-atlas.md
vision: [atlas-on-atlas]
invariants: [I2]
blocks: []
blocked_by: []
files_in_scope:
  - modules/identity/src/handlers/session-issue.ts
  - modules/identity/test/**
  - apps/server/test/**
  - tests/parity/**
  - adapters/node/test/**
  - apps/projection-worker/test/**
  - apps/projection-worker/src/tenant-loop.ts
acceptance:
  - session-issue.ts gate accepts ONLY PLATFORM_ROBOT_PRINCIPAL_ID; null branch removed
  - canary test in platform-robot-principal.test.ts:525-545 now asserts null IS rejected (flip the assertion)
  - all `principalId: null` test fixtures migrated to PLATFORM_ROBOT_PRINCIPAL_ID (~50 sites)
  - hardcoded `'_platform'` literals in test files replaced with PLATFORM_TENANT_ID import (5 test files identified in Stage 2 log)
  - projection-worker boots cleanly with the seeded `_platform` tenant — no dispatcher errors on its event stream
  - pnpm safe typecheck clean
  - pnpm safe vitest — all tests pass (or RED-scaffold-only failures remain)
  - pnpm safe deps:check 0 errors
created: 2026-05-11
updated: 2026-05-11
---

## Why

Stage 2 (commit `c6824b8` → `31a826a` → `3ceee3c`) made `_platform` a real `control_plane.tenants` row and replaced `principalId: null` sentinels with `PlatformRobotPrincipal` — but **the implementer widened `session-issue.ts:97-99` to accept both robot id and legacy `null`** to preserve compat with ~50 test fixtures hardcoding the null sentinel. ADR 0008 §2 commits to *eliminating* the null sentinel. Architect Phase 3 review of Stage 2 (commit `3ceee3c` log) explicitly required this Stage 3:

> "The dual-accept gate is a regression vector — it preserves the 'platform-is-special' thinking ADR 0008 set out to eliminate. The sdet-authored canary test is the right mitigation: it ensures the bridge expires loudly when Stage 3 lands."

The canary test at `modules/identity/test/unit/platform-robot-principal.test.ts:525-545` currently asserts null IS accepted. After Stage 3, it must assert null IS REJECTED.

Plus: architect flagged that the projection-worker at `apps/projection-worker/src/tenant-loop.ts:182-184` will pick up `_platform` on first prod boot (it reads `control_plane.tenants WHERE status = 'active'`). Verify the dispatcher has platform-tenant entity-store wiring before that boot.

## Scope

1. **Drop the null branch** in `modules/identity/src/handlers/session-issue.ts:97-99` — accept only `PLATFORM_ROBOT_PRINCIPAL_ID`. Reject `null`, `'null'`, `''`, and any other value.
2. **Flip the canary test** at `modules/identity/test/unit/platform-robot-principal.test.ts:525-545` — assertion changes from "null is accepted" to "null is rejected with the documented error".
3. **Migrate test fixtures** — grep `principalId:\s*null` across `modules/identity/test/`, `apps/server/test/`, `tests/parity/`, `adapters/node/test/`. Replace with `PLATFORM_ROBOT_PRINCIPAL_ID` import. Expected count from Stage 2's log: ~50 sites.
4. **Replace hardcoded `'_platform'` literals** in test files with `PLATFORM_TENANT_ID` import. Stage 2 log identified: `apps/server/src/routes/identity-a7.test.ts`, `apps/server/src/routes/repositories.test.ts`, `adapters/node/test/_setup.ts`, `apps/projection-worker/test/leader.test.ts`, `tests/parity/policy-cedar-node.test.ts`.
5. **Verify projection-worker** boots cleanly with `_platform` tenant. Run the worker against a fresh DB; confirm no dispatcher errors when it opens the `_platform` event stream. If dispatcher wiring is missing, file a separate worker-fix ticket — don't fix it in Stage 3.

Out of scope: removing `bootstrapPlatformRobot()` dead code (trivia; do whenever); the 23-handler hygiene sweep (`chore/handler-userid-propagation-sweep`).

## Resume prompt

```
Stage 3 of the Atlas-on-Atlas restructure.
Driving ADR: specs/decisions/0008-atlas-on-atlas.md (§2 elimination commitment).
Architect Phase 3 of Stage 2 mandated this ticket — see
tickets/archive/atlas-on-atlas/stage-2-platform-row.md log for context.

Step 1 — Drop the null branch.
  In modules/identity/src/handlers/session-issue.ts:97-99, remove the
  `|| cmd.principalId === null` (or equivalent) check. The gate accepts
  ONLY PLATFORM_ROBOT_PRINCIPAL_ID for the privileged-front-door signal.
  Other values raise the existing 'unauthorized' error path.
  Update the inline doc comment to reflect the post-Stage 3 state.

Step 2 — Flip the canary test.
  modules/identity/test/unit/platform-robot-principal.test.ts:525-545
  currently pins "null is accepted as bridge". Flip it to:
  - assert null is rejected (the bridge is gone)
  - keep the rejection-shape pins for 'null' string, near-miss ids,
    empty string

Step 3 — Migrate test fixtures.
  grep -rE "principalId:\s*null" modules/identity/test/ apps/server/test/
  tests/parity/ adapters/node/test/
  Expect ~50 hits per Stage 2's failing-test inventory.
  For each: replace `principalId: null` with
  `principalId: PLATFORM_ROBOT_PRINCIPAL_ID`, importing the constant
  from @atlas/platform-core. Don't import inside loops — import at the
  top of the test file.

Step 4 — Replace hardcoded '_platform' literals in tests.
  Stage 2's log identified these files:
    apps/server/src/routes/identity-a7.test.ts
    apps/server/src/routes/repositories.test.ts
    adapters/node/test/_setup.ts
    apps/projection-worker/test/leader.test.ts
    tests/parity/policy-cedar-node.test.ts
  Replace each '_platform' literal with PLATFORM_TENANT_ID import.

Step 5 — Worker wiring verification.
  Boot apps/projection-worker against a fresh DB (where bootstrap has
  seeded the _platform tenant). Watch for dispatcher errors when the
  worker opens the _platform tenant's event stream.
  If clean: log "worker handles _platform cleanly" in the ticket log.
  If broken: STOP, file a separate ticket
  `atlas-on-atlas/stage-4-worker-platform-tenant-wiring`, mark this
  ticket blocked on it. Don't fix worker wiring in Stage 3.

Done bar:
- pnpm safe typecheck clean
- pnpm safe vitest run — all tests pass except the 17 pre-existing
  modules/identity/test/security/* RED scaffold (and possibly any
  new fixtures you flipped that need attention)
- pnpm safe deps:check 0 errors
- grep -rE "principalId:\s*null" modules/identity/test/ apps/server/test/
  tests/parity/ adapters/node/test/ returns 0 hits
- grep -rE "'_platform'" apps modules tests --include="*.ts" returns 0
  hits OUTSIDE packages/platform-core/src/platform-tenant.ts (the
  canonical declaration) and any spec doc files (specs/* literals stay)

Update tickets/atlas-on-atlas/stage-3-test-refactor.md log on completion.
Set status: review and hand to sdet.
Update tickets/INDEX.md.
```

## Notes / log

- 2026-05-11: created from architect Phase 3 review of Stage 2 (commit `3ceee3c` log). HIGH PRIORITY — the sdet canary test in `platform-robot-principal.test.ts:525-545` is the load-bearing mitigation that lets Stage 2 ship with the dual-accept bridge; until Stage 3 lands, ADR 0008 §2's elimination commitment is on probation.
