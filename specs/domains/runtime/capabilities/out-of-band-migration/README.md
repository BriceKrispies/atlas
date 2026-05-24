# Capability: Out-of-Band Migration Runner (re-apply schema without a server boot)

**Domain:** runtime (platform runtime substrate)
**Capability:** out-of-band-migration
**Status:** Draft

> **USER DECISION REQUIRED before Phase 1.0.** This spec carries an unresolved
> design fork (see [Design Fork](#design-fork) below): **(a)** a standalone
> out-of-band runner, vs **(b)** an Atlas admin endpoint that asks the running
> kernel to migrate itself. The two options imply different surfaces, different
> file-by-file plans, and different invariant footprints. The recommendation is
> **(a) for now, (b) as the eventual operator surface** — but the choice is the
> user's at the Phase-0 checkpoint. Phase 1.0 (failing scaffolds) cannot start
> until the fork is resolved.

> **Domain placement note.** This lands under the Spine-adjacent **`runtime`**
> domain — the home for platform-runtime-substrate capabilities (the kernel
> registries and lifecycle machinery the recursive kernel of
> [ADR 0008](../../../../decisions/0008-atlas-on-atlas.md) reads as data),
> alongside the existing
> [`control-plane-schema-registry`](../control-plane-schema-registry/README.md)
> capability whose own placement note establishes the convention. Migrations are
> kernel-surface (schema DDL is restart-class in
> [`always-on.md` §2](../../../../crosscut/always-on.md#§2-what-is-restart-required-the-kernel));
> *applying* them out-of-band is a runtime-substrate operation, not tenant
> data and not a Compute service runtime. If a platform owner prefers a
> `crosscut/` home or a different domain, that is a one-line `git mv` — escalate
> to `architect` before implementation if the placement is contested.

## Purpose

The operator wipes the dev/CI database (or restores a captured snapshot) and
needs the Atlas schema — control-plane plus any provisioned tenant DBs —
re-applied to the empty database. Today the only way to run migrations is to
**boot `apps/server`** (`apps/server/src/bootstrap.ts:270`) or to **provision a
tenant** (`adapters/node/src/tenant-db-provider.ts:522`). `make db-migrate` is an
inert echo that tells you to start the server
(`Makefile:169-174`). That makes the wipe→reseed cycle a restart-forcing
operation: you cannot return a freshly-wiped DB to a migrated state without
standing up the full HTTP ingress. This capability gives the operator a way to
(re)apply migrations to an empty DB **without a server boot**, closing one of
three always-on §1 violations in the wipe→reseed cycle and turning
`make db-migrate` from a no-op into the real thing.

## Invariants Touched

- **I20 — Operator Feature Delivery / no-restart operator experience.** This is
  the load-bearing invariant. The wipe→reseed cycle currently *requires* a boot
  to get migrations applied; that boot is the restart this capability removes
  from the operator loop. Re-applying schema to an empty DB becomes an operator
  action that does not depend on cycling `apps/server`. (I20 is the operator-
  experience invariant per root `CLAUDE.md` and `always-on.md` §6 Phase 7.)
- **I17 — API / CLI / UI parity** *(applies to Fork option (b) only).* If the
  out-of-band trigger is exposed as an Atlas admin endpoint (option b), then the
  operator-facing CLI affordance for it (an `atlasctl` command) and any UI
  surface MUST be parity-consistent — the same operation reachable through each
  surface, none of them a privileged bypass. Fork option (a) is a local tool
  with no HTTP surface and therefore does **not** implicate I17.
- **I1 — Single ingress** *(constrains both forks).* Fork option (a) MUST NOT
  expose an HTTP endpoint — it is a CLI/tool that opens a DB connection
  directly, run by the operator out-of-band. Fork option (b) MUST route through
  the existing `apps/server` ingress (no new HTTP boundary), as a gated route on
  the one server, never a second HTTP-exposing process.
- **I2 — Authorization precedes execution** *(Fork option (b) only).* An admin
  migrate route MUST evaluate policy before running migrations; an unauthorized
  caller MUST get no side effect. Option (a) has no principal — it is an
  operator-shell capability, gated by filesystem/DB-credential access, not by
  the policy engine.

No projection/event invariants (I3, I9, I10, I12) are touched — this capability
emits no events and writes no projections; it runs DDL through the existing
idempotent runner.

## Lexicon

No new canonical nouns/verbs are strictly required. One candidate term:

- `out-of-band migration` — applying Atlas schema migrations to a database
  without booting `apps/server`, by invoking the existing `runMigrations` runner
  directly (option a) or via a dedicated kernel route (option b). **Spec-PR
  TODO:** if the term proves load-bearing across specs, add it to
  `specs/LEXICON.md` in the spec PR (NOT the implementation PR). Do not edit
  `LEXICON.md` as part of this Phase-0 deliverable.

## How `runMigrations` Is Reused

The reusable seam already exists and is the heart of both fork options:

`runMigrations(sql, kind)` at `adapters/node/src/migrations/runner.ts:40-91`:

- Takes a `postgres.Sql` connection and a `MigrationKind` (`'control-plane' |
  'tenant'`).
- Is **idempotent** — it tracks applied filenames in `control_plane._migrations`
  (control-plane) or `public._migrations` (tenant) and skips already-applied
  files (`runner.ts:53-89`). Re-running against an already-migrated DB is a
  no-op; running against a freshly-wiped DB applies the full set.
- Creates the bookkeeping schema/table on first run (`runner.ts:49-57`), so it
  works against a truly empty database.
- Is already invoked out-of-band-shaped in two production call sites: server
  boot (`apps/server/src/bootstrap.ts:270`, control-plane) and tenant
  provisioning (`adapters/node/src/tenant-db-provider.ts:522`, tenant). The
  `tools/db-snapshot` tool reads the resulting `_migrations` set
  (`tools/db-snapshot/src/enumerate.ts:146-153`) but does **not** itself run the
  migrations — which is exactly the W4 gap.

Neither fork modifies `runMigrations`. Both call it. The whole capability is
"give `runMigrations` an out-of-band caller and a per-tenant connection
provider."

## Design Fork

**This is the decision the user must make at the Phase-0 checkpoint.** Both
options reuse `runMigrations` unchanged. They differ in *who opens the
connection and how the operator triggers it.*

### Option (a) — Standalone out-of-band runner (RECOMMENDED for now)

A `scripts/migrate.ts` (or a `tools/db-snapshot` subcommand, since the snapshot
tool already opens control-plane and tenant connections) that:

1. Reads `CONTROL_PLANE_DB_URL` from env.
2. Opens a control-plane `postgres.Sql`, calls `runMigrations(sql, 'control-plane')`.
3. Enumerates provisioned tenant DBs from `control_plane.tenants` (the same
   source `tools/db-snapshot/src/enumerate.ts` already uses), opens each tenant
   connection, calls `runMigrations(tenantSql, 'tenant')`.
4. Closes pools; prints the applied-filename set per DB.

**Trade-offs:**

- ✅ Simplest. It is *literally what the restore/snapshot tool already does
  internally* minus the migrate call — same connection-opening machinery, same
  tenant enumeration.
- ✅ **Does NOT violate INV-CTL-01.** It is a `scripts/` or `tools/` process, not
  `atlasctl`. INV-CTL-01 (`specs/crosscut/atlasctl.md:108-117`) forbids
  *`atlasctl`* from touching the DB directly; it says nothing about a
  developer/operator-shell tool. Keep this out of the `atlasctl` package and
  INV-CTL-01 is untouched.
- ✅ No HTTP surface → no I1/I2/I17 footprint. Gated by DB-credential + shell
  access, the same trust boundary `make db-up` / `pnpm seed` already assume.
- ⚠️ Not reachable agentically through the kernel — it is an out-of-process
  operator action. Acceptable for a dev/CI wipe→reseed cycle; not the long-term
  agentic-first operator surface.

### Option (b) — Atlas admin endpoint ("ask the live kernel to migrate itself")

A gated route on the running `apps/server` (e.g. `POST /admin/migrate`) that
triggers in-band migration: the live kernel runs `runMigrations` against its own
control-plane pool (and optionally fans out to tenant pools via
`TenantDbProvider`).

**Trade-offs:**

- ✅ Most aligned with always-on / agentic-first: the operator asks the running
  kernel to migrate itself; no side process touches the DB.
- ✅ Goes through the existing ingress (I1-clean) with policy evaluation (I2).
- ⚠️ **Larger surface.** A new admin route, authz policy, and — to satisfy
  I17 — a corresponding `atlasctl` command. That command would call the HTTP
  route (NOT the DB), so it is INV-CTL-01-clean **by construction** — but
  per `specs/crosscut/atlasctl.md` the command MUST be added to the atlasctl
  spec command table *before* the route lands. (**Spec-PR TODO** — see below.)
- ⚠️ **Does not solve the wipe→reseed cycle on its own.** Option (b) requires a
  *running* server; the W4 cycle's problem is reaching a migrated state on an
  empty DB from a stopped/wiped baseline. A wiped control-plane DB cannot serve
  the admin route until it is itself migrated — a chicken-and-egg the standalone
  runner does not have. So even if (b) is chosen as the operator surface, the
  W4 cycle still needs an (a)-shaped bootstrap path.
- ⚠️ A migrate-from-empty route blurs the kernel/data line: schema DDL is
  restart-class in `always-on.md` §2, so an in-band migrate route is itself a
  kernel-surface operation and would trip a §11 Kernel Touch Retrospective if it
  changes the migration-apply path. Escalate to `architect` if pursued.

### Recommendation

**Choose (a) now.** It directly closes the W4 wipe→reseed always-on §1
violation, is the smallest safe change, reuses the snapshot tool's existing
connection machinery, and is INV-CTL-01-clean. **Note (b) as the eventual
agentic-first operator surface** — file it as a follow-up capability once the
W4 cycle is unblocked. Because (b) cannot migrate a wiped control-plane DB from
empty (chicken-and-egg), (a) is required regardless; (b) is additive, not a
substitute.

## Surfaces

Listed per fork option. Implement only the chosen option's surfaces.

### Option (a) surfaces

- **Tool/script** — `scripts/migrate.ts` (new) **or** a `migrate` subcommand in
  `tools/db-snapshot/`. Opens control-plane + tenant connections, calls
  `runMigrations`.
- **Makefile** — `make db-migrate` (`Makefile:169-174`) stops echoing "start the
  server"; instead invokes the new runner.
- **No** routes, ports, handlers, events, projections, or UI.

### Option (b) surfaces

- **Routes** — `apps/server/src/routes/admin-migrate.ts` (new), a gated
  `POST /admin/migrate`. Delegates to a **named, exported** function (per the
  testability bar) that calls `runMigrations`.
- **atlasctl command** — a `migrate` command in `apps/atlasctl/` that POSTs the
  route over HTTP (INV-CTL-01-clean: HTTP only). Requires the spec command-table
  amendment first (Spec-PR TODO).
- **Makefile** — `make db-migrate` invokes the `atlasctl migrate` command (which
  requires a running server) **plus** an (a)-shaped fallback for the
  migrate-from-empty/wipe case.
- Authz policy for the admin action; correlationId propagation (I5).

## End-to-End Flow

### Option (a)

1. Operator wipes the DB (`make db-reset`, snapshot restore, or CI fresh DB).
2. Operator runs `make db-migrate` (or `pnpm migrate` / the tool subcommand).
3. Runner reads `CONTROL_PLANE_DB_URL`, opens control-plane `Sql`, calls
   `runMigrations(sql, 'control-plane')` → applies all pending control-plane
   `.sql` files, records them in `control_plane._migrations`.
4. Runner enumerates `control_plane.tenants`, and for each provisioned tenant
   opens the tenant connection and calls `runMigrations(tenantSql, 'tenant')`.
5. Runner prints the applied set per DB and exits 0. No server was booted.

### Option (b)

1. A *running* server already exists (control-plane already migrated).
2. Operator runs `atlasctl migrate` → `POST /admin/migrate` with correlationId.
3. `principalMiddleware` resolves the principal; policy is evaluated (I2) before
   any DDL.
4. The named route delegate calls `runMigrations` against the control-plane pool
   (and optionally tenant pools), idempotently.
5. Route returns the applied set; `atlasctl` prints it.
6. For a *wiped* control-plane DB, the operator must first run the (a)-shaped
   bootstrap path — the route cannot serve until the control-plane is migrated.

## What's Stubbed Today

- `runMigrations` at `adapters/node/src/migrations/runner.ts:40-91` — **reuse,
  do not replace.** Idempotent, works against an empty DB, the entire seam.
- `tools/db-snapshot/src/enumerate.ts:146-153` — already enumerates DBs and reads
  the `_migrations` set; option (a) reuses this connection/enumeration machinery
  for the tenant fan-out.
- `make db-migrate` (`Makefile:169-174`) — currently an inert echo; both forks
  repoint it at the real runner.
- `apps/server/src/bootstrap.ts:270` and
  `adapters/node/src/tenant-db-provider.ts:522` — the two existing
  `runMigrations` call sites. They are the proof the runner is out-of-band-safe;
  this capability adds a third (or fourth) caller, it does not change them.

## What's NOT in Scope

- **G1 — the reconnect gap** (server reconnecting to a wiped DB without a
  restart). Separate sibling ticket
  (`drift-always-on-2026-05/db-wipe-reseed-forces-restart` parent).
- **G2 — tenant-pool invalidation** (invalidating `TenantDbProvider`'s LRU pool
  after a wipe). Separate sibling gap.
- **Snapshot capture/restore data movement** — `tools/db-snapshot` already owns
  capture/restore of *rows*; this capability is only about (re)applying
  *schema migrations*, not data restore.
- **New migrations** — this capability runs the existing migration set; it does
  not author schema.
- **Option (b)'s full operator surface** if (a) is chosen — (b) becomes a
  follow-up capability.

## File-by-File Plan

Two plans — implement the chosen fork's plan only.

### Option (a) plan

1. **`scripts/migrate.ts`** (new) — out-of-band entry: read
   `CONTROL_PLANE_DB_URL`, open control-plane `postgres.Sql`, call
   `runMigrations(sql, 'control-plane')`; enumerate `control_plane.tenants`,
   open each tenant connection, call `runMigrations(tenantSql, 'tenant')`; print
   applied sets; close pools. Reuse the connection/enumeration helpers from
   `tools/db-snapshot/src/enumerate.ts`. *Alternative*: add this as a `migrate`
   subcommand under `tools/db-snapshot/` instead of a free-standing script —
   implementer's call, note in PR.
2. **`scripts/migrate.test.ts`** (new) — unit test asserting the runner applies
   pending migrations to an empty (test) control-plane DB and is a no-op on
   re-run (idempotency), and that it fans out to each enumerated tenant. `@spec`
   annotation → this README.
3. **`Makefile`** (`db-migrate` target, lines 169-174) — replace the echo with
   an invocation of the new runner (`pnpm migrate` / `tsx scripts/migrate.ts`),
   keeping the `db-wait` prerequisite.
4. **`package.json`** (root) — add a `migrate` script entry pointing at the
   runner (so `make db-migrate` and `pnpm migrate` agree).

### Option (b) plan

1. **`apps/server/src/routes/admin-migrate.ts`** (new) — gated `POST
   /admin/migrate`; route body parses + validates + delegates to a named
   exported function `applyMigrations(deps)` (testability bar: no inline
   closure).
2. **`apps/server/src/routes/admin-migrate.test.ts`** (new) — unit test calling
   `applyMigrations(...)` with a `Partial<AppState>`, asserting it calls
   `runMigrations` for control-plane (+ tenants) and that policy is checked
   before any DDL (I2). `@spec` → this README.
3. **`apps/server/src/main.ts`** — register the route in the authed group.
4. **Authz policy** — add the admin-migrate action to the policy set + manifest.
5. **`apps/atlasctl/src/commands/migrate.ts`** (new) — `atlasctl migrate` POSTs
   the route over HTTP only (INV-CTL-01-clean).
6. **`Makefile`** (`db-migrate`) — invoke `atlasctl migrate` for the
   running-server case, plus an (a)-shaped bootstrap fallback for migrate-from-
   empty.
7. **Spec-PR TODO (blocking, do first):** add the `migrate` command to the
   `atlasctl` command table in `specs/crosscut/atlasctl.md` *before* the route
   lands. (Not edited in this Phase-0 deliverable — see Spec-PR TODOs.)

## Things That DON'T Change

- **`runMigrations` signature and behavior** (`runner.ts:40-91`) — reused
  verbatim; both forks call it unchanged.
- **The two existing call sites** — `bootstrap.ts:270` and
  `tenant-db-provider.ts:522` keep migrating at boot / provisioning. This adds a
  caller; it does not remove the existing ones.
- **`_migrations` bookkeeping shape** — control-plane in
  `control_plane._migrations`, tenant in `public._migrations`. The snapshot
  tool's `readMigrationSet` (`enumerate.ts:146-153`) keeps reading the same
  tables.
- **INV-CTL-01** — `atlasctl` still never opens a DB connection. Option (a)
  keeps the runner out of `atlasctl`; option (b)'s command is HTTP-only.
- **I1** — no new HTTP boundary in either fork; option (b) mounts on the one
  existing `apps/server` ingress.

## Acceptance

Mechanically-checkable. The fork-independent acceptance is the load-bearing
contract; the per-fork tests follow the chosen option.

- **Out-of-band re-apply (fork-independent, load-bearing)** — a test (option a:
  `scripts/migrate.test.ts`; option b: `admin-migrate.test.ts` + a CI step)
  proves: against a freshly-wiped/empty control-plane DB, the runner applies the
  full migration set and the `control_plane._migrations` set afterward matches
  the bundled `.sql` file set — **with no `apps/server` boot in the test
  process.**
- **Idempotency** — re-running the runner against an already-migrated DB applies
  zero additional migrations (asserts `runMigrations`' no-op contract is
  preserved through the new caller).
- **Tenant fan-out** — with ≥1 provisioned tenant, the runner migrates each
  enumerated tenant DB (`public._migrations` populated per tenant).
- **`make db-migrate` is no longer a no-op** — a check (lint/grep or a Make dry-
  run assertion) confirms the `db-migrate` target invokes the runner rather than
  echoing "start the server". The `Makefile:169-174` echo body is gone.
- **W4 cycle uses it** — the `tools/db-snapshot` W4 wipe→reseed cycle reaches a
  migrated state via this runner without a boot (CI/BDD step exercises the
  cycle).
- **Option (b) only — I2 / I17** — `admin-migrate.test.ts` asserts policy is
  evaluated before any DDL (denied caller → no migration side effect); and the
  `atlasctl migrate` command exists in the spec command table and calls HTTP
  only (no DB import) — checked by `pnpm deps:check` / INV-CTL-01 lint.
- **`@spec` linkage** — every new test carries an `@spec` annotation pointing at
  this README (`pnpm lint:spec-links`).

N/A: Handler test, Dispatch test (I12), Cache-tag assertions, BDD surface-state
— this capability emits no events, writes no projections, and (option a) has no
UI surface.

## Spec-PR TODOs (shared files — NOT edited in this Phase-0 deliverable)

These touch shared specs the Phase-0 ticket scope explicitly forbids editing
here. Land them in the spec PR for the chosen fork:

- **`specs/crosscut/always-on.md`** — record that the wipe→reseed cycle's
  migrate step no longer requires a boot (closes one of the three §1 violations);
  reference this capability.
- **`specs/crosscut/atlasctl.md`** — *(option b only)* add the `migrate` command
  to the command table, before the route lands.
- **`specs/LEXICON.md`** — *(if adopted)* add `out-of-band migration`.
- **`tickets/INDEX.md`** — move this ticket's line as it transitions phases
  (board maintenance, not done here).

## Cross-References

- Ticket: `tickets/drift-always-on-2026-05/out-of-band-migration-runner.md`
- Parent gap: `tickets/drift-always-on-2026-05/db-wipe-reseed-forces-restart.md`
- Runner: `adapters/node/src/migrations/runner.ts:40-91`
- Existing call sites: `apps/server/src/bootstrap.ts:270`,
  `adapters/node/src/tenant-db-provider.ts:522`
- Makefile target: `Makefile:169-174`
- Snapshot tool (connection/enumeration reuse):
  `tools/db-snapshot/src/enumerate.ts:146-153`
- INV-CTL-01: `specs/crosscut/atlasctl.md:108-117`
- Always-on contract: `specs/crosscut/always-on.md` (§1 kernel/data split, §2
  restart-required, §11 Kernel Touch Retrospective)
- Sibling runtime capability + domain-placement convention:
  `specs/domains/runtime/capabilities/control-plane-schema-registry/README.md`
- Architecture: `specs/architecture.md` (I1, I2, I17, I20)
- ADR 0008 (recursive kernel): `specs/decisions/0008-atlas-on-atlas.md`
