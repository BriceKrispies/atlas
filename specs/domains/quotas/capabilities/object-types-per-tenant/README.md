# Capability: object-types-per-tenant (quota dimension)

**Capability:** object-types-per-tenant
**Domain:** quotas
**Platform:** Commerce
**Status:** **Brief — awaiting `commerce-owner` to scope the full capability spec.** Recorded 2026-05-09 as a handoff from `custom-schema/object-definition` so the requirement isn't lost.

## Why this exists

`custom-schema/object-definition` ([`../../../custom-schema/capabilities/object-definition/README.md`](../../../custom-schema/capabilities/object-definition/README.md)) lets a tenant declare object types. Tenants can't be allowed to declare unbounded numbers of them — each one provisions a Postgres table and consumes catalog/projection state. The capability calls `enforceQuota(tenantId, 'object-types-per-tenant')` in its ingress chain (step 3 of its End-to-End Flow). Without a Commerce-side dimension, that call returns "no limit configured" and the quota is effectively infinite.

This brief reserves the dimension name and captures the non-negotiable shape requirement so `commerce-owner`'s eventual full spec stays consistent with how `object-definition` calls it.

## Hard requirement: configurable per-plan with per-tenant override

The dimension MUST resolve to a tenant-specific limit in this precedence order:

1. **Per-tenant override**, if set by an operator (a principal holding the `PlatformSupport` role on a `Membership` in the `_platform` tenant — see `apps/server/src/middleware/role-check.ts:99` `assertPlatformOperator`). Overrides everything else.
2. **Plan default**, looked up from the tenant's current `Plan` (see `commerce/plans`).
3. **No limit configured** — caller treats as unbounded; never fails the request.

Hard-coded global caps are explicitly rejected. Operators (`PlatformSupport`) must be able to grant headroom on a per-tenant basis (paid upgrades, internal accounts, beta partners, support escalations) **without a code deploy**. This is the load-bearing reason the dimension exists at all.

Per-tenant overrides should support:

- **Higher limit than the plan**: paid upgrade, contractual exception
- **Lower limit than the plan**: throttled / suspended account
- **Unlimited / `null`**: internal accounts, support escalations, billing edge cases

Both directions matter; do not bake "override can only raise" into the schema.

## Call-site contract

What `object-definition` and any future custom-schema capabilities expect from Commerce:

```ts
// Pseudocode — exact signature is commerce-owner's call
await enforceQuota(tenantId, 'object-types-per-tenant');
// throws QuotaExceededError({
//   dimension: 'object-types-per-tenant',
//   limit: <resolved limit>,
//   current: <current usage>,
//   plan: <plan id>,
//   overridden: <bool>,
// }) on breach
```

Resolution flow Commerce must implement:

1. Look up the tenant's current `Plan` for `tenantId`.
2. Look up `quota_overrides` row keyed by `(tenantId, 'object-types-per-tenant')`.
3. Pick the override if present, else the plan default.
4. Count current usage: `SELECT count(*) FROM atlas_t_<tenantUuid>._atlas_object_types`. Fan-out style — Commerce already does this for other per-tenant dimensions.
5. If `current >= limit` → throw `QuotaExceededError`. Otherwise return.

The fan-out usage query is fine at expected tenant counts; if Commerce wants to maintain a denormalized counter, that's an internal optimization decision, not a contract concern.

## What `commerce-owner` needs to spec (full capability README)

The proper capability spec at this path replaces this brief with full template content:

- **Purpose** — one paragraph reframing the above
- **Invariants Touched** — at minimum I7 (tenant isolation in usage queries), I9 (cache keying for plan + override resolution)
- **Lexicon** — `QuotaDimension`, `QuotaOverride`, `Plan` (some may already exist; check before adding)
- **Surfaces:**
  - Handler / intent `Quota.Override.Set` (and `.Clear`) — Cedar action `Quota.Override:Set` against resource `Tenant:${tenantId}`. Gated by `PlatformSupport` on `_platform` (mirrors `assertPlatformOperator` precedent at `apps/server/src/middleware/role-check.ts:99`; service-principals/API-keys deliberately excluded). Payload **MUST require** non-empty `reason: string` and `ticketUrl: string` — same operator-action contract as impersonation/break-glass (`ImpersonationSessionDocument` at `modules/identity/src/types.ts:856-862`). An operator quietly raising a tenant's quota with no recorded reason is the same audit failure mode as a quiet impersonation.
  - Domain events: `QuotaOverride.Set`, `QuotaOverride.Cleared` — carry the `reason`/`ticketUrl` through to the event envelope.
  - **Audit events (spine obligation): `Audit.QuotaOverrideSet` and `Audit.QuotaOverrideCleared`** — paired with each domain event. Carry `principalId` (the operator), target `tenantId`, dimension, prior value, new value, `reason`, `ticketUrl`, `correlationId`. **7y retention** per Phase A7 platform policy (`modules/identity/src/types.ts:842`).
  - Projection: per-tenant resolved-limit cache (with plan + override merged).
  - Query: `getQuotaLimit(tenantId, dimension)` — the read backing `enforceQuota`.
  - Routes:
    - Operator-facing `PUT /api/v1/admin/tenants/:tenantId/quotas/object-types-per-tenant` — gated by `assertPlatformOperator`. Returns the override + plan default + resolved limit.
    - Tenant-facing `GET /api/v1/quotas` — returns the tenant's **resolved** limit + current usage. **Does NOT surface `overridden` flag or override value** — those are operator-only on the admin route. Rationale: prevent leaking operator policy (a goodwill raise or a covert throttle) to the tenant.
  - Port: extend `QuotaStore` (or whatever the canonical port is — check `ports/src/`).
