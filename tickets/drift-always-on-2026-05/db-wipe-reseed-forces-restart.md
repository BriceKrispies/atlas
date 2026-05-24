---
title: Operator DB wipe-and-reseed forces an Atlas restart (always-on §1 violation)
status: open
type: drift-finding
owner: vision-keeper
phase: 0
capability:
adr: specs/crosscut/always-on.md
vision: [atlas-on-atlas]
invariants: [I20]
blocks:
  - drift-always-on-2026-05/pool-reconnect-config
  - drift-always-on-2026-05/tenant-pool-invalidation-hook
  - drift-always-on-2026-05/out-of-band-migration-runner
blocked_by: []
files_in_scope: []
acceptance:
  - "The db-snapshot wipe→reseed→verify cycle runs against a LIVE apps/server with a stable bootId (no process restart) — proven by W4's bootId-equality check."
  - "All three child tickets (G1/G2/G3) land."
created: 2026-05-23
updated: 2026-05-23
---

## Why

`always-on.md` §1: "Atlas is an always-on kernel. The runtime stays up; behaviour changes by editing data, not by restarting code. Restart is the exception." A routine operator task — capture the control-plane + per-tenant DBs to a golden, wipe them, and reseed from the golden — **cannot be performed against a running Atlas today**. Three structural gaps each independently force a process restart:

- **G1** — postgres.js pools (control-plane `apps/server/src/bootstrap.ts:264`; per-tenant `adapters/node/src/tenant-db-provider.ts:224-242`) are constructed with no reconnect/backoff config; a Postgres container bounce breaks them and the live server never self-heals.
- **G2** — `PostgresTenantDbProvider`'s LRU pool cache (`tenant-db-provider.ts:244-358`, cap 32) has no invalidation hook; a dropped/recreated tenant DB leaves a stale cached pool with no eviction short of restart.
- **G3** — migrations run only at boot (`bootstrap.ts:270`) or at provision (`tenant-db-provider.ts:522`); `make db-migrate` is a no-op (`Makefile:169`). No out-of-band runner can (re)apply schema to a wiped DB without a boot.

(Related, not blocking this cycle: **G4** the process-wide `PrincipalCache` `bootstrap.ts:151` has no per-request refresh. The control-plane registry DOES self-heal per request via `apps/server/src/middleware/registry-refresh.ts` — that side is already restart-free.)

Surfaced 2026-05-23 while building the `tools/db-snapshot` capture/seed/verify workflow.

## Scope

Umbrella tracking ticket. The fixes land in the three child tickets (each its own slice). This ticket closes when the W4 cycle proves a stable `bootId` across a full wipe→reseed→verify.

## Resume prompt

```
Track the always-on gap: operator DB wipe-and-reseed must not require an Atlas
restart (always-on.md §1). The fix is the three child tickets (pool-reconnect-config,
tenant-pool-invalidation-hook, out-of-band-migration-runner). Close this when
tools/db-snapshot's W4 cycle runs against a live apps/server with bootId unchanged.
```

## Notes / log

- 2026-05-23: filed from the db-snapshot plan. User chose to FIX all three gaps (not just flag). Children scoped below.
