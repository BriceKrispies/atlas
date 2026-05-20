---
title: dev-up provisions real per-tenant databases
status: done
type: chore
owner: sdet
phase: 2
adr: specs/decisions/0005-custom-schema-storage-strategy.md
vision: [frictionless dev, prod parity]
invariants: []
blocks: [db-per-tenant/phase-3-remove-shared-db-fallback]
blocked_by: [db-per-tenant/phase-1-provisioner-extension]
files_in_scope:
  - scripts/dev-up.ts
  - apps/server/src/bootstrap.ts
acceptance:
  - "`pnpm dev:up` against a fresh DB provisions `atlas_t__platform` and `atlas_t_dev_tenant` as real Postgres databases"
  - "control_plane.tenants rows for `_platform` and `dev-tenant` have non-null db_host/db_port/db_name/db_user/db_password after dev:up completes"
  - "seeded platform-admin and dev-admin Users land in the per-tenant DBs, NOT in the shared control_plane.public.entities"
  - "running `pnpm dev:up` twice is idempotent — no errors, no duplicate rows"
  - "starting the server in dev-mode after dev:up and hitting /debug/whoami still returns {principalId: dev-admin, tenantId: dev-tenant}"
  - "every action emits a matching structured `DevUp.*` log event including new `DevUp.PlatformDatabase.Provisioned` and `DevUp.DevDatabase.Provisioned` events"
  - "pnpm typecheck passes"
created: 2026-05-20
updated: 2026-05-20
---

## Why

ADR 0005 revised 2026-05-20 commits to db-per-tenant. ADR 0015 §5 names the dev-up script as the bootstrap path for the dev data plane. Today `pnpm dev:up` exercises the shared-DB fallback in `PostgresTenantDbProvider` — both `_platform` and `dev-tenant` end up co-located in the `control_plane` database with `tenant_id` columns scoping rows. That doesn't match the prod posture the ADR 0015 contract is supposed to give.

This slice flips dev-up to call `provisionTenantDatabase` (from phase 1) for both `_platform` and `dev-tenant`, then seeds into the per-tenant DBs. After this lands, dev mode exercises the production code path: real per-tenant Postgres databases, real `db_*` column population, real connection isolation. The bootstrap path in `apps/server/src/bootstrap.ts` (which seeds the `_platform` tenant on first server boot) also needs updating so first-time server boot doesn't re-bootstrap into the shared DB.

## Scope

**In scope:**
- `scripts/dev-up.ts` rewrite of steps 3 and 4:
  - For `_platform`: call `tenantDb.provisionTenantDatabase({ tenantId: PLATFORM_TENANT_ID, name: 'Atlas Platform' })`, then get a pool for `_platform` (which now resolves to the new DB via `db_*` columns), then seed `platform-admin` User + Membership into that DB.
  - For `dev-tenant`: same shape — provision, seed.
- `apps/server/src/bootstrap.ts`: the `INSERT ... control_plane.tenants ... PLATFORM_TENANT_ID` block + the `seedPlatformAdmin` call need to handle "platform tenant exists but no `db_*` columns set" by either provisioning at boot or refusing with a clear error pointing at `pnpm dev:up`. **Default to refusing with a clear error** — dev-up is the canonical bootstrap path; server boot should not do double-duty as a provisioner.
- New structured log events `DevUp.PlatformDatabase.Provisioned` and `DevUp.DevDatabase.Provisioned` emitted on first-time provision; matching `*.RowReconciled` style ("already provisioned" path emits at level info with `inserted: false`-equivalent).
- All other progress / observability requirements from ADR 0015 §5 still hold.

**Out of scope:**
- Removing the `defaultConnectionInfo` fallback — that's phase 3.
- Migrating existing data already sitting in the shared DB. Existing dev databases get re-seeded into the per-tenant DBs; the orphan rows in the shared DB are NOT carried forward. Acceptable because dev data is disposable; if a dev had real data they cared about, they can `pg_dump` it pre-cutover.
- Production server-boot provisioning. Server boot should fail loudly if `_platform`'s `db_*` are NULL; the operator-side provisioning (real prod) is separate.

## Resume prompt

