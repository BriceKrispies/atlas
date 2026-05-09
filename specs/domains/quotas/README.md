# Quotas
**Platform:** Extensibility
**Status:** Stub — domain shape committed, content TBD.

## Purpose
Per-tenant resource limits and enforcement — CPU, query rows, storage, request
rate. The "governor limits" that make multi-tenancy safe: one tenant cannot
degrade another's experience or take down the platform.

## Capabilities
- [`object-types-per-tenant`](capabilities/object-types-per-tenant/README.md) — **Brief only.** Reserved as a handoff from `custom-schema/object-definition`. Awaiting `commerce-owner` to scope the full capability spec. Hard requirement: configurable per-plan with per-tenant override.

## Suggested capabilities (not yet scoped)
- `cpu-budget` — execution-time ceilings for `functions` and queries
- `query-budget` — row-count and result-size ceilings for reads
- `storage-budget` — bytes-per-tenant ceilings, integrated with `tenancy`
- `rate-limits` — request-per-window ceilings at ingress
- `quota-reporting` — usage telemetry surfaced to tenants and operators, and fed to `billing`

## Cross-references
- (no legacy mapping — new domain)
- Related invariants: **I1** (rate limits applied at the single ingress chokepoint), **I7** (search scoped by tenant), **I9** (cache keyed by tenant)
- Sibling to `observability` — both observe the platform, but quotas *enforces* while observability *reports*.
- Feeds `billing` (usage-based pricing).
