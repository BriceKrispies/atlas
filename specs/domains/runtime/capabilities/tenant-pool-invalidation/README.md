# Capability: Tenant Pool Invalidation Hook (drop a stale per-tenant pool without a restart)

**Domain:** runtime (platform runtime substrate)
**Capability:** tenant-pool-invalidation
**Status:** Draft

> **Domain placement note.** This is *runtime substrate*, not a tenant-facing
> domain: it governs how the platform's per-tenant Postgres connection pools
> behave when the underlying tenant database changes out from under a live
> process. It shares the `runtime` (platform-runtime-substrate) home established
> by the sibling
> [`control-plane-schema-registry`](../control-plane-schema-registry/README.md)
> capability — "the home for platform-runtime-substrate capabilities (the kernel
> registries the recursive kernel of
> [ADR 0008](../../../../decisions/0008-atlas-on-atlas.md) reads as data)." It is
> **not** Extensibility `custom-schema` (tenant entity types; ADR 0005) and
> **not** Compute `runtime` (tenant service runtimes). The pool cache lives in
> `@atlas/adapter-node` (`adapters/node/src/tenant-db-provider.ts`); the spec
> home is `runtime` because the *behavior* being specified — "a data change to a
> tenant DB must not require a code restart" — is the always-on contract
> (`always-on.md` §1), a runtime-substrate concern. If a platform owner prefers a
> different home, that is a one-line `git mv` — escalate to `architect` before
> implementation if contested.

## Purpose

An operator captures the control-plane + per-tenant databases to a golden
snapshot, wipes them, and reseeds from the golden — the `tools/db-snapshot`
capture/seed/verify cycle. After the reseed, a *running* `apps/server` is still
holding a cached `postgres.Sql` pool for each tenant whose database was just
dropped and recreated; every query through that stale pool fails (the
connection points at a database that no longer exists, or a fresh one the pool
never authenticated against). Today the only ways the stale pool clears are LRU
eviction (32 *new distinct tenants* must churn through the cap-32 cache) or a
process restart. This capability gives `PostgresTenantDbProvider` an explicit
invalidation hook so the reseed tooling can tell a live Atlas "drop the pool(s)
you cached; the next request will reconnect" — closing one of the three
always-on §1 violations (G2) without restarting the process (I20).

## Invariants Touched

- **I20 — Operator Feature Delivery Is an Intent / data changes don't restart
  code.** Load-bearing. A tenant DB wipe-and-reseed is a *data* change; today it
  forces a restart of `apps/server` because the cached pool is stale. This
  capability removes that forced restart: after the reseed, the tooling calls
  `invalidateAll()` (or `invalidate(tenantId)` per tenant) and the live process
  reconnects on the next `getPool` — `bootId` unchanged. The mechanically-checked
  witness is the parent's W4 cycle (`bootId` equality across wipe→reseed→verify).
- **I1 / I2 / I3 — UNAFFECTED (must stay so).** Invalidation is an out-of-band
  adapter call on the pool cache; it does not touch the ingress pipeline, the
  authorization-before-execution order, or idempotency. No request path changes;
  the only observable difference is that a `getPool` after `invalidate` re-runs
  `lookupConnectionInfo` instead of returning a cached pool.
- **I7 / I9 — tenant isolation / cache-key scope (preserved, not weakened).**
  `invalidate(tenantId)` evicts exactly one tenant's pool, keyed by `tenantId`;
  it cannot reach across to another tenant's cached pool. `invalidateAll()`
  evicts every tenant's pool. The eviction key matches the cache key
  (`tenantId`) the LRU already uses, so isolation is unchanged.
- **I12 — Projection rebuildability.** N/A — this capability adds no module
  dispatcher, projection, or event. It mutates only an in-process connection-pool
  cache in an adapter. Stated explicitly so a reviewer does not expect an I12
  dispatch test.
