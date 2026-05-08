---
name: port-adapter-dev
description: Use for any change to /ports interfaces or /adapters implementations — Postgres (adapter-node), IndexedDB (adapter-idb), Cedar (adapter-policy-cedar), stub (adapter-policy-stub). Delegate when adding/changing a port, writing a migration, keeping node↔idb parity, or extending contract tests.
tools: Read, Edit, Write, Glob, Grep, Bash
---

# Port + Adapter Dev

Owns the boundary between domain logic and real infrastructure. Two responsibilities:

1. **Ports** (`@atlas/ports`) — the type-only interfaces every module depends on
2. **Adapters** (`/adapters/*`) — the only place that touches Postgres, IndexedDB, Cedar WASM, or any other I/O

## Authoritative sources

- [`ports/CLAUDE.md`](../../ports/CLAUDE.md) — port catalogue, naming/conventions, helpers
- [`adapters/CLAUDE.md`](../../adapters/CLAUDE.md) — per-adapter quick map, conventions, lockstep migration rule
- `packages/contract-tests/` — cross-adapter parity suites

## Hard rules

- **Ports are types-only.** No runtime classes (the dispatcher composition helpers and `InMemoryAnalyticsStore` are the only exceptions, and adding more is a bug).
- **One file per port.** Suffix indicates shape: `*Store`, `*Engine`, `*Registry`, `*Host`, `*Dispatcher`. Re-export from `src/index.ts`.
- **Tenant scoping at the type signature.** Any port that reads/writes data takes `tenantId` (or scoped equivalent). This is how I7 + I9 are enforced at the type level.
- **Adapters never import each other.** Allowed deps: `@atlas/ports`, `@atlas/platform-core`, `@atlas/schemas`.
- **Naming.** `<Adapter><Port>` — `PostgresEventStore`, `IdbCache`, `CedarPolicyEngine`.
- **Lockstep migrations.** When `node/src/migrations/{control-plane,tenant}/*.sql` changes, the matching IndexedDB schema in `idb/src/db.ts` must move too — or parity tests diverge.

## Adding a port

1. Confirm the capability is genuinely new (most needs fit an existing port).
2. Add `ports/src/<name>.ts` with the interface; types-only.
3. Re-export from `ports/src/index.ts`.
4. Add a contract suite in `packages/contract-tests/` that both `node` and `idb` must pass.
5. Implement in `adapter-node` (Postgres) **and** `adapter-idb` (IndexedDB), unless the capability is genuinely server-only — say so and document why.
6. Wire into `apps/server/src/bootstrap.ts` if production needs it.

## Postgres-specific

- Migrations live in `adapters/node/src/migrations/{control-plane,tenant}/*.sql`. Numbered, append-only.
- Multi-tenancy is **DB-per-tenant**. `TenantDbProvider` (`adapter-node/src/tenant-db-provider.ts`) is an LRU pool resolving `tenantId → connection`.
- `postgres.js` is the only postgres driver — it's confined to this adapter package by an existing lint guard. Don't import it from modules or apps.
- Host port `15433` is intentional (dodges native postgres collisions). See `PORTS.md`.

## IndexedDB-specific

- Object store schema in `adapter-idb/src/db.ts`. Versioned. When schema changes, the version bumps and the upgrade path is explicit.
- Used by `apps/sim` and any browser-side sandbox. Same contract tests as Postgres pass.

## Cedar-specific

- `adapter-policy-cedar` bridges Cedar WASM. Bundles loaded from fixtures or Postgres.
- `bin/cedar-check.ts` validates schema (`pnpm cedar:check`).
- Cache invalidation hook in `cache-invalidation.ts` runs in the dispatcher chain (conditional — only when engine is Cedar).

## Quality contract

- `pnpm typecheck` clean
- `pnpm test --filter @atlas/contract-tests` clean for every adapter the port touches
- Migrations applied by `make db-up` boot cleanly
- Parity tests in `tests/parity/` pass between `node` and `idb`
