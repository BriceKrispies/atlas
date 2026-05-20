---
title: Remove the defaultConnectionInfo shared-DB fallback from PostgresTenantDbProvider
status: done
type: refactor
owner: sdet
phase: 2
adr: specs/decisions/0005-custom-schema-storage-strategy.md
vision: [multi-tenant fabric, db-per-tenant]
invariants: [I7, I9]
blocks: []
blocked_by: [db-per-tenant/phase-2-dev-up-uses-real-db]
files_in_scope:
  - adapters/node/src/tenant-db-provider.ts
  - adapters/node/test/tenant-db-provider.test.ts
  - apps/server/src/bootstrap.ts
acceptance:
  - "PostgresTenantDbProvider constructor no longer accepts defaultConnectionInfo (option removed from the type and the runtime fallback removed from getPool)"
  - "getPool(tenantId) throws a structured error when control_plane.tenants.db_* are NULL — error code `TENANT_DATABASE_NOT_PROVISIONED` (see also phase-4)"
  - "apps/server/src/bootstrap.ts no longer constructs the provider with `defaultConnectionInfo` (the parseTenantConnectionUrl call is removed)"
  - "all existing tests pass; tenant-isolation tests verify cross-DB queries fail at the connection layer, not just at the tenant_id predicate"
  - "pnpm typecheck passes; pnpm test passes"
created: 2026-05-20
updated: 2026-05-20
---

## Why

ADR 0005 §Migration step 3 commits to removing the shared-DB fallback once every active tenant has `db_*` populated. Phase 2 (`db-per-tenant/phase-2-dev-up-uses-real-db`) ensures `_platform` and `dev-tenant` always have populated columns before any code reads them. With that guarantee in place, the fallback in `PostgresTenantDbProvider` becomes dead code that hides bugs: any tenant row created without proper `db_*` population would silently connect to the wrong database.

Removing the fallback closes the protocol-layer isolation promise: every tenant pool MUST connect to that tenant's dedicated database, with no defaulting allowed. A missing-`db_*` situation becomes a loud, fail-closed error rather than a silent cross-tenant data sink.

## Scope

