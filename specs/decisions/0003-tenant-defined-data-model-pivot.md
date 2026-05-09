# 0003 — Atlas as multi-tenant fabric: revive `custom-schema` + `functions`, frame as self-hostable software with a public reference instance

**Status:** Accepted (2026-05-08)
**Amends:** [`0002-developer-platform-domain-map.md`](0002-developer-platform-domain-map.md). 0002 is not superseded — its core re-anchor (CMS framing → developer-platform shape, the Spine/Compute/Storage/Code/Workflow/Commerce platform layout) stands. This ADR amends specific calls within 0002 that are now wrong.

## Context

ADR 0002 re-anchored Atlas from a CMS / SaaS-framework shape to a "self-hosted developer platform" (Vercel-shaped: push code, get a URL). Two calls 0002 made — both reasonable at the time — turn out to be too narrow given the actual product ambition:

1. **0002 retired `custom-schema` and `functions`** under the rationale that "tenant-defined entity types and tenant-defined functions… don't have a home in the dev-platform vision today." That's wrong for the actual ambition. The ambition is Salesforce-shaped: tenants define their own data model (entities, fields, relationships) inside Atlas's per-tenant DB, and write tenant-authored functions against it. These two domains are not "future work" — they are the trunk of what tenants come to Atlas to do.
2. **0002 framed Atlas as "single-operator, multi-tenant. Not designed to compete with AWS or Heroku."** That under-states the product. Atlas is **software anyone can self-host**. The author runs a public hosted instance (`atlas.<domain>`) with open public signup as one example deployment, but the public instance is the same software, not a privileged form. Open public signup must be supported from day one — it's a configuration of the chassis, not a separate product.

A third call needs to be made explicit in this ADR even though 0002 didn't address it: **Atlas is agentic from day one.** Designed to be operable by AI agents from the start. Single ingress, structured logs, machine-readable surfaces are not optional polish — they're load-bearing tenets.

The combined picture: Atlas is a **multi-tenant platform fabric**. A tenant gets identity / authz / audit / observability / search "for free" by being a tenant. They define their own data model. They optionally provision backend services (Vercel-style). They write code that runs against their data and services. The control plane is tiny; the tenant's domain lives in the tenant's DB.

[`vision.md`](../vision.md) has been rewritten to reflect this picture; this ADR records the directional change.

## Decision

### 1. Revive `custom-schema` and `functions` under a restored Extensibility platform

The 7-platform layout becomes:

| Platform | Domains |
|----------|---------|
| **Spine** | identity, authorization, tenancy, organization, audit, observability, search |
| **Compute** | cluster, runtime, image-build, ingress, dns |
| **Storage** | object-storage, block-storage, secrets |
| **Code** | repository, pipeline, artifact-registry |
| **Workflow** | triggers, scheduling, jobs, function-runner, approvals, import-export |
| **Commerce** | billing, quotas, metering, plans |
| **Extensibility** *(revived)* | **custom-schema, functions** |
| **First-party apps** *(parked)* | cms (catalog + content-pages + authoring + page-templates) |

The existing `specs/domains/custom-schema/README.md` and `specs/domains/functions/README.md` stubs are re-marked as **active domains** (status note + cross-reference to this ADR). Capability specs land via the slice workflow in Phases 3–4 of the [`vision.md`](../vision.md) roadmap.

`function-runner` (under Workflow) and `functions` (under Extensibility) are deliberately kept as separate domains — they have different audiences:

- **`function-runner`** is internal infrastructure: the sandboxed execution model used by workflow jobs. Operators tune it; tenants don't see it.
- **`functions`** is the tenant surface: tenants author functions, attach them to schema lifecycle events, expose HTTP endpoints, and schedule them. `functions` may use `function-runner` underneath, but they are distinct domains with distinct ports and capabilities.

### 2. Atlas is software, with a public reference instance as one deployment

0002's framing of Atlas as "single-operator, not a public IaaS" is replaced by: **Atlas is software anyone can self-host. The author runs a public instance with open public signup as one example deployment.**

Concretely:

- **Open public signup is supported from day one.** Signup → email verify → tenant provisioned → admin user created, with rate-limiting and quota defaults that work without operator intervention.
- **Multi-tenant isolation must be strict** — strong enough that mutually-distrusting tenants can share an instance safely. The operator is not a fallback for isolation failures. Quota enforcement is load-bearing.
- **Signup gating is configuration, not architecture.** A self-host can disable public signup, gate it by invite, or open it. Atlas treats all three the same way.
- Atlas is **not** a public IaaS competitor in the AWS/GCP sense (raw substrate economics). Atlas's value is the chassis, not the substrate.

