---
title: Drop orphan atlas_t_*_itest_* databases at integration-test suite start
status: done
type: chore
owner: port-adapter-dev
phase: 2
adr: specs/decisions/0005-custom-schema-storage-strategy.md
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - tests/integration/upload-tarball.itest.ts
  - tests/integration/lib/tenant-db-janitor.ts
acceptance:
  - "before each integration-test suite that provisions a tenant DB, an idempotent pre-clean drops any `atlas_t_*_itest_*` database and matching role from prior interrupted runs"
  - "the janitor is opt-in / shared via a helper, not duplicated per-test-file"
  - "an interrupted itest run (Ctrl-C / docker stop) followed by a fresh run completes cleanly without manual operator intervention"
  - "pnpm test:integration passes; pnpm typecheck passes"
created: 2026-05-20
updated: 2026-05-20
---

## Why

sdet finding **F7** from the db-per-tenant slice. `tests/integration/upload-tarball.itest.ts` uses a per-run `RUN_ID` to construct unique tenant DB names (good — avoids cross-run collisions) and drops them in `afterAll` (good — cleans up the happy path). But if `afterAll` doesn't run (Ctrl-C, host crash, OOM kill), the orphan DB + role accumulate on the Postgres instance. Over many interrupted runs the cluster collects stale DBs that no test owns and no test cleans.

Realistic exposure is moderate — interrupted itests happen during local development frequently. The fix is small: a pre-clean step at suite start that drops any prior orphans matching the naming pattern.

## Scope

**In scope:**
- A shared helper (e.g. `tests/integration/lib/tenant-db-janitor.ts`) exporting a `cleanOrphanTestDatabases(controlSql, pattern: string)` function. Pattern parameter is the LIKE pattern to match (e.g. `atlas_t_repo_itest_%`).
- The function:
  1. `SELECT datname FROM pg_database WHERE datname LIKE $1` to find matches.
  2. `DROP DATABASE` each match.
  3. `SELECT rolname FROM pg_roles WHERE rolname LIKE $1` (with the role-suffix added — typically `_runtime`).
  4. `DROP ROLE` each match.
  5. Emit a structured log event for any drops actually performed (`ItestJanitor.OrphanDropped` with `dbName` / `roleName`).
- Wire into `tests/integration/upload-tarball.itest.ts` as a `beforeAll` (BEFORE the existing provision call).
- Document the helper for future itests that follow the per-run-ID pattern.

**Out of scope:**
- Running the janitor on EVERY itest run unconditionally (it would slow non-interrupted runs and the cost is paid only when orphans exist — which is rare). Only the test files that explicitly opt in call it.
- A periodic background janitor for production. This is itest-only — production drops happen via tenant-destroy.

## Resume prompt

```
You're the port-adapter-dev for the db-per-tenant itest-janitor follow-up. sdet flagged that interrupted itest runs (Ctrl-C / OOM) leave orphan `atlas_t_repo_itest_*` databases behind because `afterAll` doesn't run. The fix is small.

Read this ticket file first (`tickets/db-per-tenant-followups/itest-tenant-db-janitor.md`).

Your task: add a `cleanOrphanTestDatabases(controlSql, pattern)` helper in a new file under `tests/integration/lib/`, wire it into the `upload-tarball.itest.ts` beforeAll, and have it emit structured `ItestJanitor.OrphanDropped` events when it actually drops something.

Key correctness bars:
- Idempotent. Runs cleanly when there are no orphans (and emits no events in that case).
- Safe pattern. The LIKE pattern must NEVER match a real production DB (`atlas_t_<actual_tenant>`). The convention for itest DBs is `atlas_t_<purpose>_itest_<runid>` — the `_itest_` infix is what distinguishes. Make sure the pattern enforces that.
- The function takes the pattern as a parameter so other itests can use it without copy-paste.

After implementation: pnpm typecheck, run `pnpm test:integration` to confirm normal flow still works, manually simulate an interrupted run (provision a fake `atlas_t_repo_itest_FAKE` DB by hand, run the test, verify the janitor drops it on next start), append dated log entry, transition to `review`.
```

## Notes / log

- 2026-05-20: created from sdet F7 finding.
- 2026-05-20: port-adapter-dev — implemented. Added `tests/integration/lib/tenant-db-janitor.ts` exporting `cleanOrphanTestDatabases(controlSql, pattern)`. Wired into `tests/integration/upload-tarball.itest.ts` `beforeAll` with pattern `atlas_t_repo_itest_%`. Safety bar enforced at the helper boundary: pattern must contain `_itest_` infix and start with `atlas_t_`, with per-row belt-and-braces check before each DROP. Emits one `{"eventName":"ItestJanitor.OrphanDropped",...}` JSON line per drop; no events when there are no orphans (idempotent). pg_terminate_backend runs before DROP DATABASE to handle any stuck connections.
  - Manual verification (live Postgres on :15433): created a fake `atlas_t_repo_itest_orphanfake` DB + matching `_runtime` role via `podman exec`; ran the itest; janitor dropped both and emitted the structured event; production tenant DBs `atlas_t_dev_tenant` and `atlas_t__platform` were preserved (no `_itest_` infix → correctly skipped). Subsequent run with no orphans was a clean no-op with zero events. A third run picked up the prior run's own orphan and dropped it, demonstrating the F7 round-trip.
  - `pnpm typecheck` failure (`vitest/globals`) is preexisting on `main` and unrelated. Standalone tsgo on the new file with the project's strict flags is clean. `tests/tsconfig.json` excludes `tests/integration/`, so this directory is not in any project-wide typecheck; Playwright resolves it at runtime.
  - The upload-tarball test itself fails on a preexisting `UNKNOWN_SCHEMA: repository.create.intent.v1 v1` from the server (reproduces on baseline `main` without my changes) — this is environmental (likely a missing `pnpm dev:up` schema-registration step) and not in scope of this ticket. The janitor's beforeAll runs and exits cleanly before that downstream failure.
  - Stayed strictly inside `tests/integration/`; no provider edits. Transitioning to `review` for sdet adversarial pass.
- 2026-05-20 (sdet): pass — finding 5 verified the two-level safety guard against adversarial pattern attempts. Status → architect.
- 2026-05-20 (architect): pass on I1 (test-only helper, no HTTP surface), test isolation safety (two-level guard; `atlas_t_dev_%` is rejected at the helper boundary), hexagonal layering (correct placement under `tests/integration/lib/`; role-suffix duplicated as constant to avoid test→adapter import), idempotent on clean runs, event name acceptable under the test-code exemption. Status → done; archived.
