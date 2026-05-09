# Capability: Quota Handoff

**Domain:** tenancy
**Capability:** quota-handoff
**Status:** **Designed (no implementation yet).** Co-owned with `commerce-owner`. Lands the seam every other Phase 1 capability depends on.

## Purpose

Tenancy is the boundary at which quotas attach to a tenant; Commerce is the system that holds the budgets. This capability defines the **handoff** between them so every other capability — `compute/runtime/deploy`, `code/repository/upload-tarball`, `tenancy/public-signup`, future `extensibility/functions` invocations — can call a single `quotaService.check()` between authz and idempotency and trust that an over-budget tenant gets rejected with `QUOTA_EXCEEDED` before any side effect fires.

The handoff has three pieces:

1. **A platform-level event** — `Tenancy.TenantProvisioned` — emitted whenever a new tenant exists, carrying the `defaultQuotas` it was created with. Commerce's future quota-ledger projection subscribes to this event and materialises the per-tenant budget rows.
2. **A platform-level port** — `QuotaService` — the read/atomic-decrement seam every mutating handler calls. Following the `PolicyEngine` precedent: a single `check(request)` method, request-and-decision shapes, no implementation logic in the interface.
3. **A fail-closed contract** — when `QuotaService` is unreachable, tenancy and every consumer **refuse the intent** rather than letting an unmetered tenant proceed. There is no "best effort" mode: open public signup means the alternative to enforcement is unbounded liability.

This slice scopes the **tenancy half** of that handoff — the event, the port, the fail-closed rule, and a stub adapter (`QuotaServiceStub`, always-allow) so handlers can wire the call site immediately. The Commerce-side ledger projection (`commerce/quotas/quota-ledger`) is a separate slice owned by `commerce-owner`.

## Invariants Touched

- **I13** *(primary, [ADR 0004](../../../../decisions/0004-platform-invariants-for-multi-tenant-fabric.md))* — this capability **is** the seam I13 names. Every mutating handler calls `quotaService.check(tenantId, dimension, delta)` between `authorize` and `checkIdempotency` per PIPE-CMD-001 (v2). Over-budget short-circuits with `QUOTA_EXCEEDED`; no domain events emitted; `Audit.QuotaDenied` is the audit record.
- **I1** — `QuotaService` is consumed inside the request lifecycle via `apps/server`; not exposed as an HTTP endpoint. Single ingress holds.
- **I2** — `quotaService.check()` runs **after** `authorize`. An unauthenticated or unauthorized request is rejected before quota is consulted, so denied requests never decrement budgets.
- **I3** — quota decrement is idempotent on the standard envelope `idempotencyKey`. Replaying the same intent does not double-decrement; the implementation slice will document the exact mechanism (likely a per-tenant `(idempotencyKey, dimension, delta)` ledger entry).
- **I5** — `QuotaCheckRequest` carries `correlationId`. Quota service decisions appear in the same trace as the originating intent.
- **I7** — `tenantId` is required on every `QuotaCheckRequest`; the port's tenant scoping is at the type level. Cross-tenant budget access is impossible by signature.
- **I9** — the future Commerce-side quota cache (when added) will key on `tenantId`; this capability declares the contract upstream.
- **I10** — `Tenancy.TenantProvisioned` carries `cacheInvalidationTags: ['Tenant:${tenantId}']`. Future tenant-scoped query caches purge correctly when a new tenant lands.
- **I12** — the per-tenant budget projection (Commerce slice) is rebuildable from `Tenancy.TenantProvisioned` plus the metering event stream. This capability emits the foundational event; rebuildability is Commerce's obligation.

## Lexicon

Adds four entries to [`specs/LEXICON.md`](../../../../LEXICON.md) under the v2 "Multi-Tenant Fabric Nouns" section, alongside the existing `Quota` entry:

- **QuotaService** — port consulted between `authorize` and `enforceQuota` / `checkIdempotency` per Invariant I13. Single-method (`check`) seam returning a permit/deny decision and remaining budget.
- **QuotaCheckRequest** — request shape: `{ tenantId, dimension, delta, correlationId }`.
- **QuotaCheckResult** — decision shape: `{ allowed, remainingBudget?, reason? }`. `reason` is `'QUOTA_EXCEEDED'` (over-budget) or `'QUOTA_SERVICE_UNAVAILABLE'` (fail-closed) when `allowed: false`.
- **defaultQuotas** — payload field on `Tenancy.TenantProvisioned`. Map from `QuotaDimension` to `{ budget, windowSeconds? }`. Operator-tunable via the future `commerce/plans` capability; this capability ships free-tier defaults for the five MVP-blocking dimensions.

