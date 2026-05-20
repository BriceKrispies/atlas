# Custom Schema
**Platform:** Extensibility
**Status:** Active stub — domain shape committed, capability specs land Phase 3–4 of the [vision roadmap](../../vision.md). Revived under Extensibility per [ADR 0003](../../decisions/0003-tenant-defined-data-model-pivot.md) (briefly retired by [ADR 0002](../../decisions/0002-developer-platform-domain-map.md), un-retired same day).

## Purpose
Tenant-defined object types, fields, and validation rules — stored as data,
not code. Lets a tenant extend the platform's data model without a deploy.
The "metadata" foundation everything else in Extensibility builds on; the
**Salesforce-shaped trunk** of [`vision.md`](../../vision.md)'s "the dream" —
each tenant defines their own data model in their own Postgres database, and
Atlas hosts / queries / audits / surfaces UI over it.

## Capabilities
- [`object-definition`](capabilities/object-definition/README.md) — declare object types per tenant. **Designed (no implementation yet)**; first capability under this domain. Lands the DDL allowlist grammar that ADR 0005 deferred.

## Suggested capabilities (not yet scoped)
- `field-types` — supported field kinds and per-field constraints
- `indexes` — tenant-controlled index hints
- `schema-migrations` — additive vs. destructive schema changes, version pinning
- `formula-fields` — computed fields driven by the (future) `formulas` domain

## Cross-references
- (no legacy mapping — new domain)
- Related invariants: **I7** (search tenant isolation), **I9** (cache keyed by tenant), **I12** (projections rebuildable from events), **I16** (DDL containment)
- Storage strategy: **database-per-tenant**, settled by [ADR 0005](../../decisions/0005-custom-schema-storage-strategy.md) (revised 2026-05-20, supersedes the prior schema-per-tenant choice). Each tenant gets a dedicated Postgres database `atlas_t_<tenantUuid>`; tenant-defined object types become native tables in `public` inside that database, alongside platform-owned tables carrying the `_atlas_` prefix. Tenant isolation is enforced at the Postgres protocol layer — separate database, separate catalog, separate WAL, separate connection target.
