# Atlas — Multi-Tenant Platform Fabric

**Version:** 0.1.0
**Architecture:** Hexagonal, Event-Driven, Policy-First AuthZ, Agentic-First
**Tenancy Model:** Database-per-Tenant + Cluster-Namespace-per-Tenant (Phase 1+)
**Timezone:** America/Chicago

## Purpose

Atlas is a multi-tenant platform fabric: a tenant signs up, defines their own data model (Salesforce-shaped, Phase 3–4), optionally provisions backend services (Vercel-shaped), writes functions and workflows against their data, and gets identity / authz / audit / observability / search applied uniformly to every operation. Atlas is software anyone can self-host; the project author runs a public reference instance with open public signup as one example deployment. See [`vision.md`](vision.md) for the user-facing description, [`decisions/0002-developer-platform-domain-map.md`](decisions/0002-developer-platform-domain-map.md) for the original CMS → developer-platform re-anchor, and [`decisions/0003-tenant-defined-data-model-pivot.md`](decisions/0003-tenant-defined-data-model-pivot.md) for the multi-tenant-fabric ambition (Extensibility platform revival, agentic-first tenet, hosting-model framing).

The platform enforces strict security boundaries through centralized authorization, maintains tenant isolation through dedicated databases (control-plane + per-tenant) and per-tenant cluster namespaces (Phase 1+), and supports horizontal scaling through event-driven architecture and cache-first design. Strategy is to **wrap existing tools as adapters** (k3s, kaniko, Caddy, Hetzner Cloud, Gitea, MinIO, etc.) and build the unified multi-tenant control plane that ties them together.

## Core Principles

### P1: Single Ingress Chokepoint

All external requests and events enter through exactly one ingress point that enforces:
- Tenant resolution from request context
- Authentication normalization into Principal
- Authorization enforcement before dispatch
- Correlation ID assignment and trace propagation
- Structured logging with tenant context

No module or service may expose direct external endpoints. The ingress gateway is the sole entry point and enforces platform-wide invariants before any business logic executes.

### P2: Policy-First Authorization

Authorization is centralized in platform core. Modules declare actions and resources via manifests; core evaluates RBAC and ABAC policies against every request.

Enforcement occurs in two layers:
1. **Ingress layer**: Pre-dispatch authorization check
2. **Application layer**: Re-authorization within command handlers for defense in depth

Evaluation follows **deny-overrides-allow** semantics: any deny rule takes precedence over allow rules. Default decision is deny.

### P3: Event-Sourced Writes

State changes occur through commands that emit domain events. Events are the source of truth for projections and audit trails.

Durable publish uses the **outbox pattern**: events are written transactionally with state changes, then reliably published to the message bus by a separate poller/worker.

### P4: Reads from Projections

Query paths read from **projections** (read models) built by consuming domain events. Projections are:
- Denormalized for query performance
- Rebuildable from event history
- Cached aggressively with event-driven invalidation

Write models are never queried directly.

### P5: Cache-First Design

Cache keys and invalidation policies are first-class design artifacts. Every cacheable response declares:
- `varyBy` dimensions (tenant, locale, role, user, ABAC context, or none)
- `privacy` level (public, tenant-scoped, user-scoped, role-scoped)
- `ttlSeconds` for expiration
- `tags` for invalidation

Cache keys **must** include `tenantId` unless explicitly marked PUBLIC and verified tenant-safe. Invalidation is event-driven using tag-based purging.

### P6: Module Governance via Manifests

Modules are governed by declarative **manifests** that define:
- Actions and resources owned by the module
- Events published and consumed
- Projections maintained
- Database migrations
- Background jobs
- UI routes
- Cache artifacts

The platform enforces declared capabilities. Undeclared actions cannot be invoked; undeclared events cannot be published.

## Core Invariants

The following invariants are **non-negotiable** and must be enforced by any implementation:

### I1: Single Ingress Enforcement

**Invariant**: All external requests MUST pass through exactly one ingress chokepoint that enforces the full validation pipeline.

**Enforcement Points**:
1. Envelope validation (required fields present)
2. Tenant resolution from headers
3. Authentication (Principal construction)
4. Action registry lookup (action exists)
5. Authorization (BEFORE any handler logic)
6. Idempotency check (BEFORE any handler logic)
7. Handler dispatch (only if all gates pass)
8. Audit logging

**Violation**: Any code path that allows handler execution without passing all enforcement points breaks the security model.

**Test**: See `specs/fixtures/sample_page_create_intent.json` → ingress flow

---

### I2: Authorization Precedes Execution

**Invariant**: Authorization MUST be enforced BEFORE any handler logic executes.

**Semantics**:
- Authorization is evaluated at ingress, before dispatch
- Deny decision MUST prevent handler execution entirely
- No side effects (state changes, event emission, cache writes) may occur for denied requests

**Violation**: If a handler executes before authorization completes, unauthorized actions may leak data or mutate state.

**Test**: See Phase 2 test `rejects request when authorization denies`

---

### I3: Idempotency Before Execution

**Invariant**: Duplicate `idempotencyKey` MUST NOT cause re-execution of handlers or re-application of state changes.

**Semantics**:
- Idempotency store is checked at ingress, before dispatch
- First request with a key executes normally
- Subsequent requests with same key return empty result (no events emitted)
- Projections MUST NOT double-apply events with duplicate idempotencyKey

**Violation**: If duplicate requests cause double-execution, state becomes inconsistent.

**Test**: See Phase 2 test `prevents duplicate execution via idempotency key`

**Fixture**: `specs/fixtures/invalid_event_envelope_missing_idempotency.json`

---

### I4: Deny-Overrides-Allow Authorization

**Invariant**: In policy evaluation, any matching DENY rule causes denial, regardless of ALLOW rules.

**Semantics**:
- Evaluate all DENY rules first
- If any DENY matches, return deny decision (stop evaluation)
- Evaluate ALLOW rules only if no DENY matched
- If any ALLOW matches, return allow decision
- If no rules match, default is deny