## Surfaces

What this capability adds, by surface:

- **Handlers** — **CHANGED** `modules/tenancy/src/handlers/signup-approve.ts`. After the existing `Tenancy.SignupApproved` envelope is appended, build and append a second envelope for `Tenancy.TenantProvisioned` with `defaultQuotas` payload. `causationId` points to the `SignupApproved` event ID. Future self-serve provisioning (the `tenancy/self-serve-provisioning` capability) emits the same event from a different upstream cause.
- **Events emitted** — **NEW** `Tenancy.TenantProvisioned`. Real `EventEnvelope`. `cacheInvalidationTags: ['Tenant:${tenantId}']`. Idempotency key `tenancy.tenant.provisioned.${tenantId}` (provisioning is a one-time fact per tenant). Payload: `{ tenantId, hostname, organizationName, defaultQuotas: Record<QuotaDimension, { budget, windowSeconds? }> }`. Coexists with `Tenancy.SignupApproved` — distinct semantics:
  - `Tenancy.SignupApproved` = "an admin said yes" (audit of the human action; only fires on admin-approved path).
  - `Tenancy.TenantProvisioned` = "a tenant now exists with these defaults" (system fact; fires on every provisioning path including future self-serve).
- **Projections** — none in this slice. The Commerce-side `QuotaLedger` projection consumes `Tenancy.TenantProvisioned` but lives in `commerce/quotas/quota-ledger` (separate slice).
- **Queries** — none in this slice.
- **Ports** — **NEW** `ports/src/quota-service.ts`. Mirrors `policy-engine.ts` shape:
  ```ts
  export type QuotaDimension =
    | 'signups-per-window'
    | 'cpu-seconds'
    | 'storage-bytes'
    | 'function-invocations'
    | 'egress-bytes';
  // Per-domain dimensions extend this in their own capability specs.

  export interface QuotaCheckRequest {
    tenantId: string;
    dimension: QuotaDimension;
    delta: number;
    correlationId: string;
  }

  export interface QuotaCheckResult {
    allowed: boolean;
    remainingBudget?: number;
    reason?: 'QUOTA_EXCEEDED' | 'QUOTA_SERVICE_UNAVAILABLE';
  }

  export interface QuotaService {
    check(request: QuotaCheckRequest): Promise<QuotaCheckResult>;
  }
  ```
  Atomic decrement-or-reject: when `allowed: true` returns, the budget is already consumed (single round trip, no check-then-consume race). Compensating refunds when a handler fails after decrement are out of scope for this slice (documented limitation under "What's NOT in Scope").
- **Adapters** — **NEW** `QuotaServiceStub` co-located with the existing `@atlas/adapter-policy-stub` package (or a sibling `@atlas/adapter-quota-stub` — package naming is a one-flag decision in the implementation slice). Always-allow:
  ```ts
  export class QuotaServiceStub implements QuotaService {
    async check(_req: QuotaCheckRequest): Promise<QuotaCheckResult> {
      return { allowed: true, remainingBudget: Number.MAX_SAFE_INTEGER };
    }
  }
  ```
  This is the dev/sim default. The real Postgres adapter (atomic decrement against the Commerce `QuotaLedger` table) is the Commerce slice's deliverable.
- **Routes** — none new. `QuotaService` is consumed by handlers, not exposed as HTTP. (The future tenant-facing `GET /api/v1/quotas/usage` for tenants to see their own usage is its own capability — out of scope.)
- **UI surfaces** — none in this slice.
- **Migrations** — none in this slice. The `QuotaLedger` table is owned by Commerce and lands with `commerce/quotas/quota-ledger`.

## End-to-End Flow

Two flows. The first is one-shot per tenant; the second runs on every mutating intent.

### Flow A — Tenant provisioning (one-shot)

1. `handleSignupApprove` (or, post-self-serve-provisioning, `handleSelfServeProvision`) finishes its existing work — tenant row, custom domain, tenant DB, invite, mail send, `Tenancy.SignupApproved` (admin-approved path only).
2. **NEW:** the handler builds a `Tenancy.TenantProvisioned` envelope:
   - `eventType: 'Tenancy.TenantProvisioned'`
   - `tenantId`, `correlationId`, `principalId` from the calling principal
   - `idempotencyKey: 'tenancy.tenant.provisioned.${tenantId}'`
   - `causationId`: the `SignupApproved` event ID (admin-approved path) or the `PublicSignup.EmailVerified` event ID (self-serve path)
   - `payload.defaultQuotas`: free-tier defaults for the five MVP dimensions (see "Default quota values" below)
   - `cacheInvalidationTags: ['Tenant:${tenantId}']`
