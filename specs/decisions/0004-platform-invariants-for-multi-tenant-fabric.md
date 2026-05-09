# 0004 — Platform invariants and normative requirements for the multi-tenant fabric

**Status:** Accepted (2026-05-08)
**Amends:** [`0003-tenant-defined-data-model-pivot.md`](0003-tenant-defined-data-model-pivot.md). 0003 stated tenets ("agentic-first", "mutually-distrusting tenants must coexist safely", "open public signup is configuration"); this ADR makes them mechanically checkable by adding invariants I13–I18 and six numbered normative requirements.

## Context

ADR 0003 raised the bar in three ways that the existing invariant set (I1–I12) was not authored for:

1. **Untrusted tenants on a shared instance** — open public signup means mutually-distrusting tenants will coexist on the same Atlas deployment from day one.
2. **Untrusted code** — tenant-authored functions (Extensibility/`functions`) execute inside Atlas's blast radius.
3. **Untrusted schemas** — tenant-defined entity types (Extensibility/`custom-schema`) mean tenants issue DDL-equivalent operations.

The "big boy" multi-agent review on 2026-05-08 surfaced the same gap from architect, spec-keeper, sdet, spine-owner, compute-owner, storage-owner, code-owner, commerce-owner, observability-architect, frontend-dev, module-dev, and port-adapter-dev: **the new bar needs enforceable rules, not just tenets**. This ADR records those rules.

The user explicitly chose to land these now, before Phase 3–4 capability scoping starts, so capability specs in those phases can be evaluated against them.

## Decision

### Six new platform invariants

These are added to [`specs/architecture.md`](../architecture.md) alongside I1–I12. All six are mechanically checkable.

#### I13 — Quota enforcement precedes execution

Quota check runs at ingress before handler dispatch. Over-budget tenants emit no events, run no handlers, consume no compute, return `QUOTA_EXCEEDED`. Mirrors I2 (authz precedes execution) and I3 (idempotency precedes dispatch); the request lifecycle gains a quota-check stage between authz and idempotency.

**Mechanically checkable:** request-flow trace test asserting `quotaService.check()` is called for every mutating handler before any side effect.

#### I14 — Tenant code isolation

Tenant-authored code (Extensibility/`functions`) executes only via the `FunctionRuntime` port. Tenant code:
- MUST NOT import `@atlas/*` packages.
- MUST NOT have direct filesystem, network, or process access — only mediated egress via host-provided context.
- MUST NOT execute in the `apps/server` process. The runtime adapter runs out-of-process (per [ADR 0006](0006-function-runtime-substrate.md)).

**Mechanically checkable:** lint rule on tenant-bundle imports + sandbox contract test that asserts a known-malicious payload cannot escape (per the SDET sandbox-escape harness).

#### I15 — Egress mediation

Tenant outbound HTTP / DNS / network traffic flows through a tenant-scoped egress port that:
- Audits the call (`Audit.EgressCalled` event with `correlationId`, `tenantId`, target).
- Enforces quota (egress-bytes, request-count).
- Applies authz (allowlist/denylist policy).

No tenant-code path may reach the public internet without going through this port. Mirrors I1's "single ingress" rule for outbound traffic.

**Mechanically checkable:** sandbox contract test attempts direct `fetch` / DNS resolution from tenant code; asserts call fails or is intercepted.

#### I16 — Schema-mutation scope

Tenant-defined schema mutations (Extensibility/`custom-schema`) affect only the issuing tenant's database. Tenant DDL operations:
- MUST NOT touch the control-plane DB.
- MUST NOT touch any other tenant's DB.
- MUST be drawn from a constrained DDL allowlist (per [ADR 0005](0005-custom-schema-storage-strategy.md)) — no `DROP DATABASE`, no extension creation, no cross-schema references.

**Mechanically checkable:** migration-applier port asserts target schema name matches issuing tenant's schema; rejects any migration that names another schema.

#### I17 — API / CLI / UI parity

Every action exposed through `apps/server` is reachable via:
- The HTTP API.
- An `atlasctl` command (thin wrapper over the HTTP API).
- A UI surface (where user-facing).

This makes the agentic-first tenet enforceable: anything an agent can do, a user can do, and vice versa.

**Mechanically checkable:** CI diff between the action registry and `atlasctl` command list; missing pairs fail the build.

#### I18 — Surface state machine-readability

Every `AtlasSurface` exposes its state via the surface-contract introspection API ([`specs/frontend/surface-introspection.md`](../frontend/surface-introspection.md), to be created per the frontend-dev finding). State exposure is prod-safe and authz-gated, not a dev-only test affordance.

**Mechanically checkable:** surface registry CI check; new surfaces without a contract fail spec-conformance.

### Six new normative requirements

These land in [`specs/normative_requirements.md`](../normative_requirements.md) as numbered RFC 2119 rules.

- **REQ-SIGNUP-001** (ERROR): "Atlas MUST support open public signup as a first-class deployment configuration. The signup pipeline (intent → email verify → tenant provisioned → admin user created) MUST function without operator intervention when public signup is enabled."

- **REQ-SIGNUP-002** (ERROR): "When public signup is enabled, requests MUST be rate-limited per source IP and per email; a tenant exceeding signup-rate budget MUST be rejected with `QUOTA_EXCEEDED`."

- **REQ-ISO-001** (ERROR): "Tenant isolation MUST hold under a mutual-distrust threat model. No tenant on a shared instance may read, write, observe, or starve another tenant's data, runtime workloads, search indexes, secrets, or quota accounting. The operator is not a fallback."

- **REQ-QUOTA-001** (ERROR): "Quota enforcement MUST be load-bearing. An over-budget tenant MUST NOT be able to deploy, execute functions, grow data, or accept new signups against their slug."

