# Capability: Control-Plane Schema & Action Registry (registry-as-data)

**Domain:** runtime (platform runtime substrate)
**Capability:** control-plane-schema-registry
**Status:** Draft

> **Domain placement note.** Atlas has no pre-existing single-domain home for
> the kernel's own action/schema registry — it is *runtime substrate*, the
> data plane behind the `ControlPlaneRegistry` port catalogued in
> [`specs/crosscut/kernel-vs-data.md` §3](../../../../crosscut/kernel-vs-data.md)
> (I17 "action registry is kernel … registered actions are data populated at
> boot"). It is **not** tenant `custom-schema` (Extensibility owns *tenant*
> entity types; ADR 0005) and **not** Compute `runtime` (tenant service
> runtimes). To satisfy the capability-template requirement (a
> `domains/<domain>/capabilities/<name>/README.md`) without conflating it with
> either, this lands under a new Spine-adjacent **`runtime`** domain — the
> home for platform-runtime-substrate capabilities (the kernel registries
> the recursive kernel of [ADR 0008](../../../../decisions/0008-atlas-on-atlas.md)
> reads as data). If a platform owner prefers a `crosscut/` home or a
> different domain, that is a one-line `git mv` — escalate to `architect`
> before implementation if the placement is contested. The cross-cut framing
> already exists in
> [`crosscut/atlas-runtime.md`](../../../../crosscut/atlas-runtime.md) and
> [`crosscut/kernel-vs-data.md`](../../../../crosscut/kernel-vs-data.md); this
> capability is the concrete slice that moves the registry from compile-time
> static to control-plane data.

## Purpose