3. The handler calls `deps.appendEvent(envelope)`. The lazy `appendEvent` callback in `apps/server/src/routes/admin-signups.ts` already constructs a per-tenant `EventStore` after `ensureTenantProvisioned` runs; no changes needed to the wiring shape.
4. The new event flows through the existing dispatcher chain (`apps/server/src/middleware/state.ts` and `apps/projection-worker/src/tenant-loop.ts`). When the Commerce-side `quotaLedgerDispatcher` lands, it joins this chain and projects `Tenancy.TenantProvisioned` into the per-tenant `QuotaLedger`. Until then, the event is appended and observable but no projection consumes it — that's the expected interim state.

### Flow B — Per-intent quota check

1. Visitor / agent / CLI submits an intent (e.g. `Repository.Upload`, `Compute.Deploy.Submit`, `PublicSignup.Submit`).
2. `apps/server`'s ingress chain runs `validate` → `authenticate` → `authorize` per PIPE-CMD-001.
3. **After** `authorize` and **before** `checkIdempotency`, the ingress middleware (or the handler, depending on where the wiring lands per `module-dev`'s implementation decision) calls `quotaService.check({ tenantId, dimension, delta, correlationId })`.
4. **If `allowed: true`:** the budget is already decremented atomically; the pipeline continues to `checkIdempotency` → `dispatchAction` → `handleCommand` → `emitEvent(s)`.
5. **If `allowed: false` with reason `QUOTA_EXCEEDED`:** the request short-circuits with HTTP 429 (or the per-domain equivalent). No domain events are emitted. `Audit.QuotaDenied` is appended with `tenantId`, `dimension`, `correlationId`, attempted delta. (Audit-event scoping is the `audit` domain's concern; this capability declares the obligation, not the schema.)
6. **If `allowed: false` with reason `QUOTA_SERVICE_UNAVAILABLE`:** fail-closed. The request short-circuits with HTTP 503. The intent is **not** processed; the caller retries. This is the explicit non-degraded-mode posture: an unmetered tenant proceeding past the boundary is worse than a brief unavailability.
7. (Out-of-scope follow-up: when a handler that *did* successfully decrement quota subsequently fails, the budget burns. Compensating refund is documented as a known limitation; revisit if it bites in practice.)

The lifecycle integration is documented in [`specs/lifecycle.md`](../../../../lifecycle.md) — this capability adds one explicit step ("enforce quota") between authz and idempotency in PIPE-CMD-001.

### Default quota values (placeholder, operator-tunable)

The `Tenancy.TenantProvisioned` payload ships these free-tier defaults at MVP. Numbers are placeholders for review by `commerce-owner`; the operator tunes them via the future `commerce/plans` capability without touching this spec.

| Dimension | Default budget | Notes |
|---|---|---|
| `signups-per-window` | 100 per 3600s | Per source IP; Commerce stores; tenancy reads via `signup-rate-limit` |
| `cpu-seconds` | 86,400 / day | "1 day per day" of compute on the free tier |
| `storage-bytes` | 100 MB | Combined object + block |
| `function-invocations` | 1,000 / day | Counts both successful and failed invocations |
| `egress-bytes` | 100 MB / day | Outbound network from tenant code |

## What's Stubbed Today

**Nothing — this is greenfield.** No `QuotaService` implementations exist; no `Tenancy.TenantProvisioned` event has ever been emitted; the `commerce/quotas` domain is a stub README. The closest existing pattern is `PolicyEngine` (`ports/src/policy-engine.ts`) + `@atlas/adapter-policy-stub` — this capability mirrors that shape exactly.

## What's NOT in Scope

Each item below is a separate capability spec.

- **Commerce-side `quotas/quota-ledger` capability.** The projection that materialises budgets from `Tenancy.TenantProvisioned` and per-intent metering events; the real Postgres adapter for `QuotaService`; the atomic decrement implementation; the `QuotaLedger` table. Scoped by `commerce-owner` as a sibling slice.
- **Per-handler quota wiring.** Every existing capability's I13 obligation is its own implementation work. `public-signup` and `upload-tarball` already have I13 entries in their specs (added 2026-05-08); the actual `quotaService.check()` call sites land per-capability, not in this slice.
- **Refund / compensating-decrement on handler failure.** A handler that successfully decrements quota and then fails after that point burns the budget. Acceptable for MVP given how rarely it happens; revisit as its own slice if it bites.
- **Tenant-facing UI for quota usage.** A future `apps/admin` surface (`atlas-quota-usage` widget) shows tenants their remaining budgets. Separate frontend slice.
- **Tenant-facing `GET /api/v1/quotas/usage` HTTP endpoint.** The read-side surface tenants use to inspect their own usage. Separate routes slice.
- **Quota reset / period close.** Daily / monthly budget rollovers are billing's concern (`commerce/billing/period-close`), not this capability.
- **Per-domain quota dimensions beyond the five MVP-blocking ones.** Each domain that needs additional dimensions (e.g. `repo-bytes-total` for `code/repository`, `domains-per-tenant` for `tenancy/custom-domains`) extends `QuotaDimension` in its own capability spec.
- **Renaming or retiring `Tenancy.SignupApproved`.** The two events coexist by design.
- **Adjusting default-quota *values*.** The numbers above are placeholders; the operator-tunable defaults land via the `commerce/plans` capability.

## File-by-File Plan

In execution order. Each step is a separate logical change but they ship as one PR by `port-adapter-dev` (steps 1–2) and `module-dev` (steps 3–5), with `spec-keeper` taking step 6.

1. **`ports/src/quota-service.ts`** *(new)* — `QuotaService` interface + `QuotaDimension`, `QuotaCheckRequest`, `QuotaCheckResult` types. Re-export from `ports/src/index.ts`.
2. **`adapters/policy-stub/src/quota-service-stub.ts`** *(new — co-located, or a sibling `adapters/quota-stub/` package; one-flag decision)* — `QuotaServiceStub implements QuotaService`. Always returns `{ allowed: true }`. Add to package exports.
3. **`modules/tenancy/src/events.ts`** *(edit)* — add `TENANCY_TENANT_PROVISIONED_EVENT_TYPE = 'Tenancy.TenantProvisioned'` constant + `TenantProvisionedPayload` type next to existing `SignupApproved` declarations.
4. **`modules/tenancy/src/handlers/signup-approve.ts`** *(edit)* — after the existing `Tenancy.SignupApproved` `appendEvent` call, build and append a second envelope for `Tenancy.TenantProvisioned` carrying `defaultQuotas`. `causationId` set to the `SignupApproved` event's `eventId`.
5. **`modules/tenancy/test/signup-approve.test.ts`** *(edit)* — extend existing tests to assert the second `appendEvent` call lands a `Tenancy.TenantProvisioned` envelope with a complete `defaultQuotas` payload and `cacheInvalidationTags` including `Tenant:${tenantId}`. Idempotency-on-retry test asserts the same `idempotencyKey` is used.
6. **`specs/LEXICON.md`** *(edit)* — append `QuotaService`, `QuotaCheckRequest`, `QuotaCheckResult`, `defaultQuotas` entries under the v2 "Multi-Tenant Fabric Nouns" section. Done as part of this spec PR per the lexicon rule (lexicon updates land with the spec, not the implementation).
7. **`specs/normative_requirements.md`** *(no edit)* — REQ-QUOTA-001 already lands the normative requirement; this capability is its enforcement target. No new REQ-* needed.

`apps/projection-worker/src/tenant-loop.ts` and `apps/server/src/middleware/state.ts` do **not** change in this slice — the new event flows through the existing dispatcher chain. They will change when Commerce's `quotaLedgerDispatcher` lands (separate slice).

## Things That DON'T Change

The seam contract. If a future change alters any of these, the work has exceeded this capability's scope:

- **`Tenancy.SignupApproved` envelope shape.** Coexists with `TenantProvisioned`; the two events have distinct semantics and neither replaces the other.
- **`Tenancy.SignupApproved` `cacheInvalidationTags`** (`['Tenant:${tenantId}', 'Signup:${signupId}']`). Unchanged.
- **The `appendEvent` callback shape** in `apps/server/src/routes/admin-signups.ts` and the lazy per-tenant `EventStore` construction. Unchanged.
- **The dispatcher chain composition** in `apps/server/src/middleware/state.ts` and `apps/projection-worker/src/tenant-loop.ts`. Unchanged in this slice.
- **PIPE-CMD-001 step order.** `enforceQuota` was already added between `authorize` and `checkIdempotency` in [`specs/LEXICON.md`](../../../../LEXICON.md) v2 per ADR 0004; this capability is its first concrete consumer, not a redefinition.
- **The `PolicyEngine` port** (`ports/src/policy-engine.ts`). `QuotaService` is a sibling, not an extension or replacement. Authz and quota are separate concerns by design.
- **Existing handler signatures** in any module other than `tenancy`. The wiring of `quotaService.check()` into other handlers is per-capability work, not this slice.

## Acceptance

Concrete, named tests that must exist before the capability is "done":

- **Handler test** — `modules/tenancy/test/signup-approve.test.ts` ▸ `emits Tenancy.TenantProvisioned with defaultQuotas after SignupApproved` — asserts the second envelope is appended after `SignupApproved`, with `eventType: 'Tenancy.TenantProvisioned'`, all five MVP-blocking dimensions present in `defaultQuotas`, `cacheInvalidationTags` including `Tenant:${tenantId}`, and `causationId` pointing to the `SignupApproved` event ID.
- **Handler test (idempotency)** — `modules/tenancy/test/signup-approve.test.ts` ▸ `tenant-provisioned envelope idempotency-keyed by tenantId` — replaying the same `signupId` does not double-emit `Tenancy.TenantProvisioned`; the idempotency key (`tenancy.tenant.provisioned.${tenantId}`) is stable across retries.
- **Dispatch test (I12)** — `modules/tenancy/test/dispatch.test.ts` ▸ `replaying SignupApproved + TenantProvisioned reproduces tenant + default-quota events` — synthetic event stream replays into a fresh state and produces both events in order. (Real projection rebuild is the Commerce slice's I12 test; this capability's I12 obligation is just that the events are deterministic and replayable.)
- **Contract test** — `packages/contract-tests/src/quota-service.test.ts` *(new)* — covers the `QuotaServiceStub` always-allow path and the contract any future adapter must satisfy: tenant-scoped requests, decision shape, fail-closed semantics on simulated unavailability.
- **BDD scenario** — N/A in this slice. The handoff is internal; tenant-facing behavior is exercised via the per-capability BDD scenarios that consume `quotaService.check()` (e.g. `tenancy/signup-rate-limit` BDD, `code/repository/upload-tarball` BDD when its quota wiring lands).
- **Parity test** — N/A. `QuotaService` is server-only; idb adapter is not in scope (sim does not enforce quotas in dev). Documented in `ports/CLAUDE.md` Implementer↔Consumer Map when the port lands.

## Cross-References

- Domain spec: [`specs/domains/tenancy/README.md`](../../README.md)
- Sibling capability that this unblocks: [`specs/domains/tenancy/capabilities/public-signup/README.md`](../public-signup/README.md) — Known Debt item (d) is the gap this slice closes.
- Sibling capability whose I13 obligation references this one: [`specs/domains/code/repository/capabilities/upload-tarball/README.md`](../../../code/repository/capabilities/upload-tarball/README.md).
- Companion capability (Commerce-side, not yet scoped): `specs/domains/quotas/capabilities/quota-ledger/README.md` — the projection that materialises budgets from `Tenancy.TenantProvisioned`. Owned by `commerce-owner`.
- Architecture: [`specs/architecture.md`](../../../../architecture.md) — Invariant **I13** + the "Tenant Runtime Isolation" section's quota-enforcement subsection.
- Source ADR: [`specs/decisions/0004-platform-invariants-for-multi-tenant-fabric.md`](../../../../decisions/0004-platform-invariants-for-multi-tenant-fabric.md) — REQ-QUOTA-001, REQ-SIGNUP-002.
- Vision framing: [`specs/decisions/0003-tenant-defined-data-model-pivot.md`](../../../../decisions/0003-tenant-defined-data-model-pivot.md) — open public signup as configuration of the chassis.
- Lexicon: [`specs/LEXICON.md`](../../../../LEXICON.md) ▸ `QuotaService`, `QuotaCheckRequest`, `QuotaCheckResult`, `defaultQuotas`, `Quota`, `enforceQuota`, `provisionTenant`.
- Lifecycle: [`specs/lifecycle.md`](../../../../lifecycle.md).
- Port pattern (mirror): [`ports/src/policy-engine.ts`](../../../../../ports/src/policy-engine.ts).
- Stub pattern (mirror): [`adapters/policy-stub/`](../../../../../adapters/policy-stub/).
- Tenant-provisioning handler that gains the new emit: [`modules/tenancy/src/handlers/signup-approve.ts`](../../../../../modules/tenancy/src/handlers/signup-approve.ts).
- Capability template: [`specs/_capability-template.md`](../../../../_capability-template.md).