- **REQ-AGENT-001** (ERROR): "Every UI surface MUST expose a machine-readable state contract per `specs/frontend/surface-introspection.md`. New surfaces without a surface contract MUST fail spec-conformance."

- **REQ-INGRESS-002** (ERROR — companion to existing I1): "`atlasctl`, the HTTP API, the web UI, and any agent integration MUST share a single ingress (`apps/server`). No parallel command path may exist."

### New section in architecture.md: "Tenant Runtime Isolation"

`specs/architecture.md` currently covers data-layer tenant isolation but has no section on runtime isolation (process boundaries, sandboxes, egress mediation, schema-mutation scope). A new section lands alongside I13–I18 covering:

- Tenant code never executes in the `apps/server` process.
- The `FunctionRuntime` port boundary and how its adapter (gVisor MVP — see ADR 0006) provides isolation.
- Egress mediation (I15).
- Schema-mutation scope (I16).
- The mutual-distrust threat model (REQ-ISO-001).

## Consequences

**Positive:**

- Phase 3–4 capability specs (`custom-schema`, `functions`) have a concrete bar to clear instead of tenets to interpret.
- The agentic-first claim (ADR 0003 §3) becomes enforceable — I17 + I18 give CI tests a target.
- `vision-keeper` and `architect` agents have unambiguous rules to police.
- SDET's sandbox-escape harness has a port boundary (I14) it can test against.

**Negative:**

- Existing in-flight code (signup, repository, cluster-registration) was authored against I1–I12 only and will need a quota-check audit pass to align with I13 before Phase 1 closes.
- I17 (API/CLI/UI parity) creates back-pressure on every new feature: shipping an HTTP endpoint without an `atlasctl` counterpart is now a CI failure. Worth it for agentic-first; not free.
- I15 (egress mediation) means the platform must implement an egress proxy port + adapter before tenant functions can call the public internet. That's a real Phase 3 dependency that wasn't on the roadmap.

**Out of scope:**

- The exact text of new architecture.md / normative_requirements.md sections — landed in a follow-up PR by `spec-keeper`. This ADR records the decision.
- The egress proxy port shape — to be designed when its first capability is scoped.
- The `FunctionRuntime` port shape — recorded in [ADR 0006](0006-function-runtime-substrate.md).

## Migration

1. **This ADR (spec-only):** records the decision.
2. **Follow-up PR by `spec-keeper`:** lands I13–I18 verbatim in `specs/architecture.md`, the six REQ-* rules in `specs/normative_requirements.md`, and the "Tenant Runtime Isolation" section in `specs/architecture.md`. ✅ Landed 2026-05-08.
3. **Follow-up PR by `frontend-dev`:** creates `specs/frontend/surface-introspection.md` (referenced by I18 / REQ-AGENT-001). ✅ Landed 2026-05-08.
4. **Follow-up audit by `architect`:** sweep in-flight Phase 0 / Phase 1 capability specs for I13 quota-check compliance; flag gaps. ✅ Landed 2026-05-08 — see audit summary below.

No code changes in this PR.

## Appendix — I13 Quota-Check Audit (2026-05-08)

Sweep of all four active Phase 0 / Phase 1 capability specs against the new I13 obligation.

### `tenancy/public-signup` — non-compliant; debt promoted to MVP-blocker

- Invariants Touched section did not list I13. **Updated** to add I13 with cross-ref to ADR 0004 and REQ-SIGNUP-002 / REQ-QUOTA-001.
- Known Debt item (d) "Default plan / quota attachment" was tagged for "before Compute slice 5." **Severity raised** to MVP-blocker; the `tenancy/quota-handoff` capability (per `spine-owner`'s scoping) lands the contract.
- "Rate limiting on `/signup`" was in "What's NOT in Scope" as a "hardening slice." **Promoted** to Known Debt item (h) — the `tenancy/signup-rate-limit` capability is now MVP-gating per REQ-SIGNUP-002.
- "Self-service approval" was in "What's NOT in Scope" as "policy decision for later." **Promoted** to Known Debt item (i) — `tenancy/self-serve-provisioning` capability is MVP-gating per REQ-SIGNUP-001 when public signup is enabled.

### `code/repository/upload-tarball` — non-compliant; spec amended

- Invariants Touched section did not list I13. **Updated** to add I13 with three required quota dimensions: `repo-count`, `repo-bytes-total`, `push-events-per-window`. Compliance noted as mandatory before public-instance shipping (without it, any tenant fills disk via repeated 10 MB tarball pushes).
- Quota dimensions land in Commerce; this capability's obligation is the call site.

### `tenancy/custom-domains` — compliant (operator-only path)

- Operator-driven concierge mode (`pnpm domain:add`) bypasses the request pipeline; no I13 obligation today.
- The future self-service domain-verification flow (described in "Replacing the Stub With the Real Thing") MUST add I13 when it lands — `domain-additions-per-window`, `domains-per-tenant` are likely dimensions. Flagged for the implementation slice.

### `compute/cluster/cluster-registration` — compliant (operator-only path)

- Operator script (`pnpm cluster:register`) — direct DB access, not request-pipeline. No I13 obligation.
- Future tenant→cluster binding capability is a separate slice; that one will need I13 (`cluster-bindings-per-tenant`).

### Net result

Two specs amended in line with this ADR (`public-signup`, `upload-tarball`). Two specs flagged as having future I13 obligations when their request-pipeline successors land (`custom-domains` self-service flow, tenant→cluster binding). The four MVP-blocking quota dimensions per `commerce-owner`'s scoping (`signups-per-window`, `cpu-seconds`, `storage-bytes`, `function-invocations`, `egress-bytes`) all have at least one named consumer now.
