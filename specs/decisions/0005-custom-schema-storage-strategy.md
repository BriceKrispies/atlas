# 0005 — `custom-schema` storage strategy: schema-per-tenant

**Status:** Accepted (2026-05-08)
**Depends on:** [`0003-tenant-defined-data-model-pivot.md`](0003-tenant-defined-data-model-pivot.md) (revives `custom-schema` as a load-bearing domain).

## Context

ADR 0003 revived `custom-schema` (tenant-defined entity types/fields/relationships) as a load-bearing domain — the Salesforce-shaped trunk of [`vision.md`](../vision.md)'s "the dream." Each tenant declares their own object types and stores rows of those types in their per-tenant DB.

The note in [`specs/domains/custom-schema/README.md`](../domains/custom-schema/README.md) flagged the storage-strategy fork as "open architectural fork… decide before implementing capabilities here — the choice constrains `quotas`, migrations, and search forever." The 2026-05-08 multi-agent review confirmed this and framed three options:

| Option | Tenant isolation | Quota enforcement | Search | Migration story |
|---|---|---|---|---|
| **Sparse pivot table** (one shared table keyed by `(tenantId, typeId, fieldId, recordId)`) | Weakest — single missed `WHERE tenantId = ?` is a cross-tenant data leak | Trivial — row count and bytes are per-tenant in one table | Hardest — every query joins the pivot; index design fights you | All migrations are application code; no DDL per tenant |
| **Schema-per-tenant** (Postgres `CREATE SCHEMA atlas_t_<tenantId>` with native tables per object type) | Strongest — Postgres `search_path` + role isolation; aligns with I7 / I9 / I16 | Medium — `pg_namespace_size()` per schema, easy at slow path | Medium — per-tenant index in Atlas search layer maps 1:1 | Per-tenant DDL; needs a constrained allowlist (per I16) |
| **Row-level-security** (shared tables, RLS policies) | Medium — depends on policy correctness and `SET LOCAL` discipline holding everywhere | Easy — same table, tenant column | Medium | All migrations are application code; RLS policies are operator-managed |

## Decision

**`custom-schema` uses schema-per-tenant.** Each tenant gets a dedicated Postgres schema (`atlas_t_<tenantUuid>`) inside their tenant DB. Tenant-defined object types become native tables in that schema. Tenant-defined fields become columns; tenant-defined relationships become foreign keys.

**Why schema-per-tenant won:**

- **Isolation matches the threat model.** REQ-ISO-001 (mutual distrust) and I7 / I9 / I16 all assume tenant boundaries are first-class. Postgres schemas give that natively — a missed WHERE clause cannot leak across tenants because the data is in different namespaces backed by different connection roles.
- **Aligns with existing tenant-DB-per-tenant infrastructure.** `adapters/node/src/tenant-db-provider.ts` already resolves a per-tenant connection. Schema-per-tenant lives on top of that.
- **Quota and migration semantics are clean.** `pg_namespace_size()` and per-schema migrations are well-understood Postgres operations.
- **Lowest blast radius for the bars Storage cares about.** Recommendation came from `storage-owner` and was confirmed by `module-dev` and `port-adapter-dev` independently.

The pivot-table option is cheapest to ship but the isolation story is the worst at exactly the moment (open public signup) it has to be strongest. RLS is a viable middle ground but its safety depends on policy authoring discipline holding forever; schema-per-tenant fails closed instead of failing open.

## Constraints this imposes

The choice carries forward into capability specs:

1. **DDL allowlist (I16).** Tenants don't issue raw SQL. They declare object types via Atlas API; the platform translates declarations into a constrained set of DDL: `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX`, `ALTER COLUMN ... TYPE` (with safe-cast rules), `DROP COLUMN`, `DROP TABLE`. No `DROP DATABASE`, no `CREATE EXTENSION`, no cross-schema references, no triggers (those are Extensibility/`functions`' job).
2. **Per-tenant migration history.** Each tenant's schema has its own migration ledger (separate from the control-plane `_atlas_migrations` table). Schema mutations are events in the tenant's event store; the schema is rebuildable from events (I12 holds).
3. **Connection-role per tenant.** Each tenant's connection uses a Postgres role with `USAGE` on its own schema only. Cross-schema queries fail at the database, not at the application.
4. **Search layer mirrors per-tenant indexes.** `SearchEngine` adapter maintains one index per `(tenantId, objectTypeId)`; ADR 0003's I7 obligation lands cleanly.
5. **Backup/restore is per-schema.** Operator-side backup tooling dumps `atlas_t_<tenantId>` independently. Tenant-suspend can pause writes to a schema without affecting others.

## Consequences

**Positive:**

- Strongest tenant isolation at the data layer; safest bet for open public signup with mutually-distrusting tenants.
- Migration semantics are explicit and bounded — DDL allowlist gives `architect` and `vision-keeper` a clear thing to police.
- Per-tenant search/cache/quota all map 1:1 to per-tenant schema; no special-casing.
- If the operator ever needs to physically split tenants across DB instances, schema-per-tenant promotes naturally to DB-per-tenant (the next isolation tier).

**Negative:**

- More schemas to manage at scale. 10k tenants = 10k Postgres schemas. Postgres handles this fine, but operator tooling (backup, monitoring, replication lag) has to be per-schema-aware.
- Migrations are per-tenant; a fleet-wide schema change (e.g., adding an Atlas-internal column to every tenant table) is a fan-out operation, not a single ALTER.
- DDL allowlist is real spec work — every `custom-schema` capability needs to list which DDL it issues.

**Out of scope:**

- The exact DDL-allowlist grammar — lands in the first `custom-schema` capability spec (`object-definition`).
- Cross-tenant data sharing (a tenant explicitly granting another tenant read access to a schema) — Phase 5+ if at all.
- Automatic schema sharding when one tenant's schema becomes hot — operator concern, not a Phase 1–4 worry.

## Migration

1. **This ADR (spec-only):** records the decision.
2. **First `custom-schema` capability spec** (Phase 3–4) — `object-definition` — lands the DDL allowlist and the per-tenant migration ledger shape.
3. **`port-adapter-dev` work** — `SchemaDefinitionStore` port (declarations) + `EntityStore` adapter (Postgres-schema-per-tenant under the hood, idb mirror for sim).
4. **`adapters/node/src/tenant-db-provider.ts`** gains a `provisionTenantSchema(tenantId)` step at signup; wired by `tenancy/self-serve-provisioning` capability (per `spine-owner`'s scoping).

No code changes in this PR.