- **I10 — event-driven invalidation (analogy, not application).** This is *pool*
  invalidation, not *read-cache* invalidation, so the tag-based-purge contract of
  I10 does not literally apply (no `cacheInvalidationTags`, no `Cache` port). The
  spirit is shared — invalidation is *triggered* (by the reseed tooling), not
  TTL-based — but this is an explicit operator-driven call, not an event-tag
  purge. Called out so the absence of `cacheInvalidationTags` is not read as a
  gap.

## Lexicon

No new canonical nouns/verbs are strictly required for this slice — the methods
read in plain English (`invalidate` / `invalidateAll`). Existing terms this
binds to (cross-ref only, no redefinition):

- `TenantDbProvider` — the port-shaped capability "resolve a tenant id to a
  per-tenant Postgres connection." Interface in
  `adapters/node/src/tenant-db-provider.ts:31-33` (`getPool` only); not in
  `@atlas/ports` (see "Port vs. adapter-API" below).

**Spec-PR TODO (shared file — do NOT edit in this slice):** if the reviewer
wants the operation named in the lexicon, add to `specs/LEXICON.md`:

- `pool invalidation` (verb phrase) — closing and evicting a cached per-tenant
  connection pool so the next `getPool` re-resolves connection info and
  reconnects, used after an operator drops/recreates a tenant database against a
  live process. This README is the only file authored in this slice; the
  `LEXICON.md` amendment is a separate spec-PR line item per the
  spec-keeper lexicon-first rule.

## Port vs. adapter-API determination

**Verdict: adapter-only API addition. Do NOT add the methods to a `@atlas/ports`
interface.**

Reasoning, verified against the source:

1. **`TenantDbProvider` is an *adapter-local* interface, not a `@atlas/ports`
   port.** The interface is declared inline in
   `adapters/node/src/tenant-db-provider.ts:31-33` and exposes a single method,
   `getPool(tenantId): Promise<postgres.Sql>`. Its return type is
   `postgres.Sql` — a Postgres.js type. A `@atlas/ports` interface may not name
   an infrastructure type; this interface is therefore deliberately not in
   `/ports`. The file header (`tenant-db-provider.ts:13-17`) states this
   explicitly: *"Why not in `@atlas/ports`? Per-tenant pool resolution is a
   Postgres-shaped concern… The abstraction would leak."*
2. **Pool invalidation is even more Postgres-shaped than `getPool`.** A pool is a
   Postgres.js concept; "close + evict a cached pool" has no meaning in a port
   abstraction that hides connection management. Putting `invalidate` on a port
   would re-leak exactly the abstraction the header refused to leak.
3. **No cross-adapter contract is needed.** The idb adapter has no pool cache (it
   round-trips through `openAtlasIdb(tenantId)` directly), so there is no shared
   behavior for a port contract suite to enforce across node and idb. The only
   caller is the `tools/db-snapshot` reseed step, which is Postgres-specific.

Therefore `invalidate` / `invalidateAll` are added as **public methods on the
`PostgresTenantDbProvider` class** (alongside the existing public `close()` at
`tenant-db-provider.ts:359-362`), not on the `TenantDbProvider` interface and
not on any `@atlas/ports` file. The existing `TenantDbProvider` interface stays
shape-stable (`getPool` only) — callers that only need resolution are unaffected;
callers that need invalidation depend on the concrete class (as the reseed
tooling already does for `provisionTenantDatabase`).

## Method shapes

Added to `PostgresTenantDbProvider` (public, alongside `close()`):

```ts
/**
 * Close and evict the cached pool for a single tenant. The next
 * `getPool(tenantId)` re-runs `lookupConnectionInfo` and opens a fresh
 * pool against the (possibly recreated) tenant database. No-op if no pool
 * is cached for `tenantId`. Used by the db-snapshot reseed step after a
 * tenant DB is dropped/recreated, so a live process drops the stale pool
 * without a restart (always-on §1, I20).
 */
async invalidate(tenantId: string): Promise<void>;

/**
 * Close and evict every cached per-tenant pool. The next `getPool` for any
 * tenant re-resolves and reconnects. Used by the db-snapshot reseed step
 * after a full wipe-and-reseed (every tenant DB recreated).
 */
async invalidateAll(): Promise<void>;
```

