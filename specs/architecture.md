# Enterprise Multi-Tenant CMS + Workflow Platform

**Version:** 0.1.0
**Architecture:** Hexagonal, Event-Driven, Policy-First AuthZ
**Tenancy Model:** Database-per-Tenant
**Timezone:** America/Chicago

## Purpose

This platform provides a multi-tenant content management and workflow orchestration system designed for enterprise-scale operations. It enforces strict security boundaries through centralized authorization, maintains tenant isolation through dedicated databases, and supports horizontal scaling through event-driven architecture and cache-first design.

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

**Purpose**: Enables projection version upgrades, bug fixes, and disaster recovery.

**Violation**: If projections depend on non-event state, rebuilds fail or produce incorrect data.

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