**Violation**: If allow rules can override deny, security policies are violated.

**Fixture**: `specs/fixtures/sample_policy_bundle.json`

---

### I5: Correlation Propagation

**Invariant**: `correlationId` MUST propagate through entire request flow: UI intent → domain events → projections → jobs.

**Semantics**:
- Ingress assigns correlationId if not present
- All domain events emitted from a request carry the same correlationId
- Projection updates preserve correlationId in logs
- Jobs triggered by events inherit correlationId

**Purpose**: Enables distributed tracing and debugging.

**Violation**: If correlationId is lost, distributed traces break.

**Fixture**: `specs/fixtures/expected_page_created_event.json` (shows propagation)

---

### I6: Causation Linkage

**Invariant**: Domain events MUST set `causationId` to the `eventId` of the causing event.

**Semantics**:
- UI intent event has no causationId (it's the origin)
- Domain event from handler sets `causationId = <UI intent eventId>`
- Secondary events (from projections/jobs) set `causationId = <triggering domain event eventId>`

**Purpose**: Enables causal chain reconstruction for auditing.

**Violation**: If causationId is missing or wrong, audit trails are incomplete.

**Fixture**: `specs/fixtures/expected_page_created_event.json`

---

### I7: Tenant Isolation in Search

**Invariant**: Search queries MUST be scoped to `tenantId` from request context. Cross-tenant documents MUST NEVER appear in results.

**Semantics**:
- Search index is partitioned by tenantId
- Query implicitly includes `WHERE tenantId = <context.tenantId>`
- No user input can override tenant scope

**Violation**: Cross-tenant data leakage violates multi-tenancy security.

**Test**: See Phase 2 test `prevents cross-tenant data access`

**Fixture**: `specs/fixtures/expected_search_results_filtered.json`

---

### I8: Permission-Filtered Search

**Invariant**: Search results MUST be filtered by `permissionAttributes` before returning to user.

**Semantics**:
- Documents with `permissionAttributes: null` are visible to all users within tenant (public)
- Documents with `permissionAttributes.allowedPrincipals` are visible only to listed principals
- Handler MUST filter results before constructing response event

**Violation**: Users may see documents they lack permission to view.

**Test**: See Phase 2 test `filters search results by permission`

**Fixture**: `specs/fixtures/search_documents.json`, `specs/fixtures/expected_search_results_filtered.json`

---

### I9: Cache Keys Include TenantId

**Invariant**: All cache keys MUST include `tenantId` unless the artifact is explicitly marked PUBLIC and verified tenant-safe.

**Semantics**:
- Cache key format: `{tenantId}:{artifactKind}:{artifactId}:...`
- PUBLIC artifacts (no tenant data) may omit tenantId
- Tenant-scoped artifacts MUST include tenantId as first dimension

**Violation**: Tenant data may leak to other tenants via cache.

**Fixture**: `specs/fixtures/sample_module_manifest.json` (cacheArtifacts)

---

### I10: Event-Driven Cache Invalidation

**Invariant**: Cache invalidation MUST be triggered by domain events via tag matching.

**Semantics**:
- Cache entries are tagged (e.g., `Tenant:{tenantId}`, `Page:{pageId}`)
- Domain events declare tags for affected entities
- Cache service subscribes to events and invalidates entries matching tags
- Manual invalidation is prohibited (breaks correctness)

**Violation**: Stale cache entries may serve incorrect data.

**Fixture**: `specs/fixtures/sample_module_manifest.json` (tags in cacheArtifacts)

---

### I11: Deterministic Time Bucketing (Analytics)

**Invariant**: Analytics time buckets MUST be deterministically aligned to epoch + bucketSize.

**Semantics**:
- Bucket boundary = `floor(timestamp / bucketSize) * bucketSize`
- Same events + same query always produce same buckets
- Bucket alignment is independent of query time

**Purpose**: Ensures consistent aggregations across queries.

**Violation**: Non-deterministic bucketing breaks analytics correctness.

**Fixture**: `specs/fixtures/expected_analytics_buckets.json`

---

### I12: Projections Are Rebuildable

**Invariant**: Projections (read models) MUST be rebuildable from event history alone.

**Semantics**:
- Projections consume domain events in order
- Projection state is derived purely from events (no external dependencies)
- Deleting a projection and replaying events reconstructs identical state

**Purpose**: Enables projection version upgrades, bug fixes, and disaster recovery. Also the foundation for the always-on contract ([`crosscut/always-on.md`](crosscut/always-on.md)) — state is durable independent of code, so reload-then-resume is a well-defined operation.

**Violation**: If projections depend on non-event state, rebuilds fail or produce incorrect data.

---

### I13: Quota Enforcement Precedes Execution

**Invariant**: Quota check MUST run at ingress before handler dispatch. Over-budget tenants MUST emit no events, run no handlers, and consume no compute.

**Semantics**:
- Quota service is consulted after authz (I2) and before idempotency (I3)
- Pipeline: validate → resolve tenant → authn → authz → **quota check** → idempotency → dispatch
- On `QUOTA_EXCEEDED`: request short-circuits with the typed error; no events emitted, no audit-of-side-effect (the denial itself is audited)
- Quota dimensions are declared per action in the module manifest (e.g., `signups-per-window`, `cpu-seconds`, `storage-bytes`, `function-invocations`, `egress-bytes`)

**Purpose**: Open public signup means abusive tenants will arrive; quotas must be load-bearing from the boundary, not a Phase-4 polish (REQ-QUOTA-001).

**Violation**: An over-budget tenant proceeds past the boundary, consuming resources or affecting other tenants.

**Source**: [`decisions/0004-platform-invariants-for-multi-tenant-fabric.md`](decisions/0004-platform-invariants-for-multi-tenant-fabric.md)

---

### I14: Tenant Code Isolation

**Invariant**: Tenant-authored code (Extensibility/`functions`) MUST execute only via the `FunctionRuntime` port. The runtime adapter MUST run out-of-process from `apps/server`.

**Semantics**:
- Tenant code MUST NOT import `@atlas/*` packages
- Tenant code MUST NOT have direct filesystem, network, or process access — only mediated egress via host-provided context (`ctx.fetch`, `ctx.logger`, `ctx.kv`, etc.)
- Tenant code MUST NOT execute in the `apps/server` Node process
- The MVP runtime adapter is gVisor-backed k8s Jobs ([ADR 0006](decisions/0006-function-runtime-substrate.md)); other adapters (V8 isolates, Firecracker) are swappable behind the same port

**Purpose**: Tenant code is untrusted; the existing hexagonal layering rule ("modules import only `@atlas/ports`") presumes trusted authors. Tenant code requires a stronger boundary.

**Violation**: Tenant code reaches platform internals, sibling tenants, or cross-process state.

**Scope note**: I14 governs **tenant code** — Turing-complete, side-effecting programs authored by tenants under Extensibility/`functions`. Tenant **declarations** (templates, queries, formulas, validation rules — DSL artifacts under [ADR 0007](decisions/0007-dsl-substrate-and-authoring-contract.md)) are a distinct category and execute in `apps/server` via the platform's DSL evaluator. The carve is safe because DSLs are constrained by ADR 0007 §2 (non-Turing-complete, pure, no ambient I/O, deterministic, bounded). A DSL that cannot meet that contract is tenant code and routes through `FunctionRuntime`.

**Source**: [`decisions/0004-platform-invariants-for-multi-tenant-fabric.md`](decisions/0004-platform-invariants-for-multi-tenant-fabric.md), [`decisions/0007-dsl-substrate-and-authoring-contract.md`](decisions/0007-dsl-substrate-and-authoring-contract.md)

---

### I15: Egress Mediation

**Invariant**: Tenant outbound HTTP / DNS / network traffic MUST flow through a tenant-scoped egress port that audits, quotas, and applies authz to every call.

**Semantics**:
- The egress port emits `Audit.EgressCalled` with `correlationId`, `tenantId`, target host, request size
- Egress quota dimensions: `egress-bytes`, `egress-requests-per-window`
- Egress authz: per-tenant allowlist / denylist; default-deny on unconfigured destinations
- No tenant-code path may reach the public internet without traversing this port (the outbound counterpart of I1)

**Purpose**: Mutually-distrusting tenants on one instance means abusive outbound traffic (data exfil, SSRF, DDoS amplification) must be metered and auditable.

**Violation**: Tenant code originates a network call that bypasses audit, quota, or authz.

**Source**: [`decisions/0004-platform-invariants-for-multi-tenant-fabric.md`](decisions/0004-platform-invariants-for-multi-tenant-fabric.md)

---

### I16: Schema-Mutation Scope

**Invariant**: Tenant-defined schema mutations (Extensibility/`custom-schema`) MUST affect only the issuing tenant's database and only operations on the constrained DDL allowlist.

**Semantics**:
- Tenants do not issue raw SQL; they declare object types via Atlas API. The platform translates declarations into a constrained DDL set: `CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX`, `ALTER COLUMN ... TYPE` (with safe-cast rules), `DROP COLUMN`, `DROP TABLE`.
- Forbidden DDL: `CREATE DATABASE`, `DROP DATABASE`, `CREATE EXTENSION`, cross-database references, triggers (those are Extensibility/`functions`' responsibility), `GRANT`, `REVOKE`, role manipulation.
- Schema mutations are scoped to the issuing tenant's database (`atlas_t_<tenantUuid>` per [ADR 0005](decisions/0005-custom-schema-storage-strategy.md)) — never the control-plane DB, never another tenant's database. Tables inside the tenant's database live in `public` (the default Postgres schema); the database itself is the isolation boundary, enforced at the protocol layer (separate connection target, separate catalog, separate WAL).
- Per-tenant migration ledger lives inside the tenant's database and is separate from the control-plane `_atlas_migrations` table; tenant schemas are rebuildable from the tenant's event store (I12 holds for tenant-defined schemas).

**Purpose**: Tenant-controlled DDL is necessary for the Salesforce-shaped data model but is also the largest blast-radius primitive in the platform. The scope boundary is the difference between "tenants define their data" and "tenants operate the database."

**Violation**: A tenant's schema mutation reaches another tenant's database or executes DDL outside the allowlist.

**Source**: [`decisions/0004-platform-invariants-for-multi-tenant-fabric.md`](decisions/0004-platform-invariants-for-multi-tenant-fabric.md), [`decisions/0005-custom-schema-storage-strategy.md`](decisions/0005-custom-schema-storage-strategy.md)

---

### I17: API / CLI / UI Parity

**Invariant**: Every action exposed through `apps/server` MUST be reachable via the HTTP API, an `atlasctl` command (thin wrapper over the API), and a UI surface where user-facing.

**Semantics**:
- The action registry is the single source of truth for what actions exist
- `atlasctl` commands are generated from / matched against the action registry; missing pairs fail CI
- UI surfaces register against the same action vocabulary; user-facing actions without a UI surface are flagged
- This makes the agentic-first tenet enforceable: an AI agent can do anything a human can do, and vice versa, because there is one set of actions exposed identically across surfaces

**Purpose**: ADR 0003 §3 stated the parity tenet; without an invariant it remained aspirational. I17 makes "anything an agent does, a tenant can do" mechanically checkable.

**Violation**: An HTTP endpoint exists with no `atlasctl` counterpart, or a CLI command has no API equivalent, or a user-facing action has no UI surface.

**Source**: [`decisions/0004-platform-invariants-for-multi-tenant-fabric.md`](decisions/0004-platform-invariants-for-multi-tenant-fabric.md)

---

### I18: Surface State Machine-Readability

**Invariant**: Every `AtlasSurface` MUST expose its state via the surface-contract introspection API ([`frontend/surface-introspection.md`](frontend/surface-introspection.md)). State exposure is prod-safe and authz-gated, not a dev-only test affordance.

**Semantics**:
- Every surface implements `getSurfaceSnapshot(): { surfaceId, state, schemaRef?, data, actions[] }`
- A surface registry (`/api/v1/surfaces`) returns manifests for every surface so an agent can enumerate without driving the UI
- Snapshot exposure is gated by the same authz rules as the surface itself; an agent sees what the calling principal would see
- Surfaces rendering tenant-defined entity types (per [ADR 0005](decisions/0005-custom-schema-storage-strategy.md)) carry a `dataSchema: { kind: "tenant-defined", schemaRef }` field

**Purpose**: ADR 0003 §3 codified machine-readable surfaces as a load-bearing tenet. The existing `surface-contract.md` is a design-time author contract; I18 promotes runtime introspection to a platform invariant.

**Violation**: A new surface ships without a surface-contract entry or without implementing the introspection API.

**Source**: [`decisions/0004-platform-invariants-for-multi-tenant-fabric.md`](decisions/0004-platform-invariants-for-multi-tenant-fabric.md), [`frontend/surface-introspection.md`](frontend/surface-introspection.md)

---

<!-- I19 reserved for "Kernel State Machine-Readability" per tickets/atlas-on-atlas/stage-4-kernel-observability-invariant.md (status: scoped). Do not reuse the id. -->

### I20: Operator Feature Delivery Is an Intent

**Invariant**: Any change that becomes visible to a tenant end-user — new behavior, new surface, new policy, new schema, new function, new workflow, new content — MUST reach them via a tenant intent or platform-data change. A change that requires kernel restart to become user-visible is a category violation and triggers the [Kernel Touch Retrospective](crosscut/always-on.md#§11-kernel-touch-retrospective).

**Semantics**:

- Operator perspective, not system perspective. [I1–I18 + `always-on.md` §2](crosscut/always-on.md#§2-what-is-restart-required-the-kernel) name what is structurally kernel; I20 names the operator's contract: *"I never restart Atlas to ship a feature."*
- "Tenant intent" = anything the canonical intent pipeline can carry (a write through `submitIntent`, a policy bundle bump, a schema mutation, a function upload, a DSL declaration, a workflow trigger). See [`crosscut/runtime-instruction-set.md`](crosscut/runtime-instruction-set.md).
- "Platform-data change" = anything in the data plane catalogued at [`always-on.md` §3](crosscut/always-on.md#§3-what-is-data-hot-changeable-today) — Cedar policies, schemas, functions, declarations, log levels, custom-domain mapping, idempotency-key store, cache contents.
- Restart for a Node / OS / container upgrade is **not** a violation (per [`always-on.md` §8](crosscut/always-on.md#§8-out-of-scope)). Restart to ship a tenant-visible feature **is**.
- The boundary: if a tenant or end-user would notice the change before vs. after the restart, the restart is the violation. If only an operator would notice (e.g., a Node version, a TLS cert), it is not.

**Purpose**: ADR 0008 ([`decisions/0008-atlas-on-atlas.md`](decisions/0008-atlas-on-atlas.md)) committed to the recursive-kernel principle; `always-on.md` named the kernel surface and the staged path; I20 names the operator-visible commitment that those two together imply. Without I20, the kernel boundary can creep: each individual restart looks defensible in isolation, but the cumulative effect is a system whose feature delivery requires downtime. I20 makes every restart-to-ship-a-feature a category-level event with a required follow-up.

**Violation**: A feature change ships that requires `apps/server` to be restarted (or any other process in the kernel surface — see [`always-on.md` §2](crosscut/always-on.md#§2-what-is-restart-required-the-kernel)) to become user-visible, and no `tickets/kernel-extraction/<slug>.md` retrospective is filed naming the category, the missing seam, and the extraction plan.

**Effective**: I20 is **normative-from-publication, gate-enforced from [`always-on.md` §6 Phase 7](crosscut/always-on.md#§6-staged-path)** (kernel-migration merge). Until Phase 7 lands, the retrospective is **required** for every kernel touch (architect-gated), but the invariant itself does not block merge — several stages of unavoidable kernel work must ship first. From Phase 7 onward, the invariant blocks merge for any change that violates it without an accompanying extraction-plan ticket.

**Source**: [`decisions/0008-atlas-on-atlas.md`](decisions/0008-atlas-on-atlas.md), [`crosscut/always-on.md` §11](crosscut/always-on.md#§11-kernel-touch-retrospective)

---

## Architecture Planes

### Control Plane

**Purpose**: Admin control plane for tenant lifecycle, module management, policy administration, and support tooling.

**Exposure**: Internal admin-only
**Data Scope**: Cross-tenant (restricted by admin RBAC)

**Responsibilities**:
- Tenant provisioning, migration, backup/restore, quarantine, deletion
- Module enablement/disablement per tenant
- Policy and role management UIs
- Support tooling: event replay, projection rebuild, audit export
- Observability dashboards

### Tenant Runtime Plane

**Purpose**: Tenant-scoped runtime for processing user actions, executing use cases, emitting events, updating projections, and serving queries.

**Exposure**: External (via ingress gateway only)
**Data Scope**: Single tenant per request

**Responsibilities**:
- Ingress gateway: tenant resolution, authN/authZ, dispatch
- Event collector: schema validation, idempotency checks, enqueue
- Application runtime: command handling, domain logic, outbox writes
- Projection workers: consume events, update read models, emit cache invalidations
- Query APIs: serve cached projections

### Consumers Plane

**Purpose**: Independent worker processes for background jobs with at-least-once delivery semantics.

**Exposure**: Internal
**Data Scope**: Tenant-scoped per job

**Responsibilities**:
- Process queued jobs (notifications, exports, projection rebuilds)
- Idempotent execution with retry/DLQ
- Emit job completion events
- Audit and metrics logging

## Bounded Contexts

### Platform Core

Owns foundational types and invariants:
- Tenant context and principal model
- Action/resource identity model
- Cedar authorization engine (RBAC + ABAC)
- Cedar schema for entity types and actions
- Cache policy registry and key builder
- Audit event schema
- Error taxonomy
- Result monad for error handling

### Module System

Owns module lifecycle and capability enforcement:
- Module manifest schema and registry
- Per-tenant module enablement
- Capability sandboxing
- Module version compatibility checks

### Content Pages

Owns page composition:
- **Page**: Container with layout and metadata
- **WidgetInstance**: Widget placement on a page
- **WidgetInstanceSettings**: Widget configuration (schema + payload)
- **WidgetType**: Widget type definitions with settings schema

Projections:
- **RenderPageModel**: Denormalized page + widgets + settings for frontend rendering

### Workflow

Owns workflow orchestration:
- **WorkflowDefinition**: Graph-based workflow template
- **WorkflowInstance**: Active workflow execution
- **Task**: Work item assigned to a user or system
- **Transition**: State change rules

### Observability & Audit

Owns logging, tracing, and audit:
- Structured log schema with required tenant/principal/correlation fields
- Trace context propagation across services and queues
- Immutable audit stream with queryable export
- Retention policies (tenant-configurable)

### Tenant Ops

Owns tenant lifecycle:
- Provision: create tenant database, apply migrations, initialize data
- Migrate: expand/contract migrations with batched rollout
- Backup/Restore: point-in-time recovery, restore to new tenant
- Clone: optionally anonymized tenant copy for testing
- Quarantine: isolate tenant for security/compliance
- Delete: permanent tenant removal with audit trail

## Tenancy Model

**Database-per-Tenant**: Each tenant has a dedicated database for:
- Write model tables
- Read model tables (projections)
- Outbox (transactional event publish)
- Module-specific tables

**Control Plane Database**: Single shared database for:
- Tenant registry
- Module registry
- Schema registry
- Policy store
- Ops run history

**Tenant Context Resolution**: Ingress gateway extracts `tenantId` from:
- Subdomain (e.g., `tenant123.platform.example.com`)
- Custom domain mapping (DNS → tenant lookup)
- API key prefix or JWT claim

Once resolved, `TenantContext` is attached to the request and flows through all downstream processing.

## Tenant Runtime Isolation

The Tenancy Model above covers **data-layer** isolation (per-tenant DB, control-plane DB, tenant-context propagation). Open public signup with mutually-distrusting tenants on a shared instance ([ADR 0003](decisions/0003-tenant-defined-data-model-pivot.md), REQ-ISO-001) raises the bar: isolation must also hold at the **runtime layer** — process boundaries, network egress, schema mutations, and tenant-authored code execution.

**Threat model**: any two tenants on the same Atlas deployment are mutually distrusting. The operator is not a fallback for isolation failures; the platform must hold against adversarial signup, adversarial code, and adversarial workload.

### Tenant code never executes in `apps/server`

Per **I14**, tenant-authored functions (Extensibility/`functions`) execute only via the `FunctionRuntime` port whose adapter runs out-of-process. The MVP adapter is gVisor-backed k8s Jobs ([ADR 0006](decisions/0006-function-runtime-substrate.md)) — `runsc` intercepts syscalls and refuses fs/net access except via host-mediated context.

The `apps/server` Node process never imports tenant code, never `eval`s tenant code, never spawns tenant code as a child process. Tenant code lives in a separate cluster namespace (`atlas-fn-<tenantId>`) with default-deny NetworkPolicy.

### Tenant declarations vs tenant code

Atlas distinguishes three execution categories ([ADR 0007](decisions/0007-dsl-substrate-and-authoring-contract.md)):

| Category | Authored by | Executes in | Boundary |
|---|---|---|---|
| **Platform code** | Atlas maintainers | `apps/server`, `apps/projection-worker`, adapters | hexagonal layering |
| **Tenant declarations** | Tenants (DSL artifacts: templates, queries, formulas, validations) | `apps/server` via platform DSL evaluator | ADR 0007 §2 contract |
| **Tenant code** | Tenants (`functions`) | `FunctionRuntime` adapter, out-of-process | I14, I15 |

Tenant declarations execute in-process because the ADR 0007 contract makes them safe to: non-Turing-complete (or provably-bounded), pure with respect to host state, no ambient I/O, deterministic, and bounded by step + wall-clock budgets enforced by the substrate. Egress (I15) is impossible by construction — DSLs have no syntax for outbound network. Effectful host operations route back through existing ports (`EntityStore` / `SchemaDefinitionStore` for object reads, `FunctionRuntime` for function calls); the boundary respects I14 / I15 / I16 at the call site.

A DSL that cannot satisfy the §2 contract is tenant code by definition and goes through `FunctionRuntime`. The carve does not weaken I14; it names what I14 was always about.

### Egress mediation

Per **I15**, every outbound network call from tenant code traverses the egress port. The egress proxy:

- Audits the call (`Audit.EgressCalled` with `correlationId`, `tenantId`, host, byte counts).
- Charges the tenant's `egress-bytes` and `egress-requests-per-window` quotas.
- Enforces an allowlist / denylist policy per tenant (default-deny on unconfigured destinations, with operator-tunable defaults).
- Strips host-side credentials from outbound headers; tenants supply their own credentials via the secrets domain.

This is the outbound counterpart of I1's single-ingress rule for inbound traffic.

### Schema-mutation scope

Per **I16**, tenant-defined schema mutations (`custom-schema`) are confined to:

- The issuing tenant's database (`atlas_t_<tenantUuid>` per [ADR 0005](decisions/0005-custom-schema-storage-strategy.md)). Tables live in `public` inside that database; platform-owned tables carry the `_atlas_` prefix.
- A constrained DDL allowlist (`CREATE TABLE`, `ADD COLUMN`, `CREATE INDEX`, safe `ALTER COLUMN`, `DROP COLUMN`, `DROP TABLE`).

The migration applier port asserts the target connection resolves to the issuing tenant's database; cross-database references and forbidden DDL (`CREATE DATABASE`, `DROP DATABASE`, `CREATE EXTENSION`, triggers, role manipulation) are rejected before any SQL executes.

Each tenant's runtime role has CRUD privileges only on its own database's tables (no `CREATE` rights — all DDL goes through the platform's provisioner role); cross-tenant queries are impossible at the protocol layer because Postgres does not let one session attach to two databases.

### Compute-layer isolation

Per [ADR 0006](decisions/0006-function-runtime-substrate.md) and `compute-owner`'s scoping for the Compute platform:

- **Namespace per tenant** for runtime workloads (`atlas-rt-<tenantId>`) and for tenant-function execution (`atlas-fn-<tenantId>`). Distinct namespaces so a tenant function cannot pod-exec into the tenant's own deployment.
- **Default-deny `NetworkPolicy`** at namespace creation: egress to other tenant namespaces, the k8s API, cloud metadata (`169.254.169.254`), and node-local services blocked. Egress to the public internet only via the egress proxy.
- **`PodSecurityStandard: restricted`** enforced at admission: no privileged, no hostPath, no hostNetwork, runAsNonRoot, seccomp `RuntimeDefault`, drop ALL capabilities.
- **`ResourceQuota` + `LimitRange`** applied at namespace creation, not deploy-time. Hard caps on pods, CPU, memory, ephemeral-storage, PVC count, NodePort/LoadBalancer = 0.
- **`RuntimeClass: gvisor`** required for tenant-function pods; admission rejects function pods without it.
- **ServiceAccount** scoped to the namespace; auto-mount disabled by default.

### Logging isolation

Per [`crosscut/logging.md`](crosscut/logging.md) and the agentic-first observability tenet (REQ-AGENT-001):

- No single log line may reference more than one `tenantId`. Aggregations and overflow meta-logs are either tenant-scoped (one line per tenant) or operator-scoped with `tenantId` omitted entirely — never a list of tenants.
- Tenant code logs only through the host-provided `ctx.logger`; direct stdout from tenant code is captured at `info` with `source: 'tenant-stdout'` and the runner stamps `tenantId` / `principalId` / `correlationId` (tenant code cannot forge these fields).
- Cross-tenant log retrieval surfaces (operator dashboards) require operator principal scope; tenant principals see only their own log stream.

### Quota enforcement

Per **I13**, every mutating handler calls `quotaService.check(tenantId, dimension, delta)` after authz and before any side effect. Over-budget tenants are rejected with `QUOTA_EXCEEDED`. The five MVP-blocking dimensions (per `commerce-owner`):

- `signups-per-window` (per source IP and per email domain) — gates signup itself
- `cpu-seconds` — gates compute deployments and function invocations
- `storage-bytes` — gates object/block storage writes
- `function-invocations` — gates `functions` invocation rate, CPU-time, memory-time
- `egress-bytes` — gates outbound network usage from tenant code

Quotas are per-tenant; an over-budget tenant's hard-block path must not block the quota-check hot path for other tenants (cache-tag invalidation on aggregation commit, never global locks).

### What this section is not

Tenant runtime isolation is the platform's responsibility against the mutual-distrust threat model. It is not:

- **A substitute for tenant secret hygiene.** A tenant whose admin user's password is "password" can still be compromised; that's tenant-side.
- **A guarantee against side-channel attacks below the gVisor / kernel boundary.** Spectre-class CPU side channels are mitigated at hypervisor / kernel level; Atlas trusts the host kernel and the gVisor `runsc` boundary.
- **A guarantee against operator compromise.** A compromised operator can read any tenant's data — the audit log will show it, but the platform doesn't pretend to defend against the operator.

## Authentication & Authorization

### Authentication (AuthN)

The ingress gateway normalizes authentication results into a **Principal** object:

```typescript
interface Principal {
  principalId: PrincipalId;
  tenantId: TenantId;
  userId: UserId;
  roles: string[];
  attributes: Record<string, unknown>;
  authnProvider: string;
  sessionId?: string;
  issuedAt: Date;
}
```

Supported providers:
- OIDC (OpenID Connect)
- SAML
- API keys (for service-to-service)

User provisioning via SCIM for enterprise SSO.

### Authorization (AuthZ)

**Model**: Cedar-based hybrid RBAC + ABAC

**Cedar Policy Language**: Industry-standard authorization from AWS
- Expressive policy syntax for RBAC and ABAC
- Forbid-overrides-permit semantics (deny-overrides-allow)
- Type-safe policy validation with Cedar schema

**RBAC**: Roles map to permissions via Cedar policies
- `principal in Role::"admin"` matches admin principals
- Coarse-grained role-based access control

**ABAC**: Cedar policies evaluate attributes
- Principal attributes (department, clearance, etc.)
- Resource attributes (owner, sensitivity, etc.)
- Context/Environment (time, region, IP, tenantStatus, etc.)

**Evaluation**:
1. Ingress gateway calls `authorize(principal, action, resource, context)`
2. Cedar authorizer retrieves active policy set for tenant
3. Evaluates Cedar policies against request (principal, action, resource, context)
4. Returns Decision (permit/forbid + reason + matched policy IDs)
5. **Forbid overrides permit**: if any forbid policy matches, access is denied
6. Default is deny if no permit policies match

**Enforcement Points**:
- Ingress gateway (pre-dispatch)
- Application handlers (in-process re-check)

**Break-Glass Access**:
- Time-bound grants for emergency access
- Requires explicit audit trail
- Auto-expiry enforced

## Event Model

### Event Categories

**UI Intent Events**: User actions from frontend
- Example: `ContentPages.PageCreateRequested`
- Validated at ingress, enqueued for processing

**Domain Events**: State change facts
- Example: `ContentPages.PageCreated`
- Emitted by command handlers, published via outbox
- Drive projection updates and cache invalidation

**System Events**: Platform lifecycle
- Example: `TenantOps.TenantProvisioned`, `ModuleSystem.ModuleEnabledForTenant`

**Audit Events**: Security and compliance
- Example: `Audit.AuthzDecisionRecorded`, `Audit.PolicyChanged`

### Event Envelope

All events share a common envelope:

```typescript
interface EventEnvelope<T> {
  eventId: string;           // UUID
  eventType: string;         // Namespace.Domain.Event
  schemaId: string;          // Schema identifier
  schemaVersion: number;     // Schema version
  occurredAt: Date;          // Event timestamp
  tenantId: TenantId;        // Tenant context
  principalId?: PrincipalId; // Actor (if user-initiated)
  userId?: UserId;           // User (if applicable)
  correlationId: string;     // Request trace
  causationId?: string;      // Causal event ID
  idempotencyKey: string;    // Deduplication key (required)
  payload: T;                // Event-specific data
}
```

**Schema Registry**: Events declare schema ID and version. Registry validates compatibility and provides upcasters/downcasters for version migration.

**Idempotency**: All event processing is idempotent via `idempotencyKey`. Duplicate events (retries) are ignored.

## Caching Strategy

### Cache Key Convention

Format: `{tenantId}:{artifactKind}:{artifactId}:{varyHash}:{versionToken}`

**Required dimensions**:
- `tenantId` (always, unless PUBLIC)
- `artifactKind` (e.g., RenderPageModel, PolicyCompiled)
- `artifactId` (unique identifier)

**Optional dimensions**:
- `varyHash`: hash of vary dimensions (locale, role, user, ABAC context)
- `versionToken`: invalidation token

### Vary-By Strategies

- `TENANT`: One cache entry per tenant
- `LOCALE`: Separate entry per language/region
- `ROLE`: Separate entry per role
- `USER`: Separate entry per user (high cardinality, use sparingly)
- `ABAC_CONTEXT`: Separate entry per permission context (extreme cardinality, avoid if possible)
- `NONE`: Single global entry (PUBLIC artifacts only)

### Privacy Levels

- `PUBLIC`: No tenant data, safe to share globally
- `TENANT`: Scoped to tenant, safe for any user in tenant
- `USER`: Scoped to specific user
- `ROLE_SCOPED`: Scoped to users with specific role

### Invalidation

**Tag-Based Invalidation**: Events declare tags for affected entities:
- `Tenant:{tenantId}`
- `Page:{pageId}`
- `WidgetInstance:{widgetInstanceId}`
- `User:{userId}`

When `ContentPages.PageCreated` is published, cache service invalidates all entries tagged with `Tenant:{tenantId}` and `Page:{pageId}`.

**Version Tokens**: Bump token to invalidate all entries using that token (e.g., policy compilation cache on policy update).

### Stampede Protection

For expensive projections (RenderPageModel, complex queries):
- **Singleflight**: Concurrent requests for same key block on first computation
- **Soft TTL + Background Refresh**: Serve stale while refreshing in background
- **Lock with Timeout**: Distributed lock to serialize recomputation

## Ingress Chokepoint Rules

The ingress gateway is the **only** external entry point. It enforces:

1. **Tenant Resolution**: Extract `tenantId` from subdomain/header/JWT
2. **AuthN**: Verify token and normalize to Principal
3. **Schema Validation**: UI intent events validated against schema
4. **AuthZ**: `authorize(principal, action, resource, environment)` before dispatch
5. **Action Registry Dispatch**: Only registered actions may be invoked
6. **Correlation ID**: Assign or propagate `correlationId` for tracing
7. **Structured Logging**: Log request with tenantId, principalId, actionId
8. **Rate Limiting**: Per-tenant quotas enforced
9. **Audit**: Sensitive actions logged to audit stream

**Invariant**: No business logic executes before these checks pass.

## Operational Expectations

### Migrations

**Expand/Contract Pattern**:
1. **Expand**: Add new schema elements (nullable columns, new tables)
2. **Migrate Data**: Backfill in batched background jobs
3. **Contract**: Remove old schema elements after migration completes

**Tenant-Batched Rollout**:
- Migrations run per tenant
- Canary tenants first, then gradual rollout
- Pause/resume/rollback controls
- Auto-rollback on SLO breach

### Disaster Recovery

**Backup**:
- Continuous backup per tenant database
- Point-in-time recovery (PITR) to 15-minute RPO
- Backup encryption with per-tenant encryption context

**Restore**:
- Restore to same tenant or new tenant
- Anonymized clone for testing/debugging
- Legal hold support for compliance

**RTO/RPO Targets** (placeholders):
- RPO: 15 minutes
- RTO: 60 minutes

### Audit

**Immutable Audit Stream**:
- Append-only log of sensitive actions
- Required fields: timestamp, tenantId, principalId, actionId, resourceId, decision, reason
- Queryable by tenant admins (with RBAC)
- Exportable for compliance (JSON, CSV, etc.)

**Always Audited**:
- Policy changes
- Break-glass access grants
- Role changes
- AuthZ denials for sensitive actions

**Retention**:
- Tenant-configurable (default: 1 year)
- Legal hold prevents deletion

### Observability

**Structured Logging**:
- JSON format with required fields: timestamp, level, tenantId, userId, principalId, moduleId, actionId, resourceType, resourceId, correlationId, traceId, spanId
- Centralized aggregation

**Distributed Tracing**:
- Trace context propagated via HTTP headers, message bus headers, queue job envelopes
- Spans: ingress, authorize, handle_command, persist, outbox_publish, project, enqueue_job, consume_job

**Metrics**:
- SLO candidates: p95/p99 ingress latency, event-to-projection lag, queue depth, job success rate, authz denial rate
- Per-tenant quotas and usage tracking

## How to Extend the Platform

### Adding a New Module

1. **Define Module Manifest** (`module.manifest.json`):
   - Declare actions, resources, events, projections, migrations, UI routes, jobs, cache artifacts, capabilities

2. **Register Module**: Submit manifest to module registry via control plane API

3. **Implement Domain Logic**:
   - Write command handlers that emit domain events
   - Write projection workers that consume events and update read models
   - Declare cache artifacts with varyBy/privacy/ttl/tags

4. **Implement UI Routes**: Frontend routes declared in manifest, routed by ingress

5. **Enable for Tenants**: Control plane enables module for specific tenants

6. **Test**:
   - Unit tests for domain logic
   - Integration tests for event flow (command → event → projection → query)
   - Spec tests validate manifest against schema

### Module Manifest Example

```json
{
  "moduleId": "content-pages",
  "displayName": "Content Pages",
  "version": "1.0.0",
  "actions": [
    {
      "actionId": "ContentPages.Page.Create",
      "resourceType": "Page",
      "verb": "create",
      "auditLevel": "SENSITIVE"
    }
  ],
  "resources": [
    {
      "resourceType": "Page",
      "attributeSchemaId": "page.attributes.v1",
      "ownership": "module"
    }
  ],
  "events": [
    {
      "eventType": "ContentPages.PageCreated",
      "category": "DOMAIN",
      "schemaId": "domain.contentpages.page.created.v1",
      "compatibility": "BACKWARD"
    }
  ],
  "projections": [
    {
      "projectionName": "RenderPageModel",
      "inputEvents": ["ContentPages.PageCreated", "ContentPages.WidgetInstanceAdded"],
      "outputModel": "render_page_json",
      "rebuildable": true
    }
  ],
  "migrations": [],
  "uiRoutes": ["/pages", "/pages/:pageId"],
  "jobs": [
    {
      "jobType": "ContentPages.RebuildRenderPageModel",
      "schemaId": "job.contentpages.rebuild.renderpage.v1"
    }
  ],
  "cacheArtifacts": [
    {
      "artifactId": "RenderPageModel",
      "varyBy": ["TENANT", "LOCALE", "ROLE"],
      "ttlSeconds": 300,
      "tags": ["Tenant:{tenantId}", "Page:{pageId}"],
      "privacy": "TENANT"
    }
  ],
  "capabilities": ["page-composition", "widget-management"]
}
```

### Capability Enforcement

Platform enforces:
- Actions not in manifest cannot be invoked
- Events not in manifest cannot be published
- Projections must declare input events
- Cache artifacts must declare privacy + varyBy
- UI routes must be declared for routing

This prevents modules from:
- Exposing undeclared APIs
- Publishing unknown events
- Accessing cross-tenant data
- Bypassing authZ checks

## Data Stores

### Control Plane Database

**Purpose**: Global platform metadata
**Contains**: Tenants, ModuleRegistry, PolicyStore, SchemaRegistry, OpsRuns

### Tenant Databases

**Purpose**: Per-tenant isolation
**Contains**: WriteModelTables, ReadModelTables, Outbox, ModuleTables, WorkflowTables

### Distributed Cache

**Purpose**: Cross-instance cache for render models and expensive queries
**Implementation**: Adapter-based (Redis, Memcached, etc.)

### Queue

**Purpose**: Background job transport with retries and DLQ
**Delivery**: At-least-once semantics

### Message Bus

**Purpose**: Event distribution for domain events, audit, system topics
**Implementation**: Adapter-based (Kafka, RabbitMQ, etc.)

## Ports & Adapters

### Ports

- **TenantDbPort**: Tenant database access (connection pooling, transactions, queries)
- **OutboxPort**: Outbox append and drain
- **MessageBusPort**: Pub/sub for events
- **QueuePort**: Job enqueue, lease, ack, nack
- **CachePort**: Get, set, invalidate by key/tags, version tokens
- **AuthNPort**: Token verification, Principal normalization
- **PolicyStorePort**: Policy CRUD
- **AuditSinkPort**: Audit event append, query, export
- **MetricsPort**: Counter, histogram, gauge
- **TracePort**: Span management, context propagation

### Adapters

- **http_gateway_adapter**: Only external HTTP entry point (dispatches via action registry)
- **tenant_db_adapter_sql**: DB-per-tenant connection pooling + migrations
- **message_bus_adapter**: Topic-based pub/sub
- **queue_adapter**: At-least-once job delivery
- **cache_adapter_local**: Small TTL caches for hot lookups
- **cache_adapter_distributed**: Tenant-scoped artifacts, render models
- **cache_adapter_edge_optional**: Public responses via CDN
- **audit_sink_adapter**: Immutable append-only audit stream
- **authn_adapter**: OIDC/SAML verification + Principal normalization

## Compliance

### Data Residency

- Tenant region pinning: Tenant data stored in specified region
- Support access: Audited + break-glass only

### Retention

- Tenant-configurable retention policies
- Legal hold prevents deletion

### Encryption

- In-transit: TLS everywhere
- At-rest: Database encryption
- Per-tenant encryption context
- Customer-managed keys (optional)

### PII

- Field-level PII classification
- DSAR export (data subject access request)
- Delete workflow (right to be forgotten)

## Release Engineering

### Progressive Delivery

- Canary deployments
- Cohort rollout by tenant
- Feature flags for gradual enablement

### Supply Chain

- Signed artifacts
- SBOM (software bill of materials)
- Provenance tracking

### Compatibility

- Schema registry enforces backward compatibility
- Manifest versioning enforced
- Expand/contract migrations for breaking changes

## SLO Targets (Placeholders)

- **Ingress latency (p95)**: 150ms
- **Ingress latency (p99)**: 400ms
- **Event-to-projection lag (p95)**: 5 seconds
- **Job success rate**: 99.9%
- **RPO**: 15 minutes
- **RTO**: 60 minutes

## Summary

This platform enforces strict invariants through architectural principles:

1. **Single ingress chokepoint** prevents unauthorized access
2. **Policy-first authZ** centralizes security decisions
3. **Event-sourced writes** provide audit trails and rebuild capability
4. **Projections** optimize reads while maintaining consistency
5. **Cache-first** reduces latency and database load
6. **Module manifests** govern capabilities and prevent unauthorized behavior

Extensibility comes from **declarative module manifests** that integrate with platform enforcement. Operational excellence comes from **structured observability**, **expand/contract migrations**, and **disaster recovery** capabilities.