### 3. Agentic-first as a stated tenet

The following commitments are codified, not aspirational:

- **Single ingress (Invariant I1)** — every operation flows through `apps/server`. No "side door" for UI, CLI, agents, or anything else. Already an invariant; this ADR re-emphasizes that it's load-bearing for the agent vision.
- **Structured logs with mandatory fields** ([`crosscut/logging.md`](../crosscut/logging.md)) — every log line is structured JSON; every request-scoped log carries `correlationId` + `tenantId` + `principalId`.
- **Machine-readable surfaces** — every UI surface exposes its state via the surface-contract model so that agents can read what users see.
- **One CLI, one API, one audit trail** — `atlasctl` and the HTTP API are the same surface; anything an agent does, a tenant or operator can do, and vice versa.

Existing invariants I1–I12 already enforce most of this; the ADR's contribution is making "agentic-first" an explicit framing tenet so future capability specs are evaluated against it.

## What this ADR does *not* change from 0002

The following 0002 calls stand:

- **CMS-shape domains stay parked.** `catalog`, `content-pages`, `widgets`, `authoring`, `page-templates`, `delivery`, `media`, `maps`, `forms`, `localization` remain parked under the first-party apps platform (or retired entirely as 0002 specified). Atlas is not a CMS.
- **Engagement-platform domains stay retired.** `communications`, `notifications`, `analytics`, `experimentation`, `gamification` — none on-path. Notifications about deployments / workflow runs may return as a new domain under Spine if needed.
- **Spine, Compute, Storage, Code, Workflow, Commerce platforms** retain their 0002 shape and domain memberships.
- **Phase 0 / Phase 1** scope stands: the chassis (signup → tenancy → repo → workflow → deployment) is built first. Tenant-defined data model and tenant-authored functions land in Phases 3–4.
- **`function-runner`** stays under Workflow. It is internal infrastructure for workflow jobs, not the tenant `functions` surface.

## Consequences

**Positive:**

- The vision document and the domain map now match the actual product ambition. Capability scoping decisions can trace to the dream instead of the (narrower) Phase-1 demo.
- The `custom-schema` + `functions` stubs that already exist on disk get re-activated rather than discarded — prior thinking is preserved.
- The "agentic-first" tenet, made explicit, gives the new `vision-keeper` agent a concrete clause to enforce.
- Operators considering self-hosting Atlas have a clear answer: it's the same software the public instance runs.

**Negative:**

- ~10 capability specs across `custom-schema` and `functions` will eventually land. None are gating Phase 1, but the spec backlog grows.
- Open public signup raises the abuse / capacity / billing bar earlier than 0002 implied. Quota defaults, rate-limiting, and signup-fraud signals must work in MVP, not as Phase 4 polish.
- Strict multi-tenant isolation (mutually-distrusting tenants on one instance) is a stronger bar than 0002's single-operator framing required. Network policies, namespace scoping, secret scoping, and search-index isolation all need to clear it.

**Out of scope for this ADR:**

- The specific port shapes for `custom-schema` and `functions`. Each gets its own capability specs when scoped.
- A platform-owner agent for Extensibility (defer; can land when the first capability is scoped).
- The storage strategy fork already noted in `specs/domains/custom-schema/README.md` (sparse pivot table vs. schema-per-tenant vs. row-level-security). That decision stays open and gets recorded as its own ADR when made.
- Capacity planning and billing-economics for the public instance.

## Migration

This ADR is spec-only. Concretely:

1. **This PR:** ADR 0003 + rewritten [`vision.md`](../vision.md) + root [`CLAUDE.md`](../../CLAUDE.md) domain-map refresh + [`specs/CLAUDE.md`](../CLAUDE.md) migration-table refresh + reactivated `specs/domains/custom-schema/README.md` + `specs/domains/functions/README.md` + new [`vision-keeper`](../../.claude/agents/vision-keeper.md) agent.
2. **Future:** Capability specs for `custom-schema` and `functions` land via the slice workflow as Phases 3–4 begin.
3. **Future:** Decide the `custom-schema` storage strategy fork; record as an ADR.
4. **Future:** Add a platform-owner agent for Extensibility once the first capability is scoped.

No code changes in this PR.