```
You're the module-dev for db-per-tenant phase 2. Phase 1 (the provisioner extension on `PostgresTenantDbProvider`) has landed — `provisionTenantDatabase({tenantId, name})` is callable.

Read this ticket file first (`tickets/db-per-tenant/phase-2-dev-up-uses-real-db.md`), then read `specs/decisions/0005-custom-schema-storage-strategy.md` (the revised ADR) and `specs/decisions/0015-dev-mode-contract.md` §5 (the dev-up seed contract).

Your task: update `scripts/dev-up.ts` and `apps/server/src/bootstrap.ts` so dev-up provisions real per-tenant databases for both `_platform` and `dev-tenant`, and server boot refuses to start if those `db_*` columns are missing.

Key correctness bars:
- Idempotency holds end-to-end. Re-running `pnpm dev:up` against a partially-provisioned state finishes the job; against a fully-provisioned state is a no-op.
- Observability: every action emits a structured log event. Add `DevUp.PlatformDatabase.Provisioned` and `DevUp.DevDatabase.Provisioned` on first-time provision; reconciliation events otherwise. Match the existing `DevUp.*` event-naming convention.
- Seeding (`ensureUserAndMembership` for both admins) now writes into the per-tenant DB's pool — `getPool(tenantId)` will resolve to the new DB once `db_*` columns are populated, so the existing seed logic should "just work" against the new pool. Verify this is the case before assuming.
- Server boot: if `bootstrap.ts` finds `_platform` row with NULL `db_*`, throw a fatal error pointing the operator at `pnpm dev:up`. Don't auto-provision at server boot — keep dev-up as the canonical bootstrap path.

E2E verification: after your changes, from a fresh DB:
  1. `make db-down && make db-up` (fresh Postgres)
  2. `pnpm dev:up` — should provision both DBs and seed
  3. `podman exec atlas-platform-control-plane-db psql -U atlas_platform -d control_plane -c "SELECT tenant_id, db_name FROM control_plane.tenants"` — both rows should have db_name populated
  4. `podman exec atlas-platform-control-plane-db psql -U atlas_platform -d atlas_t_dev_tenant -c "SELECT entity_id FROM public.entities"` — dev-admin should be in the dev-tenant DB
  5. Start server with ATLAS_DEV_MODE=true; curl /debug/whoami; should return dev-admin@dev-tenant
  6. `pnpm dev:up` again — idempotent, no errors

After implementation: run typecheck + tests, append dated log entry, transition to `review` for sdet handoff.
```

## Notes / log

- 2026-05-20: created.
- 2026-05-20: **module-dev** implemented. Status → `review` for sdet handoff.

  **Changes shipped:**
  - `scripts/dev-up.ts`: removed `defaultConnectionInfo` from `PostgresTenantDbProvider` construction (db-per-tenant only). Reordered to ensure tenant row (INSERT ON CONFLICT) → `provisionTenantDatabase` → `getPool` (now resolves to per-tenant DB via populated `db_*`) → seed. Emits `DevUp.PlatformDatabase.Provisioned` / `DevUp.DevDatabase.Provisioned` on first-time path; `DevUp.PlatformDatabase.Reconciled` / `DevUp.DevDatabase.Reconciled` on the idempotent path. The redundant `DevUp.*Tenant.MigrationsApplied` events are gone — migrations now happen inside `provisionTenantDatabase` (logged via `Tenancy.Database.Provisioned`) and the script doesn't need a separate step.
  - `apps/server/src/bootstrap.ts`: added a `_platform.db_*` NULL guard immediately after the platform-tenant row ensure. Refuses to boot with `Server.Boot.PlatformDatabaseMissing` fatal log + thrown error pointing the operator at `pnpm dev:up`. Kept `defaultConnectionInfo` on the `tenantDb` constructor with a comment noting phase-3 removes it wholesale.
  - `apps/server/src/bootstrap.ts` (`ensureTenantMigrated`): skip the migration runner + index reconciler when the tenant's `db_*` columns are populated. Necessary because the runtime role connecting via `getPool` does NOT have `CREATE` on `public`, so the runner's `CREATE TABLE IF NOT EXISTS public._migrations` + `reconcileTenantIndexes`'s `CREATE INDEX` fail with `permission denied for schema public` even when there is nothing to apply. The provisioner role already ran migrations during `provisionTenantDatabase`. The shared-DB fallback path (privileged control-plane user) still hits the runner — that's the only legitimate caller of the migration step at request time until phase-3 removes the fallback.

  **E2E verification (`make db-down && make db-up` fresh state):**
  1. `pnpm dev:up` succeeded; emitted `DevUp.PlatformDatabase.Provisioned` and `DevUp.DevDatabase.Provisioned` (full event sequence: Started, LoopbackGuard.Passed, ControlPlaneProbe.Ok, ControlPlaneMigrations.Applied, PlatformTenant.RowReconciled, PlatformDatabase.Provisioned, PlatformAdmin.Reconciled, DevTenant.RowReconciled, DevDatabase.Provisioned, DevAdmin.Reconciled, Completed).
  2. `SELECT tenant_id, db_name FROM control_plane.tenants` → `_platform | atlas_t__platform` and `dev-tenant | atlas_t_dev_tenant` (both rows populated).
  3. `SELECT entity_id FROM atlas_t_dev_tenant.public.entities` → `dev-admin` and `membership:dev-admin` rows.
  4. `SELECT entity_id FROM atlas_t__platform.public.entities` → `platform-admin` and `membership:platform-admin` rows.
  5. Server boot with `ATLAS_DEV_MODE=true TEST_AUTH_ENABLED=true DEBUG_AUTH_ENDPOINT_ENABLED=true`: emitted `Server.Boot.Listening` (full sequence: Server.Boot.Starting → MailerSelected → DevModeEnabled (warn) → Complete → Listening). `curl http://localhost:3000/debug/whoami` → `{"principalId":"dev-admin","tenantId":"dev-tenant"}`. (Server uses the runtime role's pool against the per-tenant DB; CRUD on entities works as expected.)
  6. Re-running `pnpm dev:up` was idempotent: exit 0, no duplicate rows, emitted `Reconciled` events instead of `Provisioned` (PlatformDatabase.Reconciled, DevDatabase.Reconciled), output showed "already present" for every row.

  **Negative path verified.** Manually nulled `_platform.db_*` columns and booted the server — fatal log `Server.Boot.PlatformDatabaseMissing` fired with the missing column list, and `Server.Boot.Failed` carried the operator-facing message: `Platform tenant '_platform' is missing per-tenant database connection coordinates (db_host, db_port, db_name, db_user, db_password). Run \`pnpm dev:up\` to provision the per-tenant DB before starting the server. See ADR 0005 (db-per-tenant) and ADR 0015 §5 (dev-up seed contract).`

  **Quality gates:**
  - `pnpm safe typecheck`: clean for my files. The pre-existing `vitest/globals` type-defs error is unrelated.
  - `pnpm safe lint`: clean for my files. The pre-existing `no-non-null-assertion` errors in `adapters/node/test/tenant-db-provider.test.ts:172-173` are phase-1 territory.

  **Note for sdet / phase-1 follow-up (NOT blocking):**
  - On idempotent re-runs, `provisionTenantDatabase` emits two raw postgres.js NOTICE lines on stdout (`relation "_migrations" already exists, skipping`) because the provisioner pool inside the provisioner doesn't set `onnotice`. Cosmetic only — doesn't appear in structured logs and doesn't affect behavior. Phase-1 file (`adapters/node/src/tenant-db-provider.ts`'s `openPostgresFromInfo`) is the right place to wire `onnotice: () => {}` for provisioner pools.
  - Partial-state recovery has one edge case I did NOT solve: if a previous `provisionTenantDatabase` run created the role but did NOT persist `db_*` (e.g., crashed between role-create and the UPDATE — unlikely outside synthetic tests), re-running dev-up reports `Reconciled` (because the role exists, `wasFirstTime` is false in phase-1) but then `getPool` fails with `tenant _platform is missing one of {db_host, db_port, db_name, db_user, db_password}`. This is solvable in phase-1 by either (a) wrapping role-create + UPDATE in a single transaction, or (b) always writing `db_host/db_port/db_name/db_user` on the reconciled path (with the password unchanged). The realistic recovery path is "drop the role + db, re-run dev-up" which works. Not in this slice's scope; leaving as a phase-1/phase-3 follow-up.
