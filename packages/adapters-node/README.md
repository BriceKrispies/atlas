# @atlas/adapters-node

Postgres-backed implementations of the `@atlas/ports` interfaces. These are
the production adapters paired with `apps/server` (Chunk 4). The
browser-side `@atlas/adapters-idb` package implements the same ports for
the local sim — both pass the same `@atlas/contract-tests` factories.

## Adapters

| Port                  | Class                          |
|-----------------------|--------------------------------|
| `EventStore`          | `PostgresEventStore`           |
| `Cache`               | `PostgresCache`                |
| `ProjectionStore`     | `PostgresProjectionStore`      |
| `SearchEngine`        | `PostgresSearchEngine`         |
| `ControlPlaneRegistry`| `PostgresControlPlaneRegistry` |
| `CatalogStateStore`   | `PostgresCatalogStateStore`    |

`PostgresTenantDbProvider` resolves a tenant id to a per-tenant
`postgres.Sql` connection by reading `control_plane.tenants`. It is the
TS port of `crates/adapters/src/postgres_tenant_db.rs` (LRU cache, cap 32,
5 connections per tenant).

## Migrations

`runMigrations(sql, 'control-plane' | 'tenant')` applies pending `.sql`
files from `src/migrations/<kind>/`. The SQL files are copied verbatim
from `crates/control_plane_db/migrations/` and `crates/tenant_db/migrations/`
so the Rust and Node runners stay in lockstep during the parallel period.

The runner tracks applied migrations in a `_migrations` table
(`control_plane._migrations` for control-plane, `public._migrations` for
tenant DBs). Each migration is executed inside a transaction along with
the bookkeeping insert.

**Splitter choice.** The Rust runner naively splits SQL on `;`, which is
broken for dollar-quoted strings and `;` inside comments. We avoid that
trap by passing each `.sql` file to postgres.js as a single multi-statement
query via `sql.unsafe(content)` — postgres.js' simple-query path accepts
multi-statement SQL fine.

## Testing

The contract suite is shared with `@atlas/adapters-idb`. Each port has a
factory in `@atlas/contract-tests/src/<port>.ts` that gets called with the
adapter's constructor. The Node tests run the same suites against
Postgres-backed adapters.

A real Postgres instance must be reachable via `TEST_TENANT_DB_URL`. The
suite **silently skips** when the env var is unset, mirroring the Rust
adapter test pattern in `crates/adapters/src/postgres_search.rs`.

Local provisioning (Podman):

```bash
make db-up
psql -h localhost -p 5433 -U atlas_platform -d postgres \
  -c 'CREATE DATABASE adapters_node_test'
export TEST_TENANT_DB_URL=postgres://atlas_platform:local_dev_password@localhost:5433/adapters_node_test
pnpm --filter @atlas/adapters-node test
```

Or against the running `atlas itest` infrastructure (port 15432 by
default):

```bash
export TEST_TENANT_DB_URL=postgres://atlas_platform:local_dev_password@localhost:15432/adapters_node_test
pnpm exec vitest run packages/adapters-node/
```

`PostgresControlPlaneRegistry` is read-only over bundled JSON manifests
and ajv schemas (Decision 4 in the rewrite plan), so its contract suite
runs unconditionally without a DB.

## Constructor patterns

Each Postgres adapter takes a `postgres.Sql` instance — the per-tenant
database connection. In production, the wiring layer (apps/server) calls
`tenantDbProvider.getPool(tenantId)` to get the right `Sql` and passes it
into per-request adapter instances. Mirrors the IDB pattern where each
adapter takes a per-tenant `IdbDb`.

`ensure*Schema(sql)` helpers create the tables the adapters expect when a
real migration hasn't been applied yet (e.g. for ad-hoc test DBs). In
production, `runMigrations(sql, 'tenant')` is the source of truth.