The operator (or any agent acting through the control plane) wants to register
a new platform intent schema and its action — for example the `identity.*`
intent schemas that real email+password login needs — as a **data write**, not
a recompile-and-restart. Today registering a schema means regenerating
`packages/schemas/src/generated/`, recompiling `@atlas/schemas`, and restarting
`apps/server` — a kernel touch that violates I20 and trips an
[always-on §11 Kernel Touch Retrospective](../../../../crosscut/always-on.md#§11-kernel-touch-retrospective).
This capability makes the platform schema set and the action catalog
control-plane data: the bundled `@atlas/schemas` set seeds the control plane on
first boot, thereafter the control-plane table is the live source of truth, and
a schema registered at runtime is resolvable on the very next request in the
same process — `bootId` unchanged. Nothing about handler behavior changes; only
the *declaration* path moves from kernel to data. The motivating proof: with
this landed, unblocking password login (the `Identity.Login.Password` handler is
already compiled in at `modules/identity/src/handlers/registry.ts:676`) becomes
a pure control-plane write, zero recompile, zero restart.

## Invariants Touched

- **I20 — Operator Feature Delivery Is an Intent.** This capability is the
  load-bearing one. Registering a new schema/action is the canonical example of
  a tenant-visible change that I20 says MUST arrive as platform-data, not a
  restart. The always-on test proves a schema add + intent validation happen
  within one process lifetime (stable `bootId`). This capability *removes* a
  standing I20 violation (the recompile+restart schema-add path).
- **I19 — Kernel State Machine-Readability** *(reserved id; see
  `architecture.md:391` and `tickets/atlas-on-atlas/stage-4-kernel-observability-invariant.md`).*
  The registry is part of the kernel's introspectable state. This capability
  must keep the registry's contents enumerable/observable through whatever
  surface I19 lands; for this slice the obligation is "do not make the registry
  less observable" — the control-plane table is *more* introspectable than a
  closure-captured ajv. No new I19 surface is authored here.
- **I17 — API/CLI/UI Parity.** The action registry is the source of truth
  `atlasctl kernel verify` reads for parity
  (`kernel-vs-data.md` §7, I17). Moving the registry to data must keep the
  *same* `ActionEntry` set resolvable so parity tooling sees no change in the
  registered-action surface (only its storage moves).
- **I1 / I2 / I3 — UNAFFECTED (must stay so).** The ingress pipeline order
  (authn → tenant → schema → idempotency → authz → dispatch in
  `packages/ingress/src/submit-intent.ts`) is structural kernel
  (`kernel-vs-data.md` §5) and MUST NOT change. This capability only changes
  *where* the schema validator and action entry are looked up (step 3 and step
  5), never *when* or *in what order*. The `UNKNOWN_SCHEMA` / `UNKNOWN_ACTION`
  gates stay byte-for-byte the same observable behavior for an unregistered
  schema/action.
- **I9 / I10 — Cache scope & invalidation.** Any per-process validator cache
  added here is keyed by `(schemaId, schemaVersion)` and is a *compiled-validator*
  cache, NOT a tenant-data cache — platform intent schemas are PUBLIC (not
  tenant-scoped), so the I9 `tenantId`-in-key rule does not apply (this is one
  of the explicit PUBLIC carve-outs). Invalidation on a control-plane row
  change is event/version-driven (mirror `TenantHostCache`'s positive+negative
  pattern), not TTL, consistent with I10's spirit.
- **I12 — Projection rebuildability.** N/A for a new projection — this
  capability adds no module dispatcher/projection. The control-plane registry
  table is *seeded* (idempotent), not *projected from a tenant event stream*;
  it is control-plane configuration data, not a tenant read model. Stated
  explicitly so a reviewer doesn't expect an I12 dispatch test.

## Lexicon

Existing terms this capability binds to (no redefinition needed; cross-ref
only):

- `Action` — `specs/LEXICON.md:136`. Registered capability the system can
  perform (closed set). This capability makes the *registration* of an Action a
  data write rather than a manifest+recompile.
- `HandlerRegistry` / `controlPlaneRegistry` — `specs/LEXICON.md:146`. The
  intent-side dispatch registry. Unchanged in shape; this capability changes the
  *source* the `ControlPlaneRegistry` port reads `ActionEntry` + schema
  validators from (control-plane pool, not bundled manifests).

New terms to ADD to `specs/LEXICON.md` as part of the spec PR (not the
implementation PR):

- `SchemaRegistry` (noun) — the control-plane-backed registry of platform
  intent-schema documents, keyed by `(schemaId, schemaVersion)`. The bundled
  `@atlas/schemas` set is its *seed*, not its live source. Backs
  `ControlPlaneRegistry.getSchemaValidator`. Compiles ajv validators on demand
  and caches them per `(schemaId, schemaVersion)`, invalidating on row change.
- `schema seed` (pipeline term) — the idempotent first-boot population of the
  `SchemaRegistry` and action catalog from the bundled `@atlas/schemas` set.
  Re-running it is a no-op; rows already present are not overwritten by the
  bundle (the table, once seeded, is authoritative).
- `hot schema registration` (verb phrase) — writing a schema/action row to the
  control plane such that it is resolvable by `getSchemaValidator` / `getAction`
  on the next request, same process, stable `bootId`.

## Surfaces

- **Ports** — `ports/src/control-plane-registry.ts`. The `ControlPlaneRegistry`
  interface (`hasAction`/`getAction`/`getSchemaValidator`) is **unchanged in
  shape**. If the methods must become async to read the pool, that is a port
  surface change (a runtime-version event per `kernel-vs-data.md` §5) — **see
  "Open question O1" below; recommended approach keeps the sync surface** by
  reading rows into a process-local map refreshed on a version cursor, so the
  port stays sync and I-pipeline-call-sites don't need to be made async.
- **Adapters** —
  - `adapters/node/src/control-plane-registry.ts` — `PostgresControlPlaneRegistry`
    reads `ActionEntry` + schema docs from the control-plane pool (already held,
    `control-plane-registry.ts:10-12`, currently `void this.controlPlane`),
    compiles ajv per `(schemaId, version)` on demand, caches + invalidates. The
    reserved-pool comment is removed because the pool is now consulted.
  - `adapters/idb/src/control-plane-registry.ts` — `InMemoryControlPlaneRegistry`
    gains the same dynamic-registration semantics so the sim + contract suite
    agree (node↔idb parity).
- **Migrations** — `adapters/node/src/migrations/control-plane/00000005_schema_registry.sql`
  (next ordinal after `00000004_tenancy_signup.sql`). Tables for schema docs +
  action entries (shape below). Matching IDB store bump in `adapters/idb/src/db.ts`.
- **Bundled-seed loader** — `packages/schemas/src/loader.ts`. `cachedAjv` (the
  single permanently-memoized static ajv) is removed; the bundled set becomes
  the *seed corpus* that the control-plane seeder reads on first boot. The
  `getSchemaValidator(schemaId, version)` helper must support compiling a schema
  doc handed to it at runtime (not only the static `SCHEMAS` array), or the
  per-`(schemaId,version)` compile+cache moves into the adapter. The test-only
  `__setSchemaValidatorOverrideForTest` seam is retained.
- **Bootstrap** — `apps/server/src/bootstrap.ts:363` already constructs
  `PostgresControlPlaneRegistry(controlPlaneSql, logger)`; the constructor now
  consults the pool. The first-boot seed runs here (or in the migration seed
  step `adapters/node/src/migrations/seed.ts`) — idempotently.
- **Handlers / Events emitted / Projections / Queries / Routes / UI** — **none
  new.** No new intent handler, no event, no projection, no query, no HTTP
  route, no UI surface. Registration for this slice is a control-plane write
  (migration seed + direct row insert in the always-on test). An operator
  HTTP/atlasctl registration surface is **out of scope** (stage-9 territory) —
  see "What's NOT in Scope".

## End-to-End Flow

This capability has two flows. Neither adds a UI surface.

**A — First-boot seed (idempotent):**

1. `apps/server` boots; migration runner applies
   `00000005_schema_registry.sql` (creates the empty registry tables).
2. The seed step iterates the bundled `@atlas/schemas` set (the former
   `SCHEMAS` array + `moduleManifests()` action entries) and inserts any row not
   already present (`INSERT … ON CONFLICT (schema_id, schema_version) DO
   NOTHING`). On a fresh DB this populates the registry; on a re-boot it is a
   no-op. The bundle is the seed, never overwriting live rows.
3. `PostgresControlPlaneRegistry` is constructed against `controlPlaneSql`; it
   loads the registry rows into a process-local map (and lazily compiles ajv per
   `(schemaId, version)` on first `getSchemaValidator`).

**B — Hot registration (the I20 proof):**

1. An intent arrives whose `schemaId` is unregistered → `submitIntent`
   step 3 (`packages/ingress/src/submit-intent.ts:149-152`) returns
   `400 UNKNOWN_SCHEMA`. (Unchanged behavior.)
2. A control-plane write inserts the schema doc row (and, for a new action, the
   action-entry row) into the registry tables. This is a plain control-plane
   `INSERT` for this slice — same process, no restart, `bootId` unchanged.
3. The registry observes the new row (version cursor bump / explicit
   refresh signal — see O1) and, on the next `getSchemaValidator(schemaId,
   version)`, compiles + caches the ajv validator and returns it.
4. The same intent submitted again passes step 3 (no longer `UNKNOWN_SCHEMA`)
   and proceeds to validation against the freshly-registered schema. For the
   identity case, `Identity.Login.Password` then dispatches to its already-wired
   handler. `bootId` is identical across both submits.

## What's Stubbed Today

- **The `ControlPlaneRegistry` port exists** (`ports/src/control-plane-registry.ts`)
  with `hasAction`/`getAction`/`getSchemaValidator` — extend semantics, not
  shape (preferred). Don't add a new port.
- **The control-plane pool is already passed and held but unused**
  (`adapters/node/src/control-plane-registry.ts:10-12,59-63`, `void
  this.controlPlane`). The header comment explicitly reserves it for "live
  schema lookups, tenant-module enablement." This capability lands that.
- **Bootstrap already wires it** with the pool and logger
  (`apps/server/src/bootstrap.ts:363-366`). No new wiring; the constructor body
  changes.
- **`state.registry` is a single `PostgresControlPlaneRegistry`**
  (`apps/server/src/middleware/state.ts:534`, threaded into `IngressState`). The
  type the ingress sees is unchanged.
- **`actionIdToSchemaId`** convention mapping exists in both adapters
  (`adapters/node/src/action-schema-id.ts` and inline in the idb adapter) —
  reuse it; action rows store the derived `schemaId`/`schemaVersion`.
- **The bundled schema set + manifests exist** in
  `packages/schemas/src/generated/` and `packages/schemas/src/loader.ts`
  (`SCHEMAS`, `moduleManifests()`). These become the *seed corpus*. **No
  `identity.*` intent schemas and no identity manifest exist anywhere** —
  confirmed: `specs/schemas/contracts/` and `packages/schemas/src/generated/`
  carry authz/catalog/content_pages/dsl/repository/seed only. Authoring those
  is the data write this enables, not part of this slice.
- **`__setSchemaValidatorOverrideForTest`** (`loader.ts:125`) — retained;
  tests still need to simulate a missing validator.
- **Always-on test harness exists** at `apps/server/test/always-on/`
  (`f1`–`f4`); the `bootId`-stability assertion pattern is established there.

## What's NOT in Scope

- **Authoring the identity manifest / `identity.*` intent schema documents.**
  That is the data write this capability *enables* — file as a thin follow-up
  (or do it via the new data path once this lands). The motivating CHECKPOINT
  (`CHECKPOINT-password-login-smoke.md`) documents the login failure context.
- **Building `packages/kernel`** (does not exist — stage-6) or the
  `InMemoryModuleRegistry` AJV-on-register path. This capability lands at the
  *existing* `PostgresControlPlaneRegistry` + `InMemoryControlPlaneRegistry`
  seam. See "Blocked-by reconciliation" below.
- **The full stage-8 manifest drift probe** (handler-emitted-tags vs
  manifest-declared-tags, per `(module,action)` synthetic dispatch). That is a
  separate I10 conformance concern that depends on the kernel module registry.
- **An operator HTTP / atlasctl surface for registering schemas.** Registration
  here is a control-plane write. The operator-facing
  `register-schema`/`register-action` surface is stage-9 (operator surface)
  territory. Recommendation: keep registration to a control-plane write for this
  slice; do not add a route.
- **Per-tenant schema overrides / tenant-defined entity schemas.** That is the
  Extensibility `custom-schema` substrate (ADR 0005) — distinct from platform
  intent schemas. This capability touches only the platform (PUBLIC, non-tenant)
  intent-schema set.
- **Migrating the static `moduleManifests()` array away entirely.** Stage-8/9
  follow-up. This slice seeds *from* the bundle; it does not delete the bundle's
  role as the seed source.

## Control-Plane Storage Shape

New migration `adapters/node/src/migrations/control-plane/00000005_schema_registry.sql`.
Two tables (schema docs + action entries), so action registration and schema
registration are independent rows but share the seed step.

```sql
-- Platform intent-schema documents. Keyed by (schema_id, schema_version).
-- The bundled @atlas/schemas set seeds this on first boot; thereafter this
-- table is the live source of truth. PUBLIC (not tenant-scoped) — platform
-- intent schemas apply across all tenants (I9 PUBLIC carve-out).
CREATE TABLE control_plane.intent_schemas (
  schema_id       text        NOT NULL,
  schema_version  integer     NOT NULL,
  document        jsonb       NOT NULL,          -- the JSON Schema doc (ajv-compilable)
  source          text        NOT NULL DEFAULT 'seed', -- 'seed' | 'registered'
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schema_id, schema_version)
);

-- Action catalog entries. Keyed by action_id. resourceType + derived schema
-- ref mirror the ActionEntry port shape. The bundled manifests seed this.
CREATE TABLE control_plane.action_entries (
  action_id       text        NOT NULL PRIMARY KEY,
  resource_type   text        NOT NULL,
  schema_id       text        NOT NULL,
  schema_version  integer     NOT NULL,
  module_id       text,                          -- provenance for dup diagnostics
  source          text        NOT NULL DEFAULT 'seed',
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

Notes:

- **`(schema_id, schema_version)` is the schema key** (matches the port's
  `getSchemaValidator(schemaId, version)` and `ActionEntry.schemaVersion`).
- **`action_id` is the action key** (matches `getAction(actionId)`).
- `document` is the ajv-compilable JSON Schema. The registry compiles it on
  demand; it does not store a compiled validator.
- `source` distinguishes seeded-from-bundle rows from runtime-registered rows
  (diagnostics + a future "reseed would not clobber a registered row" guard).
- A monotonic change signal for cache invalidation: either a
  `control_plane.registry_version` counter table bumped on any write, or a
  trigger-maintained `max(updated_at)` the adapter polls. **Recommended:** a
  single-row `registry_version` integer the writer increments and the adapter
  compares against its loaded snapshot — cheap, no LISTEN/NOTIFY dependency, and
  works identically for the idb mirror (an in-memory counter).
- **IDB mirror** (`adapters/idb/src/db.ts`): two object stores
  `intentSchemas` (keyPath `[schemaId, schemaVersion]`) and `actionEntries`
  (keyPath `actionId`), plus an in-memory version counter. Keep the schema bump
  lockstep with the SQL migration (parity tests diverge otherwise).

### Seed-from-bundle-on-boot (idempotent)

- The seed reads the bundled `@atlas/schemas` set (the former `SCHEMAS` array,
  now exposed as a seed corpus, plus `moduleManifests()` action entries) and
  inserts rows with `source='seed'` via `INSERT … ON CONFLICT … DO NOTHING`.
- Re-running the seed (every boot) is a no-op once rows exist. The bundle is the
  seed, **not** the live source — a row registered at runtime (`source='registered'`)
  is never overwritten by a later boot's seed.
- The seed runs in the same place migrations are seeded
  (`adapters/node/src/migrations/seed.ts`) or in `bootstrap.ts` immediately
  after the registry is constructed — implementer's call, but it MUST be before
  the server accepts requests.

### Hot-registration contract

- Writing an `intent_schemas` row (and, for a new action, an `action_entries`
  row) makes the schema resolvable by `getSchemaValidator` / the action by
  `getAction` on the **next request**, **same process**, **stable `bootId`**.
- The adapter detects the new row via the version cursor (above), refreshes its
  process-local map, and compiles+caches the ajv validator on first lookup of
  `(schemaId, version)`.
- Re-registering an identical `(schemaId, version)` is idempotent (upsert or
  no-op). Registering a *different* document under an existing
  `(schemaId, version)` is a versioning error for this slice — bump
  `schema_version` instead (no in-place mutation of a live schema id+version;
  keeps validators stable for in-flight requests, mirroring the
  request-boundary atomicity rule in `always-on.md` §4.2).

### ajv compile-on-demand + cache invalidation

- The single permanently-memoized `cachedAjv` (`loader.ts:90-107`) is removed.
- Validators compile per `(schemaId, schemaVersion)` on first lookup and cache
  in a process-local map.
- The cache invalidates when the registry version cursor advances past the
  snapshot the map was built against (event/version-driven, not TTL — I10
  spirit). On invalidation the adapter drops stale compiled validators and
  recompiles lazily on next lookup.
- The draft-07 meta-schema registration and `addFormats` setup (`loader.ts:94-101`)
  must be preserved in whatever ajv instance compiles registered schemas (the
  seeder schemas declare draft-07).

## File-by-File Plan

Additive/storage steps first, then the adapter reads, then the proof test.

1. **`adapters/node/src/migrations/control-plane/00000005_schema_registry.sql`**
   — new migration: `intent_schemas` + `action_entries` tables + a
   `registry_version` change-cursor row, per the storage shape above.
2. **`adapters/idb/src/db.ts`** — bump the IDB schema: add `intentSchemas`
   (keyPath `[schemaId, schemaVersion]`) and `actionEntries` (keyPath
   `actionId`) object stores + in-memory version counter. Lockstep with step 1.
3. **`packages/schemas/src/loader.ts`** — remove the permanently-memoized
   `cachedAjv`; expose the bundled set as a seed corpus
   (`bundledSchemaSeed(): ReadonlyArray<{ schemaId, schemaVersion, document }>`
   and `bundledActionSeed()` from `moduleManifests()`); make
   `getSchemaValidator` (or a new `compileValidator(document)`) able to compile
   a runtime-supplied schema doc, caching per `(schemaId, version)`. Keep
   `__setSchemaValidatorOverrideForTest`, draft-07 meta-schema, `addFormats`.
4. **`adapters/node/src/migrations/seed.ts`** (or `bootstrap.ts`) — idempotent
   seed: iterate `bundledSchemaSeed()` + `bundledActionSeed()`, `INSERT … ON
   CONFLICT DO NOTHING` with `source='seed'`.
5. **`adapters/node/src/control-plane-registry.ts`** — `PostgresControlPlaneRegistry`
   now consults the control-plane pool: load `intent_schemas` +
   `action_entries` into a process-local map; `getAction`/`hasAction` read the
   map; `getSchemaValidator` compiles+caches per `(schemaId, version)`; refresh
   the map when the `registry_version` cursor advances. **Remove the
   reserved-pool comment (lines 10-12) and `void this.controlPlane`.**
6. **`adapters/idb/src/control-plane-registry.ts`** — `InMemoryControlPlaneRegistry`
   gains the same dynamic semantics over the new IDB stores + in-memory cursor,
   so node↔idb parity and the contract suite hold.
7. **`ports/src/control-plane-registry.ts`** — only if O1 forces an async
   surface or a new `register*` method. **Preferred outcome: no change** (sync
   surface preserved via the snapshot-refresh approach). If a change is
   unavoidable, treat it as a port-surface event and flag to `architect`.
8. **`packages/contract-tests/src/control-plane-registry.ts`** (new or extended)
   — contract suite asserting dynamic registration: register a schema/action,
   assert it becomes resolvable; assert seed idempotency; runs against **both**
   node and idb factories.
9. **`adapters/node/test/control-plane-registry.test.ts`** &
   **`adapters/idb/test/control-plane-registry.test.ts`** — wire the contract
   suite to each adapter.
10. **`apps/server/test/always-on/f5-schema-registry-no-restart.test.ts`** (new)
    — the I20 proof: submit an intent with an unregistered `schemaId` → assert
    `400 UNKNOWN_SCHEMA`; write the schema row to the control plane; submit
    again → assert NOT `UNKNOWN_SCHEMA`; assert `apps/server` `bootId` identical
    across both submits. Each test carries an `@spec` annotation pointing to
    this README + I20.
11. **`tests/parity/`** — extend the relevant parity test so registry dynamic
    registration agrees across node and idb.
12. **`specs/LEXICON.md`** — add `SchemaRegistry`, `schema seed`, `hot schema
    registration` (spec-PR, not implementation-PR).

## Things That DON'T Change

- **`packages/ingress/src/submit-intent.ts` pipeline order** (authn → tenant →
  schema → idempotency → authz → dispatch). Structural kernel; reordering is a
  security regression (`kernel-vs-data.md` §5). Steps 3 and 5 still call
  `state.registry.getSchemaValidator` / `getAction` at the same point.
- **The `UNKNOWN_SCHEMA` (400) and `UNKNOWN_ACTION` (400) error codes/behavior**
  for an unregistered schema/action (`submit-intent.ts:149-152,187-189`).
  Observable behavior for a not-yet-registered schema is unchanged.
- **The `ControlPlaneRegistry` port method names** (`hasAction`, `getAction`,
  `getSchemaValidator`) — preferred outcome is shape-stable (O1).
- **`apps/server/src/bootstrap.ts:363` wiring** — same constructor call, same
  args (pool + logger). Only the constructor body changes.
- **`apps/server/src/middleware/state.ts:534`** — `state.registry` stays a
  single `ControlPlaneRegistry`; `IngressState.registry` type unchanged.
- **`actionIdToSchemaId` convention** — `Catalog.SeedPackage.Apply` →
  `catalog.seed_package.apply.v1`. Reused as-is.
- **The bundled `@atlas/schemas` generated set** stays the seed source; this
  slice does not delete generated schemas or the manifest array.

## Acceptance

Concrete, named, mechanically-checkable:

- **Migration applies** — `adapters/node/test/migrations` (or the runner test)
  ▸ `00000005_schema_registry creates intent_schemas + action_entries`.
- **Seed idempotency** — `adapters/node/test/control-plane-registry.test.ts`
  ▸ `seeds bundled schemas on first boot; re-seed is a no-op and does not
  overwrite a registered row`.
- **Hot registration (node)** —
  `adapters/node/test/control-plane-registry.test.ts`
  ▸ `getSchemaValidator returns null for an unregistered (schemaId,version);
  after writing the row it returns a compiled validator — no rebuild, no new
  instance`.
- **Contract suite (both adapters)** —
  `packages/contract-tests/src/control-plane-registry.ts` run by both
  `adapters/node/test/...` and `adapters/idb/test/...` ▸ dynamic-registration +
  seed-idempotency cases pass against node AND idb (parity).
- **Loader no longer permanently memoizes** —
  `packages/schemas/test/loader.test.ts`
  ▸ `a schema doc supplied at runtime is compilable/resolvable without
  rebuilding the package` (asserts the `cachedAjv` single-instance behavior is
  gone).
- **I20 no-restart proof** —
  `apps/server/test/always-on/f5-schema-registry-no-restart.test.ts`
  ▸ `schema registration is a platform-data change requiring no restart`:
  unregistered → `400 UNKNOWN_SCHEMA`; write row; re-submit → not
  `UNKNOWN_SCHEMA`; `bootId` identical across both submits.
- **Parity** — `tests/parity/...` ▸ registry dynamic registration agrees across
  node and idb.
- **Gates** — `pnpm typecheck` + `pnpm test` + `pnpm deps:check` green. (No new
  BDD scenario — this capability adds no UI surface and no new HTTP route;
  `pnpm bdd` for password login is exercised by the *follow-up* that authors the
  identity schemas via this data path. **N/A — BDD: this slice ships no
  surface; the always-on F5 test is the behavioral witness.**)
- **I12 dispatch test — N/A:** this capability adds no module
  dispatcher/projection; the registry table is seeded control-plane
  configuration, not a tenant event projection.

## Blocked-By Reconciliation (verdict: UNBLOCK)

The ticket carries `blocked_by: atlas-on-atlas/stage-8-manifests-and-drift-probe`.
After reading stage-8 and the stage chain, **I recommend dropping that
`blocked_by` and landing this capability self-contained.** Reasoning:

1. **Stage-8 depends on `packages/kernel`, which does not exist.** Stage-8's
   `blocked_by` is `atlas-on-atlas/stage-6-kernel-package`; stage-6's is
   stage-5; both are `scoped`, not landed. `packages/kernel` is confirmed absent
   (no files). Stage-8's acceptance is written entirely against
   `packages/kernel/src/module-registry.ts` (`InMemoryModuleRegistry.register()`
   AJV-validating manifests, `buildTestKernel()`, `kernel.modules.register()`).
   Inheriting that `blocked_by` would gate a self-contained schema-validator fix
   behind the entire stage 5→6→7→8 kernel-extraction chain.

2. **Stage-8 is a *module-manifest* concern; this is a *schema-validator +
   action-resolution* concern.** Stage-8 makes per-module manifests AJV-validated
   data and adds the handler/manifest cache-tag **drift probe** (I10
   conformance). It explicitly keeps "manifests stay statically bundled via
   `loader.ts` for v1" and defers "migrating away from the static
   `moduleManifests()` array entirely … a stage-9+ follow-up." This capability
   is exactly the part of that follow-up that is independent of the kernel
   module registry: it moves the **schema documents** and the **action catalog**
   to the control plane at the *existing* `ControlPlaneRegistry` seam. It does
   not need `InMemoryModuleRegistry`, `buildTestKernel`, or the drift probe to
   function.

3. **The seam this lands at already exists and already holds the pool.**
   `PostgresControlPlaneRegistry` is constructed with `controlPlaneSql` at
   `bootstrap.ts:363` and the pool is reserved-but-unused for exactly this
   ("live schema lookups, tenant-module enablement",
   `control-plane-registry.ts:10-12`). The work is to *consume* a pool that is
   already wired — no kernel package required.

4. **Coupling, if any, runs the other way.** When stage-8 eventually lands the
   kernel module registry, it can read manifests *from* this control-plane
   registry instead of the static bundle — i.e. this capability is plausibly a
   *dependency of* stage-8's eventual "migrate the source" step, not the reverse.
   Sequencing this first removes a future stage-8 sub-task.

**Action taken:** the ticket's `blocked_by` is updated to `[]` with a log note;
stage-8 remains independently scoped (its drift-probe + kernel-AJV work is
unaffected). If a platform owner disagrees and wants the kernel module registry
to be the single registration surface before any registry-as-data lands, that is
an `architect` call — flag it at the Phase 2 gate. I do not see a correctness
reason for the block; it reads as an ordering assumption from when stage-8 was
the only ticket in this area.

## Risks / Needs-an-Owner-Eye

- **O1 — sync vs async port surface (needs `spine-owner` / `architect`).** The
  ingress pipeline calls `getSchemaValidator` / `getAction` **synchronously**
  (`submit-intent.ts:149,187`). Reading the control-plane pool is async. The
  recommended resolution keeps the port sync by loading rows into a
  process-local snapshot at boot + refreshing on the version cursor (so lookups
  stay sync, in-memory). If the implementer finds the snapshot approach
  unworkable and must make the port async, that is a **port-surface change** =
  runtime-version event (`kernel-vs-data.md` §5, `always-on.md` §8) and every
  ingress call site becomes async — escalate to `architect` before doing it.
  This is the single highest-risk decision in the slice.
- **Refresh-cursor freshness (needs `spine-owner` eye).** "Resolvable on the
  *next* request" requires the snapshot to refresh promptly after a write.
  Single-process (the always-on test) is trivial. Multi-replica freshness
  (every replica sees the new row) is the harder case and overlaps
  `kernel-vs-data.md` §3.9's "must propagate to every replica" concern — but
  multi-replica is **out of scope for this slice** (single-process I20 proof
  only). State the single-process assumption explicitly in the test.
- **Removing `cachedAjv` could regress validation throughput.** The static ajv
  was compiled once. Per-`(schemaId,version)` lazy compile + cache should be
  equivalent steady-state, but the first request for each schema pays a compile
  cost. Acceptable (mirrors how any registry warms), but worth a note so a
  reviewer doesn't read it as a regression.
- **Identity schemas are still absent after this lands.** This capability
  *enables* the data write but does not perform it. Password login stays broken
  until the follow-up authors + registers the `identity.*` schemas. Make sure
  the follow-up ticket is filed so the motivating goal isn't lost.

## Cross-References

- Capability spec (this file):
  `specs/domains/runtime/capabilities/control-plane-schema-registry/README.md`
- ADR: `specs/decisions/0014-self-evolving-substrate.md` (materialization loop:
  code is the exception, data is the norm),
  `specs/decisions/0008-atlas-on-atlas.md` (recursive kernel)
- Architecture: `specs/architecture.md` §I20 (`:393`), §I19 reserved (`:391`),
  §I17, §I1–I3 (unaffected)
- Kernel/data inventory: `specs/crosscut/kernel-vs-data.md` §3 (data plane), §4
  ("could this be data?" rule), §5 (when kernel IS the answer), §7 (I17/I20)
- Always-on contract: `specs/crosscut/always-on.md` §6 (staged path / Phase 7),
  §11 (Kernel Touch Retrospective)
- Lexicon: `specs/LEXICON.md` ▸ `Action`, `HandlerRegistry` (existing);
  `SchemaRegistry`, `schema seed`, `hot schema registration` (to add)
- Lifecycle: `specs/lifecycle.md` (intent path; this capability changes step 3
  + step 5 lookups, not the order)
- Related tickets: `tickets/atlas-on-atlas/control-plane-schema-registry.md`
  (this slice), `tickets/atlas-on-atlas/stage-8-manifests-and-drift-probe.md`
  (module-manifest data + drift probe; independent),
  `tickets/chore/sync-schemas-coverage-decision.md` (schema duplicate
  single-source decision)
- Existing code:
  `packages/schemas/src/loader.ts` (`SCHEMAS`, `cachedAjv`, `getSchemaValidator`,
  `moduleManifests`),
  `adapters/node/src/control-plane-registry.ts` (reserved pool `:10-12`),
  `adapters/idb/src/control-plane-registry.ts`,
  `ports/src/control-plane-registry.ts`,
  `packages/ingress/src/submit-intent.ts:149-152,185-190`,
  `apps/server/src/bootstrap.ts:363`,
  `apps/server/src/middleware/state.ts:534`,
  `modules/identity/src/handlers/registry.ts:676` (`Identity.Login.Password`
  handler already wired)
- Motivating context: `CHECKPOINT-password-login-smoke.md` (repo root)