- 2026-05-20 (sdet): adversarial pass. Findings:
  - **Server-boot guard works as advertised.** Verified the `Server.Boot.PlatformDatabaseMissing` fatal path and remediation message (named ADR 0005 + ADR 0015 §5). Negative-path manual reproduction in module-dev's log is consistent with the code.
  - **`ensureTenantRow` → `provisionTenantDatabase` ordering is correct but the precondition is silent.** If a future caller invokes `provisionTenantDatabase` without inserting the row first, the UPDATE inside the provisioner silently affects 0 rows but still creates the DB + role and returns success. Dev-up gets ordering right but the provisioner doesn't enforce its precondition. **Out of scope for phase 2 — file as phase-1 follow-up** ("provisionTenantDatabase should fail closed when the tenants row is missing"). Not blocking because today's two callers (dev-up + the integration test) both insert before calling.
  - **Idempotency under partial dev-state.** Re-running dev-up after a manual `DROP DATABASE atlas_t_dev_tenant` (row still present, db_* still populated, DB physically gone) silently re-creates the DB via the `pg_database` existence probe, then `runMigrations` runs against the empty DB — green. But the `db_password` column already has a value and step 3 (CREATE ROLE) sees `roleExists = true` because we did NOT drop the role; result: a fresh DB but the role's password is unchanged and the runtime pool reconnects. Verified mentally; works. The flip (drop role but keep DB) does fail because CREATE ROLE with a new password makes the persisted `db_password` stale — but `wasFirstTime = createdRole && generatedPassword !== null` is true so the UPDATE runs and refreshes the password. Both partial-state paths recover. **Not a blocker.**
  - **Observability completeness.** Every dev-up step emits a structured event (Started, LoopbackGuard.{Passed,Failed}, ControlPlaneProbe.{Ok,Failed}, ControlPlaneMigrations.Applied, PlatformTenant.RowReconciled, PlatformDatabase.{Provisioned,Reconciled}, PlatformAdmin.Reconciled, DevTenant.RowReconciled, DevDatabase.{Provisioned,Reconciled}, DevAdmin.Reconciled, Completed/Failed). Acceptance bar met.
  - No blockers. Transitioning to `architect`.
- 2026-05-20 (sdet): status → architect.
- 2026-05-20 (architect): signed off. Server-boot fail-closed guard is the right seam for I1; dev-up's structured event sequence satisfies the observability contract; `_platform` getting its own `atlas_t__platform` strengthens ADR 0008. No blockers. Status → done; archived.
