# 0005 — `custom-schema` storage strategy: db-per-tenant

**Status:** Accepted, revised 2026-05-20 (supersedes the schema-per-tenant decision of 2026-05-08).
**Depends on:** [`0003-tenant-defined-data-model-pivot.md`](0003-tenant-defined-data-model-pivot.md) (revives `custom-schema` as a load-bearing domain).

> **Revision note (2026-05-20).** The original 2026-05-08 decision committed to **schema-per-tenant** (a per-tenant Postgres schema inside a shared database). On 2026-05-20 the user clarified that the vision-level commitment is **database-per-tenant** — each tenant gets a dedicated Postgres database. The schema-per-tenant choice failed the user's isolation bar: shared `pg_*` catalogs, shared WAL stream, shared locks, and shared connection target are stronger coupling than the multi-tenant fabric was promised to have. This ADR replaces the prior decision wholesale. The Context section keeps the original four-option survey for the record; the Decision and downstream sections are new.

## Context

[ADR 0003](0003-tenant-defined-data-model-pivot.md) revived `custom-schema` (tenant-defined entity types/fields/relationships) as a load-bearing domain — the Salesforce-shaped trunk of [`vision.md`](../vision.md)'s "the dream." Each tenant declares their own object types and stores rows of those types in **their own data plane**. The original [`specs/domains/custom-schema/README.md`](../domains/custom-schema/README.md) note flagged the storage-strategy fork as "open architectural fork… the choice constrains `quotas`, migrations, and search forever."

Four strategies were on the table:

