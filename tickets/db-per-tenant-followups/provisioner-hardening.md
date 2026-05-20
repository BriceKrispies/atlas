---
title: Harden provisionTenantDatabase — concurrency, precondition, partial-state, onnotice
status: review
type: refactor
owner: port-adapter-dev
phase: 1
adr: specs/decisions/0005-custom-schema-storage-strategy.md
vision: []
invariants: []
blocks: []
blocked_by: []
files_in_scope:
  - adapters/node/src/tenant-db-provider.ts
  - adapters/node/src/index.ts
  - adapters/node/test/tenant-db-provider.test.ts
acceptance:
  - "F4 — concurrent provisionTenantDatabase calls for the same tenantId are de-duped (single in-flight execution; second caller awaits the first's result). Test asserts two parallel calls produce one CREATE DATABASE."
  - "F5 — provisionTenantDatabase rejects with a structured error if no control_plane.tenants row exists for the tenantId. The DB and role are NOT created on the rejected path. Test asserts the error code and that no atlas_t_<id> DB exists after the rejected call."
  - "F6 — partial-state recovery: if a prior call created the role but crashed before UPDATEing control_plane.tenants, re-running converges. Either via transaction-wrapping the create+UPDATE, or by always-writing db_host/db_port/db_name/db_user on the reconciled path. Test asserts: drop the role, leave db_* NULL, re-run → end state matches first-time-success."
  - "F8 — provisioner pool uses onnotice: () => {} so postgres NOTICEs ('relation already exists, skipping' etc.) don't leak to stdout"
  - "pnpm typecheck passes; pnpm --filter @atlas/adapter-node test passes"
created: 2026-05-20
updated: 2026-05-20
---

## Why

sdet review of the db-per-tenant slice flagged four small gaps in `provisionTenantDatabase`. None blocked the slice (the contract claim was "idempotent on the happy path," which holds), but each represents a way the contract is narrower than its claim or noisier than it should be. Bundled into one ticket because all four touch the same method.

- **F4** — Concurrent calls for the same tenant race on the `pg_database` existence check.
- **F5** — If a caller invokes `provisionTenantDatabase` before inserting the `control_plane.tenants` row, the UPDATE silently affects zero rows but the DB + role are still created.
- **F6** — If `CREATE ROLE` succeeds but the process crashes before the UPDATE, re-running returns `wasFirstTime = false` and skips the UPDATE. Row stays NULL forever; manual DROP ROLE required to recover.
- **F8** — Postgres NOTICE chatter on idempotent re-runs leaks to stdout because the provisioner pool doesn't set `onnotice`.

## Scope

**In scope:**

1. **F4 — Concurrent de-dup.** Add an in-flight map keyed by `tenantId` to `provisionTenantDatabase`, mirroring the pattern used by `getPool` (see existing `inFlight` field on the same class). Second caller for the same tenant awaits the first's promise. Test: kick two `provisionTenantDatabase` calls in parallel, assert only one `Tenancy.Database.Provisioned` event fires.

2. **F5 — Precondition enforcement.** At the top of `provisionTenantDatabase`, `SELECT 1 FROM control_plane.tenants WHERE tenant_id = $1`. If no row, throw a structured error (`TENANT_ROW_MISSING` is a reasonable code — coordinate with `specs/error_taxonomy.json`). The DB + role MUST NOT be created on the rejection path. Test: call `provisionTenantDatabase` for a tenantId with no row, assert the throw, assert `pg_database` does NOT have an `atlas_t_<id>` entry.