**In scope:**
- Remove `defaultConnectionInfo` field from `PostgresTenantDbProvider`'s constructor options and from the class state.
- Remove the fallback branch in `getPool(tenantId)` that uses `defaultConnectionInfo` when `db_*` columns are NULL.
- Replace the fallback with a structured throw: `TENANT_DATABASE_NOT_PROVISIONED` (matches phase 4's renamed code) carrying `tenantId` and a clear remediation message ("run `pnpm dev:up` in dev; run the production provisioner otherwise").
- Update `apps/server/src/bootstrap.ts` to construct the provider without the `defaultConnectionInfo` option.
- Update or add a contract-level test in `adapters/node/test/tenant-db-provider.test.ts` that asserts: (a) a tenant with `db_*` populated returns a real pool; (b) a tenant with NULL `db_*` throws `TENANT_DATABASE_NOT_PROVISIONED`; (c) two tenants' pools connect to different `current_database()` values.

**Out of scope:**
- The error code rename (`TENANT_SCHEMA_NOT_PROVISIONED` → `TENANT_DATABASE_NOT_PROVISIONED`) — phase 4 owns the rename across the codebase. THIS ticket can use either code name in its throw; phase 4 will sweep it.
- Production-side provisioning paths. The provisioner from phase 1 stays the canonical write surface.
- Any change to test-only adapters (`adapter-idb`) — they don't have this fallback.

## Resume prompt

```
You're the port-adapter-dev for db-per-tenant phase 3. Phases 1 and 2 are done — `provisionTenantDatabase` exists, and `pnpm dev:up` populates `db_*` columns for every dev tenant.

Read this ticket file first (`tickets/db-per-tenant/phase-3-remove-shared-db-fallback.md`), then `specs/decisions/0005-custom-schema-storage-strategy.md` §Migration step 3.

Your task: remove the `defaultConnectionInfo` fallback from `PostgresTenantDbProvider`. Replace the fallback branch in `getPool(tenantId)` with a fail-closed throw (`TENANT_DATABASE_NOT_PROVISIONED` — the same code phase 4 will sweep into existence; for this ticket throw that code even if the global rename hasn't landed).

Update `apps/server/src/bootstrap.ts` to construct the provider without the option.

Add a test asserting two tenants' pools connect to different `current_database()` values — this is the structural proof that protocol-layer isolation holds, not just `tenant_id` predicate-level isolation.

Before you start: confirm phase 2 has actually populated `db_*` for both `_platform` and `dev-tenant` rows on the dev DB you're testing against. If not, run `pnpm dev:up` first; if dev:up itself doesn't populate `db_*`, phase 2 isn't done and you should re-route to its owner.

After implementation: pnpm typecheck + full test suite + a manual run of `pnpm dev:up; ATLAS_DEV_MODE=true TEST_AUTH_ENABLED=true pnpm --filter @atlas/server dev; curl /debug/whoami` — should still return `dev-admin@dev-tenant`. Then append dated log entry and transition to `review`.
```

## Notes / log

- 2026-05-20: created.
- 2026-05-20: implemented (port-adapter-dev). Status → `review`.
  - `adapters/node/src/tenant-db-provider.ts`: removed `defaultConnectionInfo` option from `PostgresTenantDbProviderOptions` and from the class state. The NULL `db_*` branch in `lookupConnectionInfo` now throws a new `TenantDatabaseNotProvisionedError` carrying `code = 'TENANT_DATABASE_NOT_PROVISIONED'`, `tenantId`, and a remediation message that names `pnpm dev:up` (dev) and `provisionTenantDatabase` (prod).
  - `adapters/node/src/index.ts`: re-exported `TenantDatabaseNotProvisionedError`. `parseTenantConnectionUrl` stays exported (the function still exists; no remaining callers but removing the export is out of scope).
  - `apps/server/src/bootstrap.ts`: removed the `parseTenantConnectionUrl` import and constructed the provider without options. Simplified `ensureTenantMigrated`: it no longer probes the `db_name` column (the only non-provisioned path was the now-deleted fallback) and no longer runs `runMigrations`/`reconcileTenantIndexes` — both ran solely under the fallback path with privileged DDL rights. Provisioned tenants apply migrations during `provisionTenantDatabase`.
  - `adapters/node/src/tenant-store.ts`: header comment updated — no longer says `db_*` "stays NULL".
  - `scripts/dev-up.ts`: comment refresh (removed the stale "phase-3 work to remove" reference).
  - `tests/integration/upload-tarball.itest.ts`: the only other call site that depended on the fallback. Now inserts the tenant row and calls `provisionTenantDatabase` in `beforeAll`; `afterAll` drops the per-tenant DB + role for cluster hygiene across reruns. Removed the obsolete per-tenant pre-clean and the stale "all tenants share one DB" comment.
  - `adapters/node/test/tenant-db-provider.test.ts`: added `describe('getPool — db-per-tenant isolation (phase-3 fail-closed)')` with three tests — (a) provisioned tenant returns a usable pool, (b) NULL `db_*` throws `TenantDatabaseNotProvisionedError` with code `TENANT_DATABASE_NOT_PROVISIONED`, (c) two provisioned tenants' pools connect to different `current_database()` values (structural proof of protocol-layer isolation).
  - Verification:
    - `pnpm exec atlas-test adapters/node/test/tenant-db-provider.test.ts` → 7/7 pass (4 prior + 3 new).
    - `pnpm typecheck`: my modified files clean; the workspace-level count actually decreased by 1 (128 → 127 pre-existing errors). The remaining errors (`vitest/globals` ambient, `saml-verifier.security.test.ts`, `worker-source.test.ts`, identity-a7/repositories route test never-callables) all pre-exist on main, verified by `git stash && pnpm typecheck`.
    - `pnpm test`: my new tests pass; the one failing test surfaced by the run (`saml-verifier.security.test.ts > rejects the second of two parallel verifies`) reproduces on a stashed-clean main checkout. Not caused by this slice.
    - E2E positive path: `make db-down && make db-up && pnpm dev:up && pnpm --filter @atlas/server start` → `/debug/whoami` returns `{"principalId":"dev-admin","tenantId":"dev-tenant"}`; `/api/v1/policies` (opens the tenant pool via `buildRequestBundle`) returns 200 `[]`.
    - E2E negative path: `UPDATE control_plane.tenants SET db_name = NULL WHERE tenant_id = 'dev-tenant'` then restart the server. `/debug/whoami` itself still returns 200 because that route only echoes the dev-injected principal without opening a pool. The first request to a tenant-pool-opening route (`/api/v1/policies`) responds 500 with an `UNMAPPED_ERROR` envelope; the server log emits the full structured `TenantDatabaseNotProvisionedError` (code `TENANT_DATABASE_NOT_PROVISIONED`, remediation message naming `pnpm dev:up` and `provisionTenantDatabase`, stack pointing at `lookupConnectionInfo`). The fail-closed throw fires at the connection seam, not the predicate layer. Wiring the error code into `mapError` so the HTTP envelope surfaces `TENANT_DATABASE_NOT_PROVISIONED` instead of `UNMAPPED_ERROR` is phase-4's sweep.
  - Out-of-scope deviations observed (not in this ticket):
    - `parseTenantConnectionUrl` has zero callers in tree but is still exported; left in place per scope (no `unused-export` rule fires on it).
    - The `mapError` wiring for the new error code is phase-4 work.
- 2026-05-20 (sdet): adversarial pass. Findings (most concerning first):
  - **BLOCKER: existing isolation test only proves *connection* isolation, not *data* isolation.** Phase-3 test `(c) two provisioned tenants connect to different current_database()` is necessary but insufficient — if a pool resolution bug routed writes to the wrong DB while `current_database()` still reported the named DB, (c) would pass while data still co-mingled. Added test `(d) write to tenant A is invisible to tenant B (data isolation)` in `adapters/node/test/tenant-db-provider.test.ts` that writes a probe row via tenant A's CRUD pool and asserts the same query against tenant B's CRUD pool returns 0 rows. The data-isolation half is now mechanically anchored — closing the gap between "two pools point at two DBs" and "the wrong DB literally doesn't have the row."
  - **`mapError` does not surface `TENANT_DATABASE_NOT_PROVISIONED`.** Verified at `apps/server/src/middleware/errors.ts:170-187`: only `IdentityError` and `IngressError` are mapped; everything else collapses to `TRANSACTION_FAILED` (500) with raw error payload logged under `Ingress.UnmappedError` carrying the internal `UNMAPPED_ERROR` code. The structured log DOES emit the original `TenantDatabaseNotProvisionedError` with `code = 'TENANT_DATABASE_NOT_PROVISIONED'` server-side (verified at provider line 154; logger sees it via `errorObj`), so observability is intact in logs. The HTTP envelope is wrong (UNMAPPED_ERROR + "Internal storage failure" + supportId). **Filed as follow-up — out of scope for this slice but should land before custom-schema handlers throw this code in user-visible flows; the current shape is acceptable while only the dev-up fail-closed path can trigger it.**
  - **`parseTenantConnectionUrl` is dead exported code.** Zero callers in tree after `bootstrap.ts` stopped using it; still exported via `adapters/node/src/index.ts:25`. Phase-3 explicitly left this in scope-deferral; noting it doesn't fire any unused-export rule today. **Filed as follow-up.**
  - **`bootstrap.ts ensureTenantMigrated` no longer probes `db_name`.** Verified there is no path that opens a tenant pool against an unmigrated DB: provisioning runs migrations under the provisioner role; the runtime role pool only connects after `db_*` are populated; `getPool` throws fail-closed otherwise. The simplification is sound.
  - **`upload-tarball.itest.ts` cleanup correctness.** `afterAll` only runs if `sql` is truthy (i.e., `beforeAll` got past `CP_URL` and the server-health probe). If a test fails midway after the DB + role were provisioned, cleanup still runs — `afterAll` is unconditional past the guard. Parallel test files: each test generates a unique `RUN_ID = Date.now().toString(36)` so the per-tenant DB name is unique across reruns AND across parallel files; no collision risk. **Acceptable.** One latent risk: if `beforeAll` provisions the DB then the health-probe-passed test body throws *before* `afterAll`, the DB + role remain until the next CI run with the same `RUN_ID` (impossible) — so accumulation is the actual risk. Mitigated by `RUN_ID` uniqueness; the cluster will accumulate orphans over time. **Filed as follow-up: periodic janitor or a `DROP IF EXISTS` of all `atlas_t_repo_itest_*` databases on every run start.**
  - **Concurrent `provisionTenantDatabase` not de-duped** (carried from phase-1 finding). Not regressed by phase-3.
  - Transitioning to `architect`. The blocker (added test) is resolved in-slice; the `mapError` gap is acknowledged out-of-scope.
- 2026-05-20 (sdet): status → architect.
- 2026-05-20 (architect): signed off. Fail-closed throw at the connection seam closes the protocol-layer isolation promise; tests (c) + (d) anchor structural isolation (different `current_database()`, data invisible across DBs). F3 HTTP-envelope gap tracked in `db-per-tenant-followups/error-envelope-mapping`. No blockers. Status → done; archived.
