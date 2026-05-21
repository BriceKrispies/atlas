---
title: Harden provisionTenantDatabase — concurrency, precondition, partial-state, onnotice
status: done
type: refactor
owner: architect
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
- 2026-05-20: sdet bounce → back to in-flight. Two issues:
  1. (important) F6 partial-state coverage too narrow — the realistic
     crash is "CREATE ROLE succeeded, no UPDATE ran at all" → ALL
     FIVE db_* columns NULL including db_password. Under the
     previous reconciled-only path, db_password stayed NULL forever
     and getPool kept throwing TENANT_DATABASE_NOT_PROVISIONED.
  2. (nit) F4 test under-specified — `aProvisioned.length +
     bProvisioned.length === 1` was satisfied by either ordering;
     didn't pin "first caller fires, joining caller is silent
     passenger".
- 2026-05-20: bounce fix landed (port-adapter-dev):
  - **F6 widened**: `runProvisionTenantDatabase` now snapshots
    `db_password` alongside the existence check in Step 1. Step 3
    introduces a `needsFreshPassword` predicate — true when EITHER
    the role doesn't exist (createRole branch, unchanged) OR the
    role exists but `control_plane.tenants.db_password IS NULL`. On
    the latter (post-partial-crash recovery) path we generate a
    fresh password and issue `ALTER ROLE <name> WITH PASSWORD
    '<new>'`. Step 6 keyed on `generatedPassword !== null` instead
    of `wasFirstTime`: when a password was generated (first-time OR
    recovery), all five columns are written; on pure idempotent
    re-runs (role exists AND db_password populated), only the four
    coordinates are written. Step 7's Provisioned event fires
    whenever a password was generated (recovery IS materially a
    provision). Rotation on recovery is safe because no getPool
    could have succeeded against the NULL row — there is no open
    runtime pool to lock out. Method docstring updated to spell the
    convergent semantics out: "first-time, post-partial-crash, and
    reconciled paths converge. Password is generated only when both
    the role doesn't exist OR db_password is NULL; otherwise
    preserved."
  - **F4 test tightened**: `expect(aProvisioned.length).toBe(1);
    expect(bProvisioned.length).toBe(0);` pins the first-caller-
    fires / joining-caller-silent contract. The old sum-based
    assertion is gone.
  - **New test `(f6-all-null)`**: NULLs all five db_* columns
    (simulating "CREATE ROLE succeeded, no UPDATE ran at all"),
    re-runs the provisioner with a captureLogger, asserts: all five
    columns repopulated, db_password is a fresh non-empty value
    differing from the pre-NULL snapshot, Provisioned event emits,
    `getPool` succeeds (the load-bearing acceptance bar — before the
    fix getPool would have thrown TENANT_DATABASE_NOT_PROVISIONED
    forever).
  - Tests: 14/14 green in `adapters/node/test/tenant-db-provider.test.ts`
    (13 prior + 1 new f6-all-null). The narrow F6 case (db_password
    survived, other columns NULL) still passes — `needsFreshPassword`
    is false there, so the password is preserved.
  - `pnpm dev:up` round-trip: zero `NOTICE`/`skipping` on stdout or
    stderr (counted via `grep -ci`). F8 suppression intact.
  - Typecheck noise from the `vitest/globals` ambient type and the
    @atlas/test shim is pre-existing and identical with these
    changes reverted; the source file itself introduces no new
    type errors.
- 2026-05-20: status → review.
- 2026-05-20: sdet re-review (bounce-fix pass). All six verification points green:
  1. `(f6-all-null)` test (test/tenant-db-provider.test.ts:691-785)
     NULLs all five `db_*` columns, re-runs, asserts all five
     repopulated, password differs from snapshot
     (`expect(after[0]?.db_password).not.toBe(passwordBefore)`,
     line 765), `getPool` succeeds against the recovered row
     (lines 779-781 — the load-bearing bar). The narrow `(f6)`
     partial-NULL test (lines 600-665) still passes because
     `needsFreshPassword` is false when `db_password` survived.
  2. `ALTER ROLE` path uses `quoteIdent(runtimeRole)` and
     `quoteLiteral(generatedPassword)` (src/tenant-db-provider.ts:514).
     `quoteIdent` rejects identifiers outside `[a-z0-9_]`
     (lines 114-119); `quoteLiteral` doubles single quotes
     (lines 125-127). No injection vector.
  3. Rotation-is-safe claim holds: `lookupConnectionInfo`
     (src/tenant-db-provider.ts:641-677) throws
     `TenantDatabaseNotProvisionedError` if ANY of the five
     `db_*` columns is NULL — including `db_password`. With
     `db_password IS NULL` there is no runtime pool that could
     have authenticated, so `ALTER ROLE` cannot lock out an
     in-flight client.
  4. F4 test (test/tenant-db-provider.test.ts:506-507) pins
     `aProvisioned.length === 1` AND `bProvisioned.length === 0`.
     The comment on lines 498-505 explains Promise.all array-order
     dispatch makes the A vs B winner deterministic.
  5. 14/14 tests in the file (counted via `it(` matches at lines
     121/209/246/318/343/356/379/413/465/518/549/600/691/787 plus
     the surrounding `it.skip` guard). No prior test was modified
     destructively — only F4's assertion tightened and the new
     `(f6-all-null)` appended.
  6. Edge case (createdRole=false, existingPassword!==null, but
     pg_roles password drift from db_password): outside
     `needsFreshPassword` truth so no ALTER ROLE fires; subsequent
     `getPool` would fail authn at the postgres protocol level.
     Acceptable — this is a "someone ran ALTER ROLE behind our
     back" path, not a crash-recovery path, and is not in the
     threat model for this slice.
- 2026-05-20: status → architect.
- 2026-05-20 (architect): all seven verification points green. I1 — provisioner remains platform code, no HTTP side-door; called only from `apps/server/src/bootstrap.ts` and `scripts/dev-up.ts`. I14 — `ALTER ROLE` runs on the privileged `controlPlane` connection (tenant-db-provider.ts:514); runtime role grants are unchanged across rotation. I16 — `ALTER ROLE` is cluster-scope, reachable only from the private `runProvisionTenantDatabase`; not exposed via ports, no route. Idempotency contract — all three paths (all-existing reconciled / all-NULL recovery / DB-exists-role-doesn't) converge under re-run; the `generatedPassword !== null` keying is correct. F4 concurrency — `inFlightProvision` wraps the new ALTER ROLE path; second caller awaits A's promise and receives the same result object. Observability — Provisioned event fires once per minted credential (first-time OR recovery), suppressed on pure idempotent re-run. Minor coverage note: no dedicated test for out-of-band manual DROP DATABASE / DROP ROLE (one without the other); filed as `provisioner-out-of-band-state-coverage`. Status → done; archived.