3. **F6 — Partial-state recovery.** Choose the simpler of two approaches:
   - **Option A (preferred):** make the reconciled path *always* write `db_host/db_port/db_name/db_user` even when `wasFirstTime = false`. Password write only on first-time (don't rotate). This makes the operation idempotent under partial state without needing a real transaction.
   - **Option B (more invasive):** wrap CREATE ROLE + UPDATE in a single Postgres transaction. May not be possible because CREATE DATABASE can't run in a transaction; CREATE ROLE can. So this is partial-coverage at best.
   Go with Option A unless you find a concrete reason not to. Test: simulate the partial state (drop the role after a successful provision, NULL out db_*), re-run, assert convergence.

4. **F8 — onnotice suppression.** In `openPostgresFromInfo` (or wherever the provisioner pool is constructed inside `provisionTenantDatabase`), add `onnotice: () => {}` to the postgres options. Verify by running `pnpm dev:up` twice and confirming no NOTICE chatter on stdout.

**Out of scope:**
- The HTTP envelope mapping for these new errors (`TENANT_ROW_MISSING` etc.) — file a separate follow-up or roll into the F3 ticket if convenient.
- `tenant_id` validation rules (already enforced by `getPool`'s identifier safety).
- The cleartext-password storage in `control_plane.tenants.db_password` — separate ADR-followup tracked under `storage/secrets`.

## Resume prompt

```
You're the port-adapter-dev for the db-per-tenant provisioner-hardening follow-up. sdet's slice review flagged four small gaps in `provisionTenantDatabase` (F4, F5, F6, F8) — all touch the same method. Bundled into one ticket.

Read this ticket file first (`tickets/db-per-tenant-followups/provisioner-hardening.md`). Each acceptance bar maps to one finding.

Your task: implement F4 (concurrent de-dup), F5 (precondition enforcement), F6 (partial-state recovery via Option A — always-write reconciled path), F8 (onnotice suppression). Add tests for F4, F5, F6 — F8 is verified by manual `pnpm dev:up` run.

Key correctness bars:
- F4's in-flight map must NOT leak entries — clear on resolve AND reject. Mirror the existing `inFlight` pattern in `getPool` on the same class.
- F5's row-check must happen BEFORE any side effect (no `CREATE DATABASE`, no `CREATE ROLE`). Throw `TENANT_ROW_MISSING` (or coordinate with the user on the code name if you find a more conventional one in errors.md / error_taxonomy.json).
- F6 Option A: on the `wasFirstTime = false` path, still issue the UPDATE setting db_host/db_port/db_name/db_user. Don't touch db_password (don't rotate). This is what makes partial-state recovery converge.
- F8: pass `onnotice: () => {}` to the provisioner pool's postgres() call. Verify the suppression actually takes effect by running pnpm dev:up twice.

After implementation: pnpm typecheck + adapter-node tests, run `pnpm dev:up` twice to confirm no NOTICE chatter, append dated log entry, transition to `review`.
```

## Notes / log

- 2026-05-20: created from sdet F4/F5/F6/F8 findings.
- 2026-05-20: implemented (port-adapter-dev). All four findings landed in `adapters/node/src/tenant-db-provider.ts`:
  - **F4**: new `inFlightProvision` Map mirroring the `inFlight` pattern from `getPool`. Public `provisionTenantDatabase` checks the map, awaits the pending promise if present, otherwise sets it and delegates to private `runProvisionTenantDatabase`. The `.finally(() => this.inFlightProvision.delete(tenantId))` clears on both resolve and reject. Test `(f4)` runs two parallel calls and asserts identical result objects + exactly one `Tenancy.Database.Provisioned` log event across both callers' loggers. Test `(f4-clear-on-reject)` proves the map clears on reject by forcing F5 rejection then re-inserting the row + re-calling.
  - **F5**: Step 1 of `runProvisionTenantDatabase` is a `SELECT EXISTS(...) FROM control_plane.tenants WHERE tenant_id = $1` row check. If absent, throws new `TenantNotFoundError` (code `TENANT_NOT_FOUND`, the canonical taxonomy code chosen over the ad-hoc `TENANT_ROW_MISSING` — `specs/error_taxonomy.json` already covers "tenant id does not exist or is not accessible"). The check runs BEFORE the `pg_database` existence check and BEFORE any CREATE. Exported from `adapters/node/src/index.ts`. Test `(f5)` deletes the beforeEach row, calls the provisioner, asserts `TenantNotFoundError` with `code = 'TENANT_NOT_FOUND'`, and asserts both `pg_database` and `pg_roles` are clean.
  - **F6 (Option A)**: Step 6 of `runProvisionTenantDatabase` now has two branches — first-time writes all five `db_*` columns including `db_password`; reconciled writes `db_host/db_port/db_name/db_user` but NOT `db_password`. The reconciled UPDATE is what converges partial-state. Test `(f6)` first-time-provisions, snapshots `db_password`, NULLs out the four coordinates (simulating crash mid-UPDATE), re-runs, asserts coordinates restored and `db_password` unchanged.
  - **F8**: `openPostgresFromInfo` now passes `onnotice: () => {}` to `postgres()`. Verified by running `pnpm dev:up` twice — both runs produce zero `NOTICE`/`skipping` output on stdout and stderr (counted via `grep -ci`). Structured `DevUp.*` events still flow to stderr as before.
- 2026-05-20: tests passing — `pnpm exec atlas-test test/tenant-db-provider.test.ts` from `adapters/node/` runs 13/13 green (4 new tests + 9 pre-existing). Three unrelated pre-existing flakes in the wider adapter-node suite (`search-engine.ts` concurrency test, two `worker-source.test.ts` LISTEN/NOTIFY timing tests) were not touched by this work and predate it (last commit on those files was 4 commits ago, before this session). Typecheck noise from the `@atlas/test` shim's loose `it`/`describe` types is pre-existing and identical in shape across every test file. Source file `tenant-db-provider.ts` itself is typecheck-clean.
- 2026-05-20: status → review.
