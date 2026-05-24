---
title: G3 — out-of-band migration runner (re-apply schema to a wiped DB without a server boot)
status: review
type: drift-finding
owner: port-adapter-dev
phase: 1
capability: specs/domains/runtime/capabilities/out-of-band-migration/README.md
adr: specs/crosscut/always-on.md
vision: [atlas-on-atlas, machine-readable-surfaces]
invariants: [I20, I17]
blocks: []
blocked_by:
  - drift-always-on-2026-05/db-wipe-reseed-forces-restart
files_in_scope:
  - adapters/node/src/migrations/runner.ts
  - Makefile
  - specs/crosscut/atlasctl.md
acceptance:
  - "Migrations (control-plane + tenant) can be (re)applied to a freshly-wiped DB WITHOUT booting apps/server."
  - "Design fork resolved in Phase 0 (see Scope): standalone runner vs Atlas admin endpoint, honoring atlasctl INV-CTL-01 (no direct DB access from atlasctl)."
  - "The tools/db-snapshot W4 cycle uses it; make db-migrate is no longer a silent no-op (either does the work or points at the new runner)."
created: 2026-05-23
updated: 2026-05-23
files_changed:
  - scripts/migrate.ts
  - scripts/migrate.test.ts
  - Makefile
  - package.json
---

> **UNRESOLVED FORK — user decision required before Phase 1.0.** The capability
> spec presents two options: (a) standalone out-of-band runner, (b) Atlas admin
> endpoint. Spec recommends (a) now, (b) as eventual operator surface. Phase 1.0
> cannot start until the user picks. See the Design Fork section of the README.

## Why

Migrations run only on server boot (`apps/server/src/bootstrap.ts:270`) or at tenant provisioning (`adapters/node/src/tenant-db-provider.ts:522`). `make db-migrate` is an inert echo (`Makefile:169-174`). So re-applying schema to a wiped DB requires a boot — a restart-forcing point in the wipe→reseed cycle. See parent `drift-always-on-2026-05/db-wipe-reseed-forces-restart`.

## Scope

**Phase-0 design fork (decide first, escalate to user):**
- **(a) Standalone runner** — a `scripts/migrate.ts` / `tools/db-snapshot` subcommand calling `runMigrations` out-of-band. Simplest; it's literally what the restore tool already does internally. Keeps it out of atlasctl (INV-CTL-01 in `specs/crosscut/atlasctl.md` forbids atlasctl touching the DB directly).
- **(b) Atlas admin endpoint** — a server route that triggers in-band migration on a running server (true "ask the live kernel to migrate"). More aligned with always-on/agentic-first, larger surface; if pursued, add the command to the atlasctl spec table first and gate it.

Recommend (a) for the W4 cycle now; note (b) as the eventual operator surface.

**Out:** the reconnect (G1) and tenant-pool-invalidation (G2) gaps.

## Resume prompt

```
Slice with a Phase-0 design fork: provide an out-of-band way to (re)apply Atlas migrations
to a wiped DB without booting apps/server (always-on §1, I20). runMigrations
(adapters/node/src/migrations/runner.ts) is idempotent and reusable. Decide (a) standalone
runner / tools subcommand vs (b) Atlas admin endpoint — atlasctl INV-CTL-01 forbids direct
DB access from atlasctl, so (a) is NOT an atlasctl-direct-DB command. Escalate the fork to
the user at the Phase-0 checkpoint. Then scaffold + impl + architect gate; wire make db-migrate
to the chosen runner so it's no longer a no-op.
```

## Notes / log

- 2026-05-23: filed. Child of db-wipe-reseed-forces-restart. Carries a Phase-0 design fork for the user.
- 2026-05-23: FORK RESOLVED by user → option (a) standalone runner only (no admin endpoint).
  Implemented (port-adapter-dev), test-first. `scripts/migrate.ts` exports
  `runOutOfBandMigrations({controlPlaneDbUrl,logger?,progress?})` (named/exported for
  unit-testability — no env coupling, no subprocess) + `assertLoopback`; `main()` reads
  `CONTROL_PLANE_DB_URL` and runs only on direct invocation (entrypoint guard so the test can
  import without side effects). Reuses `runMigrations` unchanged. `make db-migrate` repointed
  (`node --experimental-transform-types scripts/migrate.ts`, keeps db-wait dep); root
  `package.json` gains `"migrate"`. Test at `scripts/migrate.test.ts` (NOT tests/integration —
  that dir is Playwright-only + server-dependent + excluded from atlas-test; this runs under
  `atlas-test` like the precedent `tools/db-snapshot/test/round-trip.test.ts`). Uses SCRATCH DB
  `oob_migrate_test`; never touches live control_plane / atlas_t_* DBs; no container bounce; all
  pools closed.
  Red→Green: test first failed ERR_MODULE_NOT_FOUND (runner absent); then 5/5 green.
  TWO live-DB findings surfaced (not catchable by the scratch-only test, which has zero tenants):
    (1) tenant fan-out MUST connect as the PROVISIONER identity (control-plane creds + tenant DB
        name), NOT the stored db_user/db_password — that's the CRUD-only runtime role and
        `runMigrations` against it fails `permission denied for schema public` (ADR 0005
        two-role topology, I16). Fixed to mirror tenant-db-provider.ts Step 5 (provisionerInfoFrom).
    (2) a tenants row can carry db_* coordinates for a DB dropped out-of-band (observed:
        pt-provision-a, leftover from adapter-node tests). Runner is now resilient: per-tenant
        failures are collected (TenantMigrationResult.error), the run CONTINUES, and the CLI exits
        non-zero via `failedTenants` so the operator sees every failure in one pass.
  Added fan-out + orphan-skip test cases (provision a real tenant in the scratch CP; insert an
  orphan row) so the unit layer now witnesses both fixes. Typecheck: scripts/migrate.ts clean
  (0 errors under tsconfig.base); migrate.test.ts only shows the repo-wide @atlas/test
  describe/it "not callable" vitest/globals artifact (identical pattern in round-trip.test.ts) —
  not a code defect. Spec-PR TODOs (always-on.md, LEXICON.md, INDEX.md) NOT touched here. Status → review.
- 2026-05-23: scoped (spec-keeper). Capability README written at
  `specs/domains/runtime/capabilities/out-of-band-migration/README.md` (runtime substrate domain,
  alongside control-plane-schema-registry). Verified context: `runMigrations` (runner.ts:40-91)
  idempotent + reusable; two existing call sites (bootstrap.ts:270, tenant-db-provider.ts:522);
  `make db-migrate` inert echo (Makefile:169-174); INV-CTL-01 (atlasctl.md:108-117) forbids
  atlasctl direct DB access. Status -> scoped, but the (a)-vs-(b) FORK IS UNRESOLVED — escalated to
  user at the Phase-0 checkpoint. Recommendation in spec: (a) standalone runner now (W4-unblocking,
  INV-CTL-01-clean, smallest), (b) admin endpoint as follow-up; note (b) cannot migrate a wiped
  control-plane DB from empty, so (a) is required regardless. Shared-file edits (always-on.md,
  atlasctl.md, LEXICON.md, INDEX.md) deferred as Spec-PR TODOs in the README — not edited here.
