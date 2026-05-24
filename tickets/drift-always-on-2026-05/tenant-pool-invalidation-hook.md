---
title: G2 — TenantDbProvider needs a pool invalidation hook for dropped/recreated tenant DBs
status: review
type: drift-finding
owner: port-adapter-dev
phase: 1
capability: specs/domains/runtime/capabilities/tenant-pool-invalidation/README.md
adr: specs/crosscut/always-on.md
vision: [atlas-on-atlas]
invariants: [I20]
blocks: []
blocked_by:
  - drift-always-on-2026-05/db-wipe-reseed-forces-restart
files_in_scope:
  - adapters/node/src/tenant-db-provider.ts
acceptance:
  - "PostgresTenantDbProvider.invalidate(tenantId) and invalidateAll() close + evict cached pool(s); the next getPool re-runs lookupConnectionInfo and reconnects to the (possibly recreated) tenant DB."
  - "Unit/contract test: prime a pool, drop+recreate the tenant DB, invalidate, assert getPool succeeds against the new DB without a process restart."
  - "node↔idb parity addressed (idb has no pool cache → documented no-op); pnpm test green; architect gate pass."
created: 2026-05-23
updated: 2026-05-23
spec_pr_todos:
  - "specs/crosscut/always-on.md §1 narrative update once G1/G2/G3 land (batched with parent closure)"
  - "specs/LEXICON.md optional `pool invalidation` term"
---

## Why

`TenantPoolCache` (`adapters/node/src/tenant-db-provider.ts:244-358`, cap 32) caches per-tenant pools with no invalidation hook. After an operator drops/recreates a tenant DB (the reseed), a live Atlas keeps using the stale cached pool until LRU eviction (32 new tenants) or a restart. The `tools/db-snapshot` restore step will call `invalidateAll()` after reseed so a running Atlas drops stale pools. See parent `drift-always-on-2026-05/db-wipe-reseed-forces-restart`.

## Scope

**In:** `invalidate(tenantId)` + `invalidateAll()` on `PostgresTenantDbProvider` that close + evict cached pools; next `getPool` reconnects via `lookupConnectionInfo`. **Out:** the reconnect-config (G1) and migration-runner (G3) gaps.

## Resume prompt

```
Slice: add PostgresTenantDbProvider.invalidate(tenantId)/invalidateAll() to close+evict
cached pools so a dropped/recreated tenant DB reconnects without an apps/server restart
(always-on §1, I20). File: adapters/node/src/tenant-db-provider.ts:244-358 (TenantPoolCache,
getPool). Phase 0 spec, user checkpoint, failing scaffold (prime pool → drop+recreate DB →
invalidate → getPool succeeds), impl, architect gate. Document idb parity (no pool cache).
```

## Notes / log

- 2026-05-23: filed. Child of db-wipe-reseed-forces-restart.
- 2026-05-23: scoped (Phase 0). Capability README authored at specs/domains/runtime/capabilities/tenant-pool-invalidation/README.md (runtime substrate domain, sibling of control-plane-schema-registry). Determination: adapter-only API addition — `invalidate(tenantId)`/`invalidateAll()` go on the PostgresTenantDbProvider class, NOT on the `TenantDbProvider` interface or `@atlas/ports` (return type is postgres.Sql; per-tenant pool resolution is deliberately not a port — file header :13-17). idb parity = N/A (no pool cache → documented no-op). Invariants: I20 (load-bearing); I1/I2/I3/I7/I9/I10/I12 unaffected or N/A. Awaiting user checkpoint before Phase 1.0. Shared-file amendments (always-on §1 narrative, optional LEXICON term) recorded as spec-PR TODOs, not made in this slice.
- 2026-05-23: implemented (port-adapter-dev, Phase 1) combined with G1 (pool-reconnect-config) since both share `tenant-db-provider.ts`. **Adapter-only, no port change.** `TenantPoolCache` gained `delete(tenantId): Promise<void>` (removes from `pools` map + splices `order`, then `trackClose`s the evicted pool and returns the tracked-close promise so callers can await teardown) and `clear(): Promise<void>` (close-all + reset, provider stays live — distinct from `closeAll`/`close()` tear-down). `PostgresTenantDbProvider` gained public `async invalidate(tenantId)` (awaits `cache.delete` so the post-resolve "previously-cached pool is gone" contract holds; no-op if uncached) and `async invalidateAll()` (awaits `cache.clear`). `TenantDbProvider` interface left untouched (`getPool` only); nothing in `@atlas/ports`. Tests added to `adapters/node/test/tenant-db-provider.test.ts`: two HAS_DB-gated live cases against SCRATCH DBs (`atlas_pool_inval_scratch*`, never an `atlas_t_*` DB) — `invalidate` evicts one tenant + next `getPool` reconnects to the recreated DB (sentinel marker-table gone proves the new DB; `resolveCount` counts re-resolution), and `invalidateAll` empties the cache + both tenants reconnect — plus three no-DB cases (no-op on uncached tenant, no-op on empty cache, re-resolution after invalidate via a counting `resolveConnection` override). RED first, then GREEN. status → review.
- 2026-05-23: independent verification re-run. **GREEN:** no-DB cases 3/3 pass (`node packages/test/bin/atlas-test.mjs adapters/node/test/tenant-db-provider.test.ts`); with the live container (`TEST_TENANT_DB_URL=...control_plane`) the full file is 21/21 including both W2 live cases — `invalidate evicts a single tenant pool; getPool reconnects to the recreated DB` and `invalidateAll closes and evicts every cached pool; getPool reconnects for all`. **RED re-confirmed** by short-circuiting `TenantPoolCache.delete` to skip eviction: the `getPool after invalidate re-runs lookupConnectionInfo (re-resolution)` case failed (stale pool served from cache, `resolveCount` stuck at 1), then restored to GREEN. Regression: full adapter-node suite without DB is 59/59 pass, 0 fail (additive changes broke nothing). Scoped typecheck: `src/tenant-db-provider.ts` + `src/index.ts` zero errors; the only test-file diagnostics are the pre-existing `@atlas/test` shim `TS2349` noise plus four pre-existing `ParsedOptions` casts in the provisioning tests (lines 183/273/865/945/1051, all above the W2 block — not introduced by this slice). Port interface unchanged; I1/I2/I3/I12 unaffected (no pipeline/dispatch file touched). status stays `review`.
