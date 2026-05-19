---
title: Seed N tenants for multi-tenant load testing
status: open
type: test
owner: port-adapter-dev
phase: 0
vision: []
invariants: [I7, I9]
blocks: [load-testing/multi-tenant-scenario]
blocked_by: []
files_in_scope:
  - scripts/seed-tenants.ts
  - adapters/node/src/migrations/seed.ts
acceptance:
  - "pnpm tsx scripts/seed-tenants.ts --count 100 creates 100 tenants with migrated per-tenant DBs"
  - "Idempotent re-run is a no-op (does not throw on existing tenant_id)"
  - "Tear-down script (or doc) exists for removing seeded tenants after a test"
created: 2026-05-12
updated: 2026-05-12
---

## Why

The load-test settler scenarios in `.claude/gambler/bets/` and the k6
scripts in `tests/load/k6/` accept a `--tenants N` / `TENANTS_N` flag but
will only exercise a single tenant until that many rows exist in
`control_plane.tenants` with their per-tenant pools migrated. Multi-tenant
load is what surfaces LRU thrash on `PostgresTenantDbProvider` (default
cap=32) and pool-fanout effects the single-tenant settler can't reproduce.

## Scope

- Add `scripts/seed-tenants.ts` (or extend `adapters/node/src/migrations/seed.ts`) so a developer can spin up N pre-migrated tenants for load testing.
- Tenant ids should be deterministic (e.g. `load-tenant-0`...`load-tenant-N-1`) so the load scripts can address them without a lookup.
- Out of scope: any production-shaped per-tenant routing — dev mode shares the control-plane physical DB at the `tenant_id` column level, which is sufficient.

## Resume prompt

```
Implement scripts/seed-tenants.ts: takes --count N (default 100), inserts
load-tenant-<i> rows into control_plane.tenants with status='active', and
runs the tenant migrations for each. Use the existing
PostgresTenantDbProvider helpers in adapters/node/src/. Make it idempotent:
ON CONFLICT DO NOTHING on the tenant row, runMigrations is already
idempotent. Print one line per tenant created (or skipped). Add a brief
note to tests/load/k6/README.md pointing at the script. Acceptance checks
in the ticket must pass.
```

## Notes / log

- 2026-05-12: created. Filed during the load-testing-harness build that
  followed Bet #1 settlement.
