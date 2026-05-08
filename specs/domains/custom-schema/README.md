# Custom Schema
**Platform:** Extensibility
**Status:** Stub — domain shape committed, content TBD.

## Purpose
Tenant-defined object types, fields, and validation rules — stored as data,
not code. Lets a tenant extend the platform's data model without a deploy.
The "metadata" foundation everything else in Extensibility builds on.

## Capabilities
TBD. List capabilities here as they're scoped. Capabilities are the agent
ownership unit — one capability ≈ one agent.

## Suggested capabilities (not yet scoped)
- `object-definition` — declare object types per tenant
- `field-types` — supported field kinds and per-field constraints
- `indexes` — tenant-controlled index hints
- `schema-migrations` — additive vs. destructive schema changes, version pinning
- `formula-fields` — computed fields driven by the (future) `formulas` domain

## Cross-references
- (no legacy mapping — new domain)
- Related invariants: **I7** (search tenant isolation), **I9** (cache keyed by tenant), **I12** (projections rebuildable from events)
- Open architectural fork: storage strategy (sparse pivot table vs. schema-per-tenant vs. row-level-security). Decide before implementing capabilities here — the choice constrains `quotas`, migrations, and search forever.