| Option | Tenant isolation | Quota enforcement | Search | Migration story | Connection cost |
|---|---|---|---|---|---|
| **Sparse pivot table** (one shared table keyed by `(tenantId, typeId, fieldId, recordId)`) | Weakest — single missed `WHERE tenantId = ?` is a cross-tenant data leak | Trivial — row count and bytes are per-tenant in one table | Hardest — every query joins the pivot; index design fights you | All migrations are application code; no DDL per tenant | One pool to one DB |
| **Row-level security** (shared tables, RLS policies) | Medium — depends on policy correctness and `SET LOCAL` discipline holding everywhere | Easy — same table, tenant column | Medium | All migrations are application code; RLS policies are operator-managed | One pool to one DB |
| **Schema-per-tenant** (`CREATE SCHEMA atlas_t_<uuid>` inside one shared database) | Strong — Postgres `search_path` + role isolation; aligns with I7 / I9 / I16 | Medium — `pg_namespace_size()` per schema | Medium — per-tenant index in Atlas search layer maps 1:1 | Per-tenant DDL; needs constrained allowlist | One pool to one DB; schemas selected per query |
| **Database-per-tenant** (`CREATE DATABASE atlas_t_<uuid>`; this ADR's pick) | Strongest — different DB = different catalog, different role graph, different connection target; cross-tenant access is impossible at the protocol layer | Medium — `pg_database_size()` per DB; rate / capacity gates per pool | Medium — same per-tenant search index shape | Per-tenant DDL inside the tenant's DB; same allowlist applies | **One pool per tenant** (LRU evicted); pgbouncer for high tenant counts |

Schema-per-tenant was the previous pick because it gave most of the isolation properties at a fraction of the operational cost. The user's revised position is that "most of the isolation properties" is not the bar — the bar is **full Postgres-level isolation** so that:

- A bug in the platform's query layer that drops a `tenant_id` predicate cannot leak data across tenants because the tables physically don't exist in the wrong tenant's DB.
- A runaway tenant query (lock contention, vacuum storm, long-running transaction) cannot starve another tenant on the same Postgres catalog.
- Per-tenant backup, restore, and point-in-time recovery are first-class Postgres operations (`pg_dump`, `pg_restore`, WAL stream per cluster), not application-layer fan-out.
- Per-tenant capacity, IO, and connection limits can be enforced at the role and database level rather than computed at the application layer.
- A tenant suspension or destruction is `ALTER DATABASE … WITH ALLOW_CONNECTIONS = false` followed by `DROP DATABASE`, not an application-level state machine that has to remember to fence every code path.

The cost is real (see Consequences below — connection-pool topology, fleet migrations, ops surface) but is what the multi-tenant fabric was promised to be.

## Decision

**`custom-schema` uses database-per-tenant.** Each tenant gets a dedicated Postgres database named `atlas_t_<tenantUuid>`. The `control_plane.tenants` row for the tenant carries the connection coordinates (`db_host`, `db_port`, `db_name`, `db_user`, `db_password`) that point to that DB. Tenant-defined object types become native tables in that DB. Tenant-defined fields become columns; tenant-defined relationships become foreign keys.

**Why DB-per-tenant won the revision:**

- **Isolation matches the threat model — at the protocol layer, not the query layer.** REQ-ISO-001 (mutual distrust) and I7 / I9 / I16 all assume tenant boundaries are first-class. A database is the strongest boundary Postgres offers without separate clusters: separate catalog, separate role graph, separate WAL writes, separate connection target. A wrong-tenant query fails at `psql` connect time, not somewhere in the middle of the app.
- **Cross-tenant queries are impossible by construction.** Postgres does not let one session attach to two databases. The only way to query across tenants is to fan out at the application layer — which is exactly the constraint the rest of the architecture wants (no implicit cross-tenant reads, ever).
- **Aligns with what the codebase already does.** `adapters/node/src/tenant-db-provider.ts` already resolves per-tenant connections from `control_plane.tenants.db_*` columns. The LRU pool cache, the `parseTenantConnectionUrl` fallback, the `getPool(tenantId)` contract — all of it is shaped for one-pool-per-tenant. Schema-per-tenant would have under-used this; DB-per-tenant uses it as intended.
- **Capacity, backup, restore, and suspend are Postgres-native operations.** `pg_database_size()`, `pg_dump <db>`, `pg_restore`, `ALTER DATABASE ... ALLOW_CONNECTIONS`, `DROP DATABASE` — all per-tenant, all first-class, all already-understood by operators.
- **The "physically split tenants across instances" path is shorter.** With DB-per-tenant on one cluster, moving a hot tenant to its own cluster is `pg_dump | pg_restore`, then update `db_host` on the `control_plane.tenants` row. With schema-per-tenant the same move requires schema renames and connection-string rewrites across the codebase.

Schema-per-tenant fails closed on the same kind of bug that DB-per-tenant fails closed on, so the value question is whether the extra strength is worth the extra ops cost. The user's call is yes — the agentic-first vision specifically depends on tenants being able to author code that the platform runs, and the threat model of mutually-distrusting tenants under open public signup raises the cost of a leak above the cost of running more databases.

## Constraints this imposes

The choice carries forward into capability specs and operator tooling:

1. **DDL allowlist (I16) — same set, scoped to the tenant's DB.** Tenants don't issue raw SQL. They declare object types via Atlas API; the platform translates declarations into a constrained set of DDL: `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX`, `ALTER COLUMN ... TYPE` (with safe-cast rules), `DROP COLUMN`, `DROP TABLE`. **No `DROP DATABASE`, no `CREATE DATABASE`, no `CREATE EXTENSION`, no cross-database references, no triggers.** Provisioning (`CREATE DATABASE`) is a platform-only operation under a privileged role; tenants never see it.
2. **Per-tenant migration history lives inside the tenant's DB.** Each tenant DB has its own `_migrations` ledger (same shape as the control-plane runner, just in the tenant DB). The migration runner is the same code; what changes is which connection it runs against. Schema mutations are events in the tenant's event store; the schema is rebuildable from events (I12 holds).
3. **Two-role topology per tenant DB.** Each tenant DB has (a) a **provisioner role** the platform uses to create and migrate the DB (owned by the platform, has DDL rights), and (b) a **tenant runtime role** with CRUD on the tenant's tables and `USAGE` on the schema. The runtime role does not have `CREATE` rights; all DDL goes through the platform. This is the protocol-level enforcement of I16.
4. **`PostgresTenantDbProvider` is the only connection seam.** No module, no other adapter, and no script ever connects to a tenant DB by hand-rolling a connection string. `getPool(tenantId)` is canonical. The provider's LRU cap becomes a deployment knob (default kept at current value; tuned per-instance based on tenant count).
5. **Provisioning is its own capability** (lands in `tenancy/self-serve-provisioning` per `spine-owner`'s scoping). On signup-approval, the platform: connects as the cluster superuser (or `CREATEDB`-granted role), issues `CREATE DATABASE atlas_t_<uuid>`, creates the tenant runtime role, grants the role on the new DB, applies tenant migrations, populates `control_plane.tenants.db_*`.
6. **Search layer mirrors per-tenant indexes.** `SearchEngine` adapter maintains one index per `(tenantId, objectTypeId)` — unchanged from the prior ADR; the index identity just maps to a tenant's DB, not a tenant's schema.
7. **Backup/restore is per-database.** Operator-side backup tooling dumps `atlas_t_<tenantUuid>` independently via `pg_dump`. Tenant-suspend is `ALTER DATABASE atlas_t_<uuid> WITH ALLOW_CONNECTIONS = false` followed by closing the LRU pool entry; tenant-destroy is `DROP DATABASE`.
8. **Connection-pool budget is a real deployment constraint.** Each tenant under load = one warm pool of connections to its own DB. On a single Postgres instance the practical ceiling is on the order of 1k–5k tenants before `max_connections` exhausts; **pgbouncer (or equivalent) in transaction-pooling mode is mandatory above that.** For Atlas's near-term scale this is a deployment-shape decision the operator owns; the platform code doesn't change.
9. **`tenant_id` columns on platform-owned tables become defense-in-depth, not the isolation boundary.** Today `public.entities` etc. carry `tenant_id`. Post-migration, those tables live inside the tenant's DB (no `tenant_id` column needed — the DB is the tenant) **but the column is retained** so application-layer code that still references it doesn't break and so accidental cross-DB writes (via a misconfigured connection) still fail fast on the constraint.

## Consequences

**Positive:**

- **Strongest isolation Postgres affords short of separate clusters.** No application-layer bug can leak data across tenants because the data isn't reachable from the wrong connection.
- **Per-tenant ops are Postgres-native.** Backup, restore, PITR (with WAL archiving per cluster), capacity reporting, suspend, destroy — all standard operations.
- **`PostgresTenantDbProvider` reaches its full design.** The `db_host`/`db_port`/`db_name`/`db_user`/`db_password` columns become load-bearing on every tenant row, not just the per-cluster-failover cases.
- **Physical-split-by-tenant is `pg_dump | pg_restore` plus a `control_plane.tenants` UPDATE.** Hot tenants move to their own clusters without code change.
- **Compliance posture improves significantly.** Per-tenant data residency, per-tenant backup retention, per-tenant encryption keys (Postgres-level), per-tenant point-in-time-recovery — all become exercises in operator configuration rather than application code.

**Negative:**

- **Connection-pool topology becomes a real concern.** Each tenant under active load = one or more open pools. The LRU evicts cold tenants, but the steady-state count under heavy multi-tenant use is non-trivial. pgbouncer (or equivalent) becomes mandatory above modest scale. Operator runbook needs to include `max_connections` + pgbouncer sizing.
- **Per-tenant Postgres overhead is real.** A brand-new Postgres database on a stock cluster is on the order of 10 MB of `pg_catalog` plus its connection slots. 10k tenants = ~100 GB of just-empty-DB overhead before any tenant writes a row. Operationally fine; budgetarily worth being honest about.
- **Cross-tenant queries (operator analytics, support tools) require fan-out.** A platform-admin "show me all signups across all tenants" query has to iterate `control_plane.tenants`, open each pool, and merge. There is no `SELECT … FROM all_tenants` shortcut. Mitigation: a periodic ETL into the control-plane DB for aggregates the operator needs; per-tenant access stays direct.
- **Fleet-wide schema migrations are fan-outs.** Adding a column to every tenant's `entities` table is N migrations across N databases, sequenced or parallelized at the operator's discretion. The runner already supports this shape (it's how the prior schema-per-tenant choice would have worked too); the migration story doesn't get materially harder, just more parallelized.
- **DDL allowlist is unchanged but the role topology around it is more elaborate.** Two roles per tenant DB (provisioner + runtime) is more provisioning steps than schema-per-tenant required. Same code path, more rows in `pg_roles`.

**Out of scope:**

- **The exact DDL-allowlist grammar** — lands in the first `custom-schema` capability spec (`object-definition`). Unchanged scope from the prior ADR.
- **Cross-tenant data sharing** (a tenant explicitly granting another tenant read access to their DB) — Phase 5+ if at all. Even more out-of-scope than under the prior decision because cross-DB Postgres queries need FDW.
- **Automatic split-by-tenant sharding** when one tenant's DB becomes hot — operator concern, not a Phase 1–4 worry.
- **Internal sub-schemas inside each tenant DB** (e.g., separating platform-owned tables under `_atlas` from tenant-authored tables under `public`) — open question, deferred. Default for the first cut: everything in `public` inside the tenant DB, with the `_atlas_` prefix on platform-owned tables (per the existing `_atlas_object_types` / `_atlas_dsl_*` convention from ADR 0007). The DB itself is the tenant boundary; sub-schemas can be revisited if a clear operational need emerges.
- **Per-tenant Postgres clusters vs. shared cluster** — the platform code is the same either way. Default deployment posture for the reference public instance is one Postgres cluster hosting many databases; per-tenant clusters are an operator-side promotion when a tenant grows.
- **pgbouncer (or equivalent) wiring** — deployment concern; the platform code doesn't care whether `PostgresTenantDbProvider`'s connection lands on Postgres directly or via a pooler.

## Migration

This revision lands as four distinct streams of work. **None of them are in this PR;** this ADR records the decision only.

1. **This ADR (spec-only):** records the revised decision and the new constraints.
2. **`PostgresTenantDbProvider` provisioner extension.** A new method `provisionTenantDatabase(tenantId, name)` that creates the DB, creates the tenant runtime role, grants it, applies tenant migrations. Wired by the `tenancy/self-serve-provisioning` capability (per `spine-owner`'s scoping) at signup-approval time. The existing `getPool` semantics are unchanged.
3. **Existing-data migration (one-shot, per environment).** Today, every existing tenant's rows live in the shared `control_plane` database's `public` schema, scoped by `tenant_id` columns. A one-shot operator script copies each tenant's rows into a freshly-provisioned `atlas_t_<uuid>` DB and updates `control_plane.tenants.db_*` to point at it. Once `control_plane.tenants.db_name` is non-null for every active tenant, the shared-DB fallback in `PostgresTenantDbProvider` is removed and the legacy `public.entities` / `public.events` / etc. tables in `control_plane` are dropped.
4. **Dev infrastructure update.** `pnpm dev:up` (the ADR 0015 seed script) now provisions a separate dev-tenant DB on the same Podman Postgres instance. The script issues `CREATE DATABASE atlas_t_dev_tenant`, creates the tenant runtime role, applies tenant migrations to that DB, and writes the connection coordinates into `control_plane.tenants` for `dev-tenant`. Dev-mode then exercises the real per-tenant-DB connection path, matching production posture without needing a second container in dev.
5. **First `custom-schema` capability spec** (`object-definition`, Phase 3–4) lands the DDL allowlist inside the per-tenant DB context this ADR now commits to. Unchanged from the prior ADR's migration sequencing.
6. **Tenant-suspend / tenant-destroy semantics** in `tenancy` follow on from #2 — `ALTER DATABASE … ALLOW_CONNECTIONS = false` and `DROP DATABASE` respectively. Filed as a follow-up capability under `spine-owner`.

## Cross-references this revision invalidates or strengthens

- **`CLAUDE.md`** already says "multi-tenant, db-per-tenant" in the project header — that statement is now mechanically correct rather than aspirational.
- **`specs/CLAUDE.md`** mentions "schema-per-tenant" by reference to this ADR — needs a one-line update once this lands.
- **[ADR 0007](0007-dsl-substrate-and-authoring-contract.md) §3** says DSL artifacts live in "the tenant's per-tenant Postgres schema" — re-read as "the tenant's DB," same tables, `_atlas_dsl_<kind>` lives in `public` of the tenant DB. No structural change to ADR 0007.
- **[ADR 0008](0008-atlas-on-atlas.md)** (Atlas-on-Atlas — the platform tenant is a tenant of itself) — strengthens cleanly. The `_platform` tenant just gets its own database (`atlas_t__platform`) like every other tenant, which is exactly the recursive shape ADR 0008 promised.
- **[ADR 0014](0014-self-evolving-substrate.md)** Part B (declarative materialization) — unchanged; specs still materialize into "the tenant" — now means "into the tenant's DB."
- **[ADR 0015](0015-dev-mode-contract.md)** §5 (dev-up's seed contract) — Migration step 4 above amends ADR 0015 to provision a real dev-tenant DB rather than relying on the shared-DB fallback.

## What's NOT changing

- The DDL allowlist itself (same six operations, plus `DROP TABLE`).
- The per-tenant migration ledger contract.
- The `EntityStore` / `RelationStore` / `EventStore` port surfaces. Implementations swap underneath; the contract is unchanged.
- I7 (search isolation) / I9 (cache keys include tenantId) / I12 (projection rebuildability) / I16 (DDL scope) — all unchanged.
- The shape of `control_plane.tenants` — the `db_host`/`db_port`/`db_name`/`db_user`/`db_password` columns are already there; this ADR just makes them mandatory rather than optional.
- The `tenant_id` column on platform-owned tables — retained as defense-in-depth.

No code changes in this PR.