Semantics (both methods):

- **Close, don't just drop.** Evicting without closing leaks the underlying
  sockets. Each evicted pool MUST be `end()`-ed. Reuse the cache's existing
  best-effort close discipline (`trackClose` / `closeAll`,
  `tenant-db-provider.ts:280-302`) so teardown does not race half-closed sockets
  — i.e. close is awaited (or tracked-then-awaited), matching `close()`.
- **Evict the LRU bookkeeping too.** Removing the pool from the `pools` map MUST
  also remove the tenant id from the `order` array, so a stale tenant id cannot
  linger as a phantom LRU entry. (The current `TenantPoolCache` has no
  single-key delete — see the file-by-file plan.)
- **Idempotent / no-op safe.** `invalidate` on a tenant with no cached pool is a
  silent no-op (returns resolved). `invalidateAll()` on an empty cache is a
  no-op. Calling either twice is safe.
- **Concurrency with in-flight opens.** `getPool` dedups concurrent first-time
  opens via the `inFlight` map (`tenant-db-provider.ts:308-339`). `invalidate`
  evicts the *cached* pool; an open already in flight for the same tenant
  resolves into a fresh pool that is then cached. The contract is "after
  `invalidate` returns, no *previously cached* pool for that tenant is reachable
  via `getPool`." A subsequent `getPool` (after `invalidate` resolves)
  re-resolves connection info. We do NOT attempt to cancel an in-flight open —
  that race is out of scope (the reseed tooling quiesces traffic; see "What's NOT
  in Scope").
- **`getPool` after invalidate re-resolves.** This already holds for free: once a
  tenant is evicted from the cache, the next `getPool` misses the cache
  (`tenant-db-provider.ts:329-331`), misses `inFlight`, and calls
  `openPool` → `lookupConnectionInfo` (`tenant-db-provider.ts:341-358,641-677`).
  No change to `getPool` is required beyond the eviction the new methods perform.

## Surfaces

- **Adapters** — `adapters/node/src/tenant-db-provider.ts`:
  - `TenantPoolCache` gains a single-key `delete(tenantId)` (close + remove from
    `pools` and `order`) and `clear()` (close + empty all), reusing the existing
    `trackClose` / `pendingCloses` discipline.
  - `PostgresTenantDbProvider` gains public `invalidate(tenantId)` and
    `invalidateAll()` that delegate to the cache.
- **Ports** — **none.** `TenantDbProvider` interface unchanged (see "Port vs.
  adapter-API determination").
- **Adapters (idb)** — **none.** `@atlas/adapter-idb` has no per-tenant pool
  cache; see "node↔idb parity" below.
- **Handlers / Events / Projections / Queries / Routes / UI / Migrations** —
  **none.** No intent, no event, no projection, no query, no HTTP route, no UI
  surface, no schema change. This is a pure in-process adapter API addition.
- **Caller (out of this slice, named for context)** — the `tools/db-snapshot`
  restore step calls `invalidateAll()` after reseed. That wiring lands in the
  parent ticket's tooling, not here.

## End-to-End Flow

No actor/ingress/handler flow (no intent). The operator-tooling flow:

1. Operator runs the `tools/db-snapshot` restore against a *live* `apps/server`.
2. Tooling restores the golden into the (dropped + recreated) tenant database(s).
3. Tooling calls `PostgresTenantDbProvider.invalidateAll()` (or
   `invalidate(tenantId)` per affected tenant) on the live provider instance.
4. `invalidateAll` closes and evicts every cached pool (LRU bookkeeping cleared).
5. The next request for any tenant calls `getPool(tenantId)` → cache miss →
   `openPool` → `lookupConnectionInfo` reads `control_plane.tenants.db_*` → opens
   a fresh pool against the recreated database → caches it.
6. The request succeeds against the new database. `apps/server` `bootId` is
   unchanged across the whole cycle (the parent's W4 assertion).

## What's Stubbed Today

- **`PostgresTenantDbProvider.close()`** already exists
  (`tenant-db-provider.ts:359-362`) and delegates to `cache.closeAll()`. The new
  `invalidateAll()` is the same close-everything shape but **without** the
  semantic of "the provider is being torn down" — after `invalidateAll()` the
  provider is still live and `getPool` re-resolves. Implementer SHOULD share the
  underlying close discipline; `invalidateAll()` is effectively
  `cache.clear()` (close all + reset maps) and the provider keeps serving.
- **`TenantPoolCache.closeAll()`** (`tenant-db-provider.ts:294-302`) already
  closes every pool and clears `pools`/`order` and awaits `pendingCloses`. This
  is the template for `clear()` — they may be the same method (rename/reuse) or
  `closeAll` delegates to `clear`.
- **`TenantPoolCache.trackClose(pool)`** (`tenant-db-provider.ts:280-286`) is the
  best-effort `end({ timeout: 1 })` + `pendingCloses` tracking discipline; reuse
  it for the single-key `delete`.
- **`TenantPoolCache` has `pools` (Map), `order` (string[]), `pendingCloses`
  (Set)** — the single-key `delete(tenantId)` removes from `pools`, splices from
  `order`, and `trackClose`s the evicted pool, then (for `invalidate`'s await
  contract) the provider awaits the tracked close.
- **`getPool` already re-resolves on a cache miss** — no change needed there; the
  eviction is the entire mechanism.

## What's NOT in Scope

- **G1 — pool reconnect/backoff config** (`pool-reconnect-config` ticket). This
  capability does NOT add reconnect/backoff to the `postgres()` construction
  (`tenant-db-provider.ts:224-242`) or to the control-plane pool. It only adds
  *eviction*. A Postgres container *bounce* (vs. a DB drop/recreate) is G1's
  domain. (After a bounce, `invalidateAll()` would also work to force fresh
  pools, but the self-healing reconnect config is G1's slice.)
- **G3 — out-of-band migration runner** (`out-of-band-migration-runner` ticket).
  Re-applying schema to a wiped DB without a boot is G3. This capability assumes
  the reseed restores a migrated golden; it does not run migrations.
- **Cancelling in-flight `getPool` opens.** If an open is mid-flight for a tenant
  at the instant `invalidate` is called, this slice does not cancel it. The
  reseed tooling is expected to quiesce traffic; the single-process W4 test runs
  serially.
- **Automatic / event-driven invalidation.** No watcher detects a dropped DB and
  auto-evicts. Invalidation is an explicit operator-tooling call. (A future
  capability could wire a control-plane signal — out of scope.)
- **Multi-replica fan-out.** Calling `invalidateAll()` on one process does not
  reach sibling replicas. Single-process is the W4 proof; multi-replica eviction
  fan-out is out of scope (mirrors the schema-registry sibling's single-process
  scoping).
- **Touching the `TenantDbProvider` port shape or `@atlas/ports`.** Adapter-only.

## File-by-File Plan

1. **`adapters/node/src/tenant-db-provider.ts`** — `TenantPoolCache`: add
   `delete(tenantId: string): void` (if cached: `pools.delete`, splice from
   `order`, `trackClose(pool)`) and `clear(): Promise<void>` (close all + reset
   maps + await `pendingCloses` — reuse / rename `closeAll`'s body). Keep
   `closeAll` working for `close()` (it may delegate to `clear`).
2. **`adapters/node/src/tenant-db-provider.ts`** — `PostgresTenantDbProvider`: add
   public `async invalidate(tenantId)` (delegate to `cache.delete` + await the
   tracked close so the contract "after resolve, the old pool is gone" holds) and
   `async invalidateAll()` (delegate to `cache.clear`). Document both with the
   always-on §1 / I20 rationale.
3. **`adapters/node/test/tenant-db-provider.test.ts`** — new tests (Phase 1.0
   scaffolds, authored by `port-adapter-dev`, not in this spec slice):
   - `invalidate evicts a single tenant's cached pool; getPool reconnects` — prime
     a pool, drop+recreate that tenant's DB, `invalidate(tenantId)`, assert the
     next `getPool` succeeds against the new DB and `cache.size()` reflects the
     eviction. `@spec` → this README + always-on §1 + I20.
   - `invalidateAll evicts every cached pool; getPool reconnects for all` —
     prime ≥2 tenants, `invalidateAll()`, assert `cache.size() === 0` and each
     `getPool` reconnects.
   - `invalidate on an uncached tenant is a no-op` — no throw, `size()` unchanged.
   - `getPool after invalidate re-runs lookupConnectionInfo` — assert resolution
     re-runs (e.g. via a counting `resolveConnection` override) so a recreated
     DB's new coordinates are picked up.
   These run under the existing `HAS_DB`-gated harness; the no-op /
   re-resolution cases can run with a `resolveConnection` override even without a
   live DB.

## Things That DON'T Change

- **`TenantDbProvider` interface** (`tenant-db-provider.ts:31-33`) — stays
  `getPool` only. No new interface method.
- **`@atlas/ports`** — no file touched; per-tenant pool resolution stays out of
  ports (file header `:13-17`).
- **`getPool` / `openPool` / `lookupConnectionInfo`** behavior
  (`tenant-db-provider.ts:328-358,641-677`) — unchanged. The cache-miss →
  re-resolve path is the existing mechanism the new methods rely on; they don't
  modify it.
- **`provisionTenantDatabase`** (`tenant-db-provider.ts:431-600`) and its
  in-flight dedup — untouched.
- **LRU cap (32), pool max (5), sanitisation, quoting, error types
  (`TenantDatabaseNotProvisionedError`, `TenantNotFoundError`)** — unchanged.
- **`close()`** (`:359-362`) keeps its "tear the provider down" contract; it is
  not repurposed. `invalidateAll()` is the live-process variant.
- **`@atlas/adapter-idb`** — no change (no pool cache; see parity).

## node↔idb parity

**N/A for idb — documented no-op, not a parity gap.** The idb adapter has no
per-tenant connection-pool cache: it round-trips through `openAtlasIdb(tenantId)`
directly (per the `tenant-db-provider.ts:13-17` header and
[`adapters/CLAUDE.md`](../../../../../adapters/CLAUDE.md) inventory — `idb`
implements EventStore/Cache/etc. and an *in-memory* ControlPlaneRegistry, with
no `TenantDbProvider`/pool-cache). There is nothing to invalidate on idb, and no
shared `@atlas/ports` interface carries these methods, so there is no
contract-suite parity obligation and no `tests/parity/` addition. The lockstep
migration rule (`adapters/CLAUDE.md` "Lockstep migrations") does not apply: this
slice changes no SQL migration and no IDB object store.

## Acceptance

Concrete, named, mechanically-checkable:

- **Single-tenant invalidate + reconnect (node)** —
  `adapters/node/test/tenant-db-provider.test.ts`
  ▸ `invalidate evicts a single tenant's cached pool and getPool reconnects to
  the recreated DB` — prime a pool against a live tenant DB, drop+recreate that
  DB, `await invalidate(tenantId)`, assert the next `getPool` succeeds against the
  new DB (a query that would fail on the stale pool now succeeds) with no process
  restart. `HAS_DB`-gated.
- **invalidateAll evicts everything (node)** —
  `adapters/node/test/tenant-db-provider.test.ts`
  ▸ `invalidateAll closes and evicts every cached pool; cache.size() === 0 and
  each getPool reconnects`.
- **No-op safety** — same file ▸ `invalidate on an uncached tenant id is a silent
  no-op; invalidateAll on an empty cache is a no-op` — runs without a live DB.
- **Re-resolution** — same file ▸ `getPool after invalidate re-runs
  lookupConnectionInfo` — using a counting `resolveConnection` override, assert
  the resolver is consulted again after invalidation (proves a recreated DB's new
  coordinates are picked up).
- **Gates** — `pnpm typecheck` + `pnpm test` green; `architect` Phase 2 gate
  pass.
- **Contract suite — N/A:** these methods are not on a `@atlas/ports` interface
  (adapter-only; see "Port vs. adapter-API determination"), so there is no
  port-contract-suite addition and no node↔idb contract parity.
- **I12 dispatch test — N/A:** no module dispatcher/projection; this is an
  in-process adapter pool-cache mutation.
- **BDD — N/A:** no UI surface and no HTTP route. The behavioral witness is the
  node adapter tests above, and (at the parent level) the `tools/db-snapshot` W4
  cycle proving a stable `bootId` across wipe→reseed→verify.

## Spec-PR TODOs (shared files — NOT edited in this slice)

Per the spec-keeper "don't edit shared files in a capability-scoping slice" rule,
the following amendments are noted here for a follow-up spec-PR and were NOT made
when authoring this README:

- **`specs/LEXICON.md`** — optionally add `pool invalidation` (see "Lexicon").
- **`specs/crosscut/always-on.md` §1** — once G1/G2/G3 land, the §1 narrative
  that "an operator DB wipe-and-reseed cannot be performed against a running
  Atlas" should be updated to reflect that it now can (with the
  `invalidateAll()` + reconnect-config + out-of-band-migration mechanisms). This
  is a §1 amendment owned by the always-on contract, batched with the parent
  ticket's closure — not this slice.
- **`tickets/INDEX.md`** — board move (open → scoped) is the dispatcher's
  hand-maintained edit, not made here.

## Cross-References

- Capability spec (this file):
  `specs/domains/runtime/capabilities/tenant-pool-invalidation/README.md`
- Sibling runtime-substrate capability:
  `specs/domains/runtime/capabilities/control-plane-schema-registry/README.md`
  (domain-placement precedent; also self-heals per request)
- Always-on contract: `specs/crosscut/always-on.md` §1 (kernel/data split — the
  violated clause), §11 (Kernel Touch Retrospective)
- ADR: `specs/decisions/0008-atlas-on-atlas.md` (recursive kernel),
  `specs/decisions/0005-custom-schema-storage-strategy.md` (db-per-tenant; why a
  per-tenant pool exists at all)
- Architecture: `specs/architecture.md` §I20 (data changes don't restart code),
  §I1–I3 (unaffected), §I7/I9 (tenant isolation / cache-key scope)
- Tickets: `tickets/drift-always-on-2026-05/tenant-pool-invalidation-hook.md`
  (this slice, G2),
  `tickets/drift-always-on-2026-05/db-wipe-reseed-forces-restart.md` (parent
  umbrella; W4 cycle),
  `tickets/drift-always-on-2026-05/pool-reconnect-config.md` (G1 — out of scope),
  `tickets/drift-always-on-2026-05/out-of-band-migration-runner.md` (G3 — out of
  scope)
- Existing code:
  `adapters/node/src/tenant-db-provider.ts:13-17` (why-not-in-ports header),
  `:31-33` (`TenantDbProvider` interface),
  `:244-303` (`TenantPoolCache`: `insert`/`get`/`trackClose`/`closeAll`),
  `:304-340` (`PostgresTenantDbProvider`, `getPool`, `inFlight` dedup),
  `:341-358` (`openPool`),
  `:359-362` (`close()`),
  `:641-677` (`lookupConnectionInfo`)
- Adapters inventory: `adapters/CLAUDE.md` (node = pool cache; idb = no pool)
- Tests: `adapters/node/test/tenant-db-provider.test.ts` (existing
  provision/`HAS_DB` harness to extend)