- **End-to-End Flow** — operator sets override → event → projection update → cache purge → next `enforceQuota` resolves new value
- **Acceptance:**
  - Plan-default resolution
  - Override-replaces-plan resolution
  - Override-can-be-`null`-meaning-unlimited resolution
  - Cache invalidation on override change (correlationId propagates from the operator's set through to the next tenant request resolving the new value — same trace)
  - `enforceQuota` throws structured `QuotaExceededError` with dimension/limit/current
  - I7: tenant A's overrides invisible to tenant B at every layer
  - Tenant-facing `GET /api/v1/quotas` does NOT include `overridden` field or override value
  - `Quota.Override:Set` rejects when principal lacks `PlatformSupport` on `_platform`
  - `Quota.Override:Set` rejects when `reason` or `ticketUrl` is empty/missing
  - Every `QuotaOverride.Set` / `Cleared` produces a paired `Audit.QuotaOverride*` audit record
- **Cross-references** — link back to `object-definition` (the originating call site)

## What's NOT in scope

- **No break-glass / no quota bypass.** Quota is a hard ingress chokepoint per Invariant **I13**. The override mechanism *is* the operator escape valve; there is no second one. `BreakGlassGrant` (see `modules/identity/src/types.ts`) bypasses *authorization*, not quota. Operators raise the limit (audited, with reason + ticketUrl) before the action; they do not skip the check. If commerce-owner is tempted to add a bypass, push back.
- **No tenant-side override management.** Tenants cannot set or read their own overrides. Only the resolved limit + current usage is visible to them.
- **Forward note (not gating):** Once the resolved-limit + usage projection lands, those values are useful as ABAC attributes on the `Tenant` resource so Cedar policies can express things like `permit Action::"CustomSchema.ObjectType.Define" when tenant.quotas.object-types-per-tenant.remaining > 0` without a separate `enforceQuota` call. `commerce-owner` can scope this in a follow-up; not required for this slice.

## Open questions for `commerce-owner`

1. **Where do plan defaults live?** Plans are presumably modeled in `commerce/plans` (currently a stub — see `specs/CLAUDE.md` domain table). The shape of "plan default for dimension X" needs to slot into wherever plan definitions land.
2. **What's the shape of operator-side override management?** Atlasctl command? Admin UI? Direct DB edit? `commerce-owner` decides; the canonical operator surface today goes through `apps/server` admin routes (see `apps/server/src/routes/admin-signups.ts`, `apps/server/src/routes/identity-a7.ts`) gated by `assertPlatformOperator`. Recommend at least an atlasctl command (`atlasctl tenant quota set <tenantId> object-types-per-tenant <limit|null> --reason "..." --ticket "..."`) for ops ergonomics, wrapping the same admin route.
3. **Usage-counter caching strategy.** Fan-out `count(*)` is fine at low tenant counts. At scale, consider a denormalized `usage_counters` table maintained on each `ObjectType.Defined` event — but that's a Commerce internal implementation choice, not a contract concern.
4. **Soft vs. hard limit.** Spec'd here as hard (throw on breach). Some plans may want soft warnings before hard cutoff. If yes, `enforceQuota` needs a return shape that can carry warnings, not just throw on breach. Decide before committing the call-site signature.

## Cross-references

- Originating call site: [`../../../custom-schema/capabilities/object-definition/README.md`](../../../custom-schema/capabilities/object-definition/README.md) ▸ End-to-End Flow step 3
- Domain home: [`../../README.md`](../../README.md)
- Capability template: [`../../../../_capability-template.md`](../../../../_capability-template.md)
- ADR — Extensibility revival (motivates the cap on tenant-defined types): [`../../../../decisions/0003-tenant-defined-data-model-pivot.md`](../../../../decisions/0003-tenant-defined-data-model-pivot.md)
- Operator-action precedent (reason + ticketUrl + audit): `modules/identity/src/types.ts:856-862` (`ImpersonationSessionDocument`)
- Operator-role gate: `apps/server/src/middleware/role-check.ts:99` (`assertPlatformOperator`)
- Existing operator routes to mirror: `apps/server/src/routes/admin-signups.ts`, `apps/server/src/routes/identity-a7.ts`
