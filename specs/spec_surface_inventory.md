# Spec Surface Inventory (Pass 0)

**Date:** 2026-01-07
**Purpose:** Comprehensive inventory of all spec artifacts in `/specs` as they exist, freezing the current surface area for compiler input definition.
**Scope:** Descriptive only — no proposals, refactors, or design changes.

**Normative Requirements:** For compiler-enforced requirements using RFC 2119 keywords (MUST, SHOULD, MAY), see `/specs/normative_requirements.md`. This inventory document is informative only.

---

## Change Log (Pass 0 Revision)

**Removed:**
- Section 6.6 "Recommendations for Compiler Author" (prescriptive content)
- Prescriptive language ("should", "must" in advisory context)

**Added:**
- Provenance citations (Evidence) for all implicit rules, defaults, and assumptions
- Certainty level classifications (Observed, Inferred, Assumed) in Section 4

**Modified:**
- Section 4 "Implicit Rules" — restructured with explicit evidence citations
- Section 4.5 "Default Values" — moved to Section 4.6 with provenance
- All "implicit assumptions" statements now categorized by certainty level

---

## 1. File Inventory

### 1.1 Root-Level Documentation

| Path | Type | Primary Purpose |
|------|------|----------------|
| `README.md` | Documentation | Explains structure, reading order, how to add specs |
| `index.md` | Documentation | Landing page with navigation guide for different personas |
| `SUMMARY.md` | Navigation manifest | mdBook table of contents defining document hierarchy |
| `glossary.md` | Terminology reference | Core concept definitions (Tenant, Intent, Token, etc.) |
| `architecture.md` | Architecture specification | Complete system architecture: principles, invariants, bounded contexts, ports/adapters |
| `error_taxonomy.json` | Error code registry | Structured error codes with categories (VALIDATION, AUTHZ, TENANT, etc.) |

### 1.2 Cross-Cutting Concerns

| Path | Type | Primary Purpose |
|------|------|----------------|
| `crosscut/events.md` | Pattern specification | Event vocabulary, flow patterns, consumption across modules |
| `crosscut/security.md` | Pattern specification | Role-based access patterns, permission model |
| `crosscut/storage.md` | Pattern specification | File/media storage privacy model, placeholder behavior |
| `crosscut/tenancy.md` | Pattern specification | Tenant boundary rules, data isolation, configuration scope |

### 1.3 Module Specifications

Each module follows pattern: `modules/<module-name>/{README.md, surfaces.md, events.md}`

| Module | Files | Primary Purpose |
|--------|-------|----------------|
| `modules/audit/` | README.md, surfaces.md, events.md | Intent history tracking and querying |
| `modules/badges/` | README.md, surfaces.md, events.md | Badge award system based on intents/roles |
| `modules/comms/` | README.md, surfaces.md, events.md | Email templates, messaging, notifications |
| `modules/content/` | README.md, surfaces.md, events.md | Announcements widget and media library |
| `modules/import/` | README.md, surfaces.md, events.md | Spreadsheet upload and validation |
| `modules/org/` | README.md, surfaces.md, events.md | Business unit management |
| `modules/points/` | README.md, surfaces.md, events.md | Point system configuration and tracking |
| `modules/tokens/` | README.md, surfaces.md, events.md | Token registry and evaluation |

**Additional file:**
- `modules/content-pages.json` — Module manifest example for content-pages module

### 1.4 Schema Specifications

| Path | Type | Primary Purpose |
|------|------|----------------|
| `schemas/README.md` | Documentation | Explains conceptual schema purpose and maintenance |
| `schemas/audit.md` | Conceptual schema | Data model for Intent entity |
| `schemas/badges.md` | Conceptual schema | Data models for BadgeDefinition, BadgeAward |
| `schemas/comms.md` | Conceptual schema | Data models for EmailTemplate, EmailNotification, Message |
| `schemas/content.md` | Conceptual schema | Data models for MediaFile, FileCategory, AnnouncementWidgetConfig |
| `schemas/import.md` | Conceptual schema | Data models for SpreadsheetUpload, ValidationResult |
| `schemas/org.md` | Conceptual schema | Data models for BusinessUnit, Membership |
| `schemas/points.md` | Conceptual schema | Data models for PointsConfig, UserPointBalance, PointTransaction |
| `schemas/tokens.md` | Conceptual schema | Data models for TokenDefinition |

### 1.5 JSON Schema Contracts

| Path | Type | Primary Purpose |
|------|------|----------------|
| `schemas/contracts/event_envelope.schema.json` | JSON Schema | Common envelope for all events (domain, UI intent, system, audit) |
| `schemas/contracts/module_manifest.schema.json` | JSON Schema | Module capability declaration and governance manifest |
| `schemas/contracts/policy_ast.schema.json` | JSON Schema | Cedar policy representation for authorization rules |
| `schemas/contracts/cache_policy.schema.json` | JSON Schema | Cache artifact descriptor with varyBy, privacy, invalidation rules |
| `schemas/contracts/search_document.schema.json` | JSON Schema | Indexed search document with permission attributes |
| `schemas/contracts/search_query.schema.json` | JSON Schema | Search query with execution context for tenant isolation |
| `schemas/contracts/analytics_event.schema.json` | JSON Schema | Analytics event for time-series aggregation |
| `schemas/contracts/analytics_query.schema.json` | JSON Schema | Time-bucketed analytics query with dimension grouping |

### 1.6 Fixtures (Golden Test Data)

| Path | Type | Primary Purpose |
|------|------|----------------|
| `fixtures/README.md` | Documentation | Explains fixture purpose, usage, maintenance |
| `fixtures/valid_event_envelope.json` | Example | Valid event envelope with all required fields |
| `fixtures/invalid_event_envelope_missing_idempotency.json` | Counter-example | Invalid envelope demonstrating missing idempotencyKey |
| `fixtures/sample_module_manifest.json` | Example | Complete module manifest (content-pages) |
| `fixtures/sample_policy_bundle.json` | Example | Cedar policy bundle demonstrating forbid-overrides-permit |
| `fixtures/sample_page_create_intent.json` | Example | UI intent envelope for page creation |
| `fixtures/expected_page_created_event.json` | Example | Domain event after authorization |
| `fixtures/search_documents.json` | Example | Indexed documents with permission attributes |
| `fixtures/search_query.json` | Example | Search query with execution context |
| `fixtures/expected_search_results_filtered.json` | Example | Search results after permission filtering |
| `fixtures/analytics_events.json` | Example | Analytics events derived from domain events |
| `fixtures/analytics_query.json` | Example | Time-bucketed aggregation query |
| `fixtures/expected_analytics_buckets.json` | Example | Time-aligned buckets with dimension grouping |

---

## 2. Surface Area Extraction

### 2.1 Architecture Document (architecture.md)

**Top-Level Sections:**
- Version, Architecture style, Tenancy model, Timezone
- Core Principles (P1-P6): Ingress chokepoint, Policy-first authZ, Event-sourced writes, Reads from projections, Cache-first, Module governance
- Core Invariants (I1-I12): Single ingress enforcement, Authorization precedes execution, Idempotency, Deny-overrides-allow, Correlation propagation, Causation linkage, Tenant isolation in search, Permission-filtered search, Cache keys include tenantId, Event-driven cache invalidation, Deterministic time bucketing, Projections are rebuildable
- Architecture Planes: Control plane, Tenant runtime plane, Consumers plane
- Bounded Contexts: Platform core, Module system, Content pages, Workflow, Observability & audit, Tenant ops
- Tenancy Model: Database-per-tenant, Control plane database, Tenant context resolution
- Authentication & Authorization: Principal model, RBAC+ABAC, Evaluation flow
- Event Model: Categories (UI intent, domain, system, audit), Event envelope, Schema registry
- Caching Strategy: Key convention, Vary-by strategies, Privacy levels, Invalidation
- Ingress Chokepoint Rules: 9-step enforcement pipeline
- Operational Expectations: Migrations, Disaster recovery, Audit, Observability
- How to Extend: Adding new module, Module manifest example, Capability enforcement
- Data Stores: Control plane DB, Tenant DBs, Cache, Queue, Message bus
- Ports & Adapters: 15 port definitions, 9 adapter types
- Compliance: Data residency, Retention, Encryption, PII
- Release Engineering: Progressive delivery, Supply chain, Compatibility
- SLO Targets: Placeholders for ingress latency, event-to-projection lag, job success rate, RPO/RTO

**Referenced Entities:**
- Principal (principalId, tenantId, userId, roles, attributes, authnProvider, sessionId, issuedAt)
- EventEnvelope (eventId, eventType, schemaId, schemaVersion, occurredAt, tenantId, principalId, userId, correlationId, causationId, idempotencyKey, payload)
- Module Manifest (moduleId, displayName, version, actions, resources, events, projections, migrations, uiRoutes, jobs, cacheArtifacts, capabilities)
- TenantContext, ActionRegistry, PolicyStore, SchemaRegistry

**Explicit Constraints (from architecture.md):**
- Single ingress is the ONLY external entry point
- Authorization MUST occur before handler execution (no exceptions)
- Idempotency keys are globally unique within tenant
- Deny-overrides-allow is non-negotiable
- correlationId and causationId are mandatory for tracing
- tenantId is immutable once set
- All cache keys include tenantId unless explicitly PUBLIC
- Search results are always tenant-scoped and permission-filtered
- Time bucketing is deterministic (aligned to epoch + bucketSize)
- Projections can be rebuilt from events alone
- Outbox pattern is the ONLY way to publish events
- Database-per-tenant is the isolation mechanism
- No cross-tenant queries are allowed in user-facing features

### 2.2 Error Taxonomy (error_taxonomy.json)

**Top-Level Fields:**
- `version` (string)
- `errors` (array of error objects)

**Error Object Fields:**
- `code` (string) — Error code identifier
- `category` (enum) — VALIDATION, REGISTRY, TENANT, AUTHZ, AUTHN, RESOURCE, CACHE, PERSISTENCE, QUOTA
- `description` (string) — Human-readable description

**Enumerated Categories:** VALIDATION, REGISTRY, TENANT, AUTHZ, AUTHN, RESOURCE, CACHE, PERSISTENCE, QUOTA

**Observations:**
- Error codes appear unique across all categories (no duplicates observed in file)
- Categories are enumerated in the file (9 categories total)
- Each error has both machine code and human description

### 2.3 Glossary (glossary.md)

**Defined Terms (Core Concepts):**
Tenant, Tenant Admin, End User, Business Unit, Intent, Token, Email Template, Widget, Page, Point, Badge, Media Library, Spreadsheet Upload

**Defined Terms (System Constructs):**
Plane (Tenant Admin, End User, Control Plane), Dry Run, History

### 2.4 Module Specifications (Pattern Analysis)

**Standard Structure per Module:**
- **README.md**: Purpose, Responsibilities, Owned Data, Dependencies (Consumed Services, Consumed By), Runtime Behavior, Integration Points, Open Questions
- **surfaces.md**: UI surfaces (Widgets, Pages) with: Type, Plane, Purpose, Actors & Permissions, Inputs, Outputs, Owned Data, Dependencies, Rules/Invariants, Edge Cases, Acceptance Scenarios, TODO/Open Questions
- **events.md**: Intents Emitted, Intents Consumed, Event Integration, Open Questions

**Common Fields Across Modules (Observed):**
- tenant_id (present in all schema/*.md entity definitions)
- created_at, updated_at (lifecycle timestamps in schemas)
- IDs for entities (e.g., badge_id, file_id, token_id — observed pattern)
- actor/user references (uploader_id, creator_id, etc. — observed in schemas)

**Documented Patterns:**
- All module data is tenant-scoped (stated in crosscut/tenancy.md)
- "Admin only" vs "End user" is the primary permission boundary (crosscut/security.md)
- Intents are emitted for all state-changing actions (crosscut/events.md)
- Open Questions are numerous (present in all module specs)
- "TODO" markers are used for unresolved design questions (present in multiple files)

### 2.5 Conceptual Schemas (Pattern Analysis)

**Standard Structure per Schema:**
- Module Overview (data ownership, purpose)
- Entities (description, tenant scope, lifecycle, key fields, invariants)
- Relationships (internal, cross-module with cardinality)
- Derived/Computed Concepts
- Events & Audit Implications
- Open Questions

**Common Entity Patterns (Observed):**
- Tenant scope explicitly stated for every entity (all schemas/*.md)
- Lifecycle states: Created, Updated, Deleted (or append-only for audit)
- Mutability explicitly classified (mutable configuration vs. immutable history)
- Foreign key relationships described in prose, not formal notation
- "Possibly" and "unclear" are used to flag ambiguity

### 2.6 JSON Schema Contracts (Field-Level Analysis)

#### event_envelope.schema.json

**Required Fields:**
eventId, eventType, schemaId, schemaVersion, occurredAt, tenantId, correlationId, idempotencyKey, payload

**Optional Fields:**
principalId, userId, causationId

**Field Constraints:**
- eventId: string, pattern `^[a-zA-Z0-9_-]+$`, minLength 1
- eventType: string, pattern `^[A-Za-z0-9]+\.[A-Za-z0-9]+$`
- schemaId: string, pattern `^[a-z0-9.]+$`, minLength 1
- schemaVersion: integer, minimum 1
- occurredAt: string, format date-time
- tenantId: string, minLength 1
- correlationId: string, minLength 1
- idempotencyKey: string, minLength 1
- payload: object

#### module_manifest.schema.json

**Required Fields:**
manifestVersion, moduleId, displayName, version, moduleType

**Optional Fields:**
capabilities, actions, resources, events, projections, migrations, uiRoutes, jobs, cacheArtifacts

**Field Constraints:**
- manifestVersion: integer, enum [2]
- moduleId: string, pattern `^[a-z0-9-]+$`
- version: string, pattern `^[0-9]+\.[0-9]+\.[0-9]+$` (semver)
- moduleType: array of enum ["ui", "api", "worker", "projection", "hybrid"]

**Nested Object Schemas:**
- action: actionId, resourceType, verb, auditLevel (INFO|SENSITIVE)
- resource: resourceType, ownership (module|platform|external|shared)
- eventContract: eventType, category (UI_INTENT|DOMAIN|AUDIT|SYSTEM), schemaId, compatibility (BACKWARD|STRICT)
- projection: projectionName, inputEvents, outputModel, rebuildable (boolean)
- migration: migrationId, appliesTo (CONTROL_PLANE_DB|TENANT_DB), engine
- uiRoute: routeId, path, componentId, navLabel
- job: jobId, kind (SCHEDULED|EVENT_DRIVEN|AD_HOC), triggerEvent (if EVENT_DRIVEN), schedule (if SCHEDULED)
- cacheArtifact: artifactId, varyBy (array of TENANT|LOCALE|ROLE|USER|ABAC_CONTEXT|NONE), ttlSeconds, tags, privacy (PUBLIC|TENANT|USER|ROLE_SCOPED)

**Conditional Requirements (allOf):**
- If moduleType contains "ui", uiRoutes is required
- If moduleType contains "projection", projections is required
- If moduleType contains "worker", jobs is required
- If moduleType contains "api" or "hybrid", actions should have minItems 1

#### policy_ast.schema.json

**Top-Level Schema:**
policy object with: policyId, tenantId, rules (array), version (integer), status (active|inactive)

**Policy Rule:**
ruleId, effect (allow|deny), conditions (policyExpression), description (optional)

**Policy Expression (oneOf):**
- literal: type="literal", value (boolean)
- equals: type="equals", left (policyValue), right (policyValue)
- not: type="not", operand (policyExpression)
- and: type="and", operands (array of policyExpression)
- or: type="or", operands (array of policyExpression)

**Policy Value (oneOf):**
- literal: type="literal", value (string|number|boolean)
- attribute: type="attribute", path (string), source (principal|resource|environment)

#### cache_policy.schema.json

**Required Fields:**
artifactId, varyBy, ttlSeconds, tags, privacy

**Field Constraints:**
- varyBy: array of enum TENANT|LOCALE|ROLE|USER|ABAC_CONTEXT|NONE, uniqueItems
- ttlSeconds: integer, minimum 0, maximum 86400 (24 hours)
- privacy: enum PUBLIC|TENANT|USER|ROLE_SCOPED

**Definitions ($defs):**
- cacheKeyConvention: pattern `^[^:]+:[^:]+:[^:]+(?::[^:]+)?(?::[^:]+)?$` (format: {tenantId}:{artifactKind}:{artifactId}:{varyHash}:{versionToken})
- invalidationMechanisms: enum invalidateTags|bumpVersionToken
- stampedeProtectionStrategy: enum singleflight|soft_ttl_background_refresh|lock_with_timeout

#### search_document.schema.json

**Required Fields:**
documentId, documentType, tenantId, fields

**Optional Fields:**
permissionAttributes (oneOf: null or object with allowedPrincipals)

**Field Constraints:**
- fields: object, additionalProperties true (flexible schema)
- permissionAttributes:
  - null: public within tenant
  - object: allowedPrincipals (array of strings, minItems 1)

#### search_query.schema.json

**Required Fields:**
query, executionContext (with tenantId, principalId)

**Optional Fields:**
filters, executionContext.correlationId

#### analytics_event.schema.json

**Required Fields:**
eventId, eventType, tenantId, dimensions, metrics, timestamp, schemaId

**Field Constraints:**
- dimensions: object with string values (additionalProperties)
- metrics: object with number values (additionalProperties), minProperties 1
- schemaId: pattern `^analytics\.[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$`

#### analytics_query.schema.json

**Required Fields:**
querySpec (eventType, timeRange, aggregationType, bucketSize), executionContext (tenantId, principalId)

**Field Constraints:**
- aggregationType: enum count|sum|avg|min|max
- bucketSize: pattern `^[0-9]+(s|m|h|d)$` (e.g., "5m", "1h", "1d")
- metricName: string or null (null for count aggregation)

### 2.7 Fixtures (Invariants Encoded)

**valid_event_envelope.json:**
- Demonstrates all required fields present
- correlationId preserved across events
- causationId references parent event
- idempotencyKey is unique

**invalid_event_envelope_missing_idempotency.json:**
- Demonstrates rejection when idempotencyKey is missing

**sample_module_manifest.json:**
- All declaration types shown (actions, resources, events, projections, jobs, cacheArtifacts)
- Undeclared capabilities cannot be invoked
- Cache artifacts include tenantId in tags

**sample_policy_bundle.json:**
- Deny rules override allow rules
- Default decision is deny if no allow matches
- Policy evaluation is deterministic

**sample_page_create_intent.json + expected_page_created_event.json:**
- correlationId propagates from intent to domain event
- causationId in domain event references intent eventId
- Authorization MUST occur before domain event emission

**search_documents.json + search_query.json + expected_search_results_filtered.json:**
- Search results filtered by permissionAttributes
- null permissionAttributes means public within tenant
- allowedPrincipals is whitelist
- Cross-tenant documents excluded

**analytics_events.json + analytics_query.json + expected_analytics_buckets.json:**
- Time buckets are deterministically aligned
- Dimension values create separate buckets
- Aggregations are tenant-scoped

---

## 3. Stability Classification

### 3.1 Public API (Stable Inputs for Compiler)

**High Confidence — Intended for Compiler Consumption:**

- **JSON Schemas in `schemas/contracts/`:**
  - event_envelope.schema.json — Core event structure
  - module_manifest.schema.json — Module governance
  - policy_ast.schema.json — Authorization policies
  - cache_policy.schema.json — Cache artifact declaration
  - search_document.schema.json — Search indexing
  - search_query.schema.json — Search execution
  - analytics_event.schema.json — Analytics events
  - analytics_query.schema.json — Analytics queries

- **Fixtures in `fixtures/`:**
  - All fixture files are golden test data
  - Encode expected behavior for conformance testing

- **Architecture Invariants (I1-I12) in architecture.md:**
  - Non-negotiable constraints
  - Must be enforced by any implementation

- **Error Taxonomy (error_taxonomy.json):**
  - Structured error codes for error handling

- **Module Manifest Example (modules/content-pages.json):**
  - Concrete example of manifest v2 structure

**Medium Confidence — Likely Stable:**

- **Glossary terms** — Core vocabulary appears stable
- **Event envelope required fields** — Immutable by architecture
- **Tenancy boundary rules** — Non-negotiable for multi-tenancy

### 3.2 Internal / Experimental

**Low Confidence — Likely to Change:**

- **Module-specific surface.md specs:**
  - High density of "TODO / Open Questions"
  - Edge cases flagged as uncertain
  - Acceptance scenarios are illustrative, not exhaustive
  - Targeting/filtering rules underspecified (e.g., business unit targeting)

- **Conceptual schemas in `schemas/*.md`:**
  - Logical models, not physical
  - Explicitly stated "NO DDL, NO indexes"
  - Many "Open Questions" sections
  - Relationships described in prose (ambiguous cardinality)

- **Event vocabulary in crosscut/events.md:**
  - "Open Questions" section flags typing, performance, webhooks as TBD

- **Security/Authorization details in crosscut/security.md:**
  - Role hierarchy is underspecified
  - Business unit permissions are "possibly" or "unclear"
  - Delegation and granular permissions are open questions

- **Storage implementation in crosscut/storage.md:**
  - Placeholder behavior not fully specified
  - File size limits, virus scanning, versioning are open questions

### 3.3 Ambiguous (Unclear Intent)

**High Ambiguity — Boundary Unclear:**

- **Module boundaries for some features:**
  - Announcement targeting by business unit (content vs. org module responsibility?)
  - Badge criteria complexity (audit query limits?)
  - Token evaluation logic (scripting language? plugin system?)

- **Authentication/Authorization granularity:**
  - Full role hierarchy not specified
  - Break-glass access implementation details
  - Delegation mechanisms

- **Operational concerns:**
  - SLO targets are placeholders
  - Disaster recovery procedures are outlined but not detailed
  - Migration rollback procedures

- **Performance characteristics:**
  - Intent ingestion throughput limits
  - Search result pagination strategies
  - Analytics query performance at scale

**Medium Ambiguity — Likely Design Choices:**

- **Module manifest optional fields:**
  - When to declare capabilities vs. actions vs. resources
  - uiRoute requirement clarity (required if moduleType=ui, but what if hybrid?)

- **Cache artifact varyBy semantics:**
  - ABAC_CONTEXT is flagged "extreme cardinality, avoid if possible"
  - Interaction between varyBy and privacy unclear

- **Policy AST expressiveness:**
  - What operators are missing? (in, startsWith, regex?)
  - How are complex ABAC conditions expressed?

---

## 4. Observed Patterns and Inferred Rules

This section catalogs patterns, conventions, and rules observed in the spec files, categorized by certainty level. Each item includes explicit provenance.

**Certainty Levels:**
- **Observed**: Explicitly present in spec files
- **Inferred**: Strongly implied by multiple artifacts but not stated verbatim
- **Assumed**: Plausible interpretation with weak or no direct evidence

### 4.1 Naming Conventions (Observed)

**File Naming:**
- Module directories: lowercase, singular (e.g., `modules/audit/`, not `modules/audits/`)
  **Evidence:** Directory listing in `modules/` shows audit, badges, comms, content, import, org, points, tokens (all singular)

- Schema files: module name + `.md` (e.g., `schemas/audit.md`)
  **Evidence:** Files `schemas/audit.md`, `schemas/badges.md`, `schemas/comms.md`, etc.

- JSON schemas: snake_case + `.schema.json` (e.g., `event_envelope.schema.json`)
  **Evidence:** Files in `schemas/contracts/` follow this pattern consistently

- Fixtures: descriptive + purpose (e.g., `valid_event_envelope.json`, `expected_*`)
  **Evidence:** Files in `fixtures/` directory

**Entity Naming:**
- IDs: `{entity}_id` pattern (e.g., badge_id, file_id, tenant_id)
  **Evidence:** schemas/content.md (file_id, category_id, tenant_id), schemas/audit.md (intent_id, tenant_id)

- Timestamps: `{action}_at` pattern (e.g., created_at, updated_at, uploaded_at, occurred_at)
  **Evidence:** schemas/content.md#MediaFile (created_at, updated_at, uploaded_at), schemas/contracts/event_envelope.schema.json (occurredAt)

- Status fields: `{entity}_status` or `status` (e.g., privacy_status)
  **Evidence:** schemas/content.md#MediaFile (privacy_status)

**Event Type Naming:**
- Format: `{Domain}.{Entity}.{PastTenseVerb}` (e.g., ContentPages.PageCreated)
  **Evidence:** fixtures/valid_event_envelope.json (eventType: "ContentPages.PageCreated")

- OR: `{Domain}.{PastTenseVerb}` (e.g., Workflow.TaskCompleted)
  **Evidence:** schemas/contracts/event_envelope.schema.json (examples field)

**Module ID Naming:**
- kebab-case (e.g., content-pages, not contentPages)
  **Evidence:** schemas/contracts/module_manifest.schema.json (field: properties.moduleId.pattern = `^[a-z0-9-]+$`)

**Schema ID Naming:**
- Lowercase dotted notation (e.g., domain.contentpages.page.created.v1)
  **Evidence:** schemas/contracts/event_envelope.schema.json (field: properties.schemaId.pattern = `^[a-z0-9.]+$`)

- Analytics schemas: `analytics.{module}.{entity}.v{version}`
  **Evidence:** schemas/contracts/analytics_event.schema.json (field: properties.schemaId.pattern = `^analytics\.[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$`)

### 4.2 Versioning Expectations (Observed)

**Manifest Versioning:**
- Current version: manifestVersion=2
  **Evidence:** schemas/contracts/module_manifest.schema.json (field: properties.manifestVersion.enum = [2])

- Version is enum [2], indicating hard version checks
  **Evidence:** schemas/contracts/module_manifest.schema.json (enum constraint)

**Schema Versioning:**
- Schema IDs include version suffix (e.g., `.v1`)
  **Evidence:** fixtures/valid_event_envelope.json (schemaId: "domain.contentpages.page.created.v1")

- schemaVersion is separate integer field in event envelope
  **Evidence:** schemas/contracts/event_envelope.schema.json (field: properties.schemaVersion, type: integer, minimum: 1)

- Compatibility modes: BACKWARD or STRICT
  **Evidence:** schemas/contracts/module_manifest.schema.json (field: $defs.eventContract.properties.compatibility.enum = ["BACKWARD", "STRICT"])

**Module Versioning:**
- Semantic versioning (MAJOR.MINOR.PATCH)
  **Evidence:** schemas/contracts/module_manifest.schema.json (field: properties.version.pattern = `^[0-9]+\.[0-9]+\.[0-9]+$`)

**Event Schema Evolution:**
- Schema registry enforces compatibility
  **Evidence:** architecture.md#Event Model ("Schema Registry: Events declare schema ID and version. Registry validates compatibility")

- Upcasters/downcasters for version migration
  **Evidence:** architecture.md#Event Model ("provides upcasters/downcasters for version migration")

### 4.3 Uniqueness Constraints (Inferred)

These uniqueness constraints are inferred from usage patterns and architectural requirements, not explicitly stated as constraints in schemas.

**Globally Unique (Inferred):**
- eventId (across all events, all tenants)
  **Evidence:** Inferred from event_envelope.schema.json requiring eventId as string with minLength 1; no scoping mentioned

- correlationId (for request tracing, may span tenants)
  **Evidence:** Inferred from architecture.md#Correlation Propagation ("propagate through entire request flow")

**Tenant-Unique (Inferred):**
- idempotencyKey (within tenant, prevents duplicate execution)
  **Evidence:** Inferred from architecture.md#I3 ("Duplicate idempotencyKey MUST NOT cause re-execution")

- principalId (within tenant)
  **Evidence:** Inferred from architecture.md#Principal model showing tenantId as part of Principal

- moduleId (each module has unique ID)
  **Evidence:** Inferred from architecture.md#Module System ("Module registry" implies unique registration)

- actionId (action registry prevents collisions)
  **Evidence:** architecture.md#Core Invariants ("Action registry lookup (action exists)")

- Entity IDs (badge_id, file_id, page_id, etc.)
  **Evidence:** Inferred from entity definitions in schemas/*.md showing these as primary identifiers

- Token names (e.g., `[site_url]`)
  **Evidence:** Inferred from modules/tokens/README.md ("Define and manage text tokens")

- Business unit names
  **Evidence:** schemas/content.md#FileCategory ("Category names must be unique within a tenant")

- File category names
  **Evidence:** schemas/content.md#FileCategory ("Category names must be unique within a tenant")

**Not Unique (Inferred):**
- filename (multiple files can have same name)
  **Evidence:** Inferred from schemas/content.md#MediaFile showing filename as non-identifier field

- intent_type (many intents of same type)
  **Evidence:** Inferred from schemas/audit.md#Intent showing intent_type as categorical field

### 4.4 Cross-File Relationships (Observed)

**Module → Schema:**
- Each module spec (README, surfaces, events) has corresponding schema in `schemas/{module}.md`
  **Evidence:** Directory structure shows 1:1 correspondence (audit, badges, comms, content, import, org, points, tokens in both locations)

**Module → JSON Schemas:**
- Module manifests validate against `schemas/contracts/module_manifest.schema.json`
  **Evidence:** modules/content-pages.json contains `"manifestVersion": 2` matching schema requirement

- Module events validate against `schemas/contracts/event_envelope.schema.json`
  **Evidence:** fixtures/valid_event_envelope.json has `"$schema": "../event_envelope.schema.json"`

**Fixtures → Schemas:**
- Each fixture references its schema via `$schema` field (relative path)
  **Evidence:** fixtures/valid_event_envelope.json (line 2: `"$schema": "../event_envelope.schema.json"`)

**Architecture → Everything:**
- architecture.md defines system-wide constraints referenced by all other specs
  **Evidence:** architecture.md contains 12 invariants (I1-I12) stating "non-negotiable" and "must be enforced"

**Glossary → Everything:**
- All specs use glossary terms consistently
  **Evidence:** Terms defined in glossary.md (Tenant, Intent, Token, etc.) appear throughout module specs

**Cross-Module Dependencies (Observed):**
- badges → audit (queries intents for criteria)
  **Evidence:** modules/badges/README.md#Dependencies ("modules/audit — queries intents to evaluate badge criteria")

- badges → points (awards points)
  **Evidence:** modules/badges/README.md#Dependencies ("modules/points — awards points when badge is earned")

- badges → comms (sends email)
  **Evidence:** modules/badges/README.md#Dependencies ("modules/comms — sends badge award email using template")

- badges → content (badge images from media library)
  **Evidence:** modules/badges/README.md#Dependencies ("modules/content — retrieves badge images from media library")

- comms → tokens (email templates use tokens)
  **Evidence:** modules/comms/README.md (mentions email templates embed tokens)

- tokens → points (tokens read current_user_points)
  **Evidence:** modules/tokens/README.md#Dependencies ("modules/points — dynamic tokens like [current_user_points]")

- content → org (announcement targeting by business unit, possibly)
  **Evidence:** modules/content/surfaces.md#Announcements Widget ("Optional: visibility rules (show to all users, specific business units, etc.)")

- All modules → audit (all emit intents)
  **Evidence:** modules/audit/README.md#Produces Data From ("All modules — every module emits intents")

### 4.5 Required Infrastructure (Inferred & Observed)

Components referenced but not defined in module specs:

**User/Principal Directory (Inferred):**
- Modules reference userId, principalId, uploader_id, actor_id
  **Evidence:** Inferred from schemas/content.md (uploader_id), schemas/audit.md (actor_id), architecture.md (Principal model with userId)

**Session Management (Inferred):**
- Principal has sessionId field
  **Evidence:** architecture.md#Authentication & Authorization ("Principal" interface includes "sessionId?: string")

**Schema Registry (Observed):**
- Events reference schemaId, schemaVersion
  **Evidence:** architecture.md#Event Model ("Schema Registry: Events declare schema ID and version")

**File Storage Backend (Inferred):**
- MediaFile references storage_location
  **Evidence:** Inferred from schemas/content.md#MediaFile ("storage_location — reference to blob storage location")

**Message Bus / Queue (Observed):**
- Events are published, jobs are enqueued
  **Evidence:** architecture.md#Data Stores ("Message Bus: Event distribution for domain events" and "Queue: Background job transport")

**Cache Service (Observed):**
- Cache artifacts declared, invalidation described
  **Evidence:** architecture.md#Data Stores ("Distributed Cache: Cross-instance cache for render models")

**Authorization Service (Observed):**
- Policy evaluation described in architecture
  **Evidence:** architecture.md#Authentication & Authorization ("Authorizer service retrieves active policies")

**Ingress Gateway (Observed):**
- Single ingress chokepoint described
  **Evidence:** architecture.md#P1 ("All external requests enter through exactly one ingress point")

**Tenant Database Provisioning (Observed):**
- Database-per-tenant model
  **Evidence:** architecture.md#Tenant Ops bounded context ("Provision: create tenant database")

**Migration Tooling (Inferred):**
- Migrations declared in module manifests
  **Evidence:** Inferred from schemas/contracts/module_manifest.schema.json ($defs.migration with "engine" field)

### 4.6 Default Values (Observed)

**privacy_status defaults to 'private' for files:**
**Evidence:** crosscut/storage.md#Privacy Model ("Private by Default: All uploaded files in the media library start as private")

**points default to "1 point ≈ 50 cents":**
**Evidence:** modules/points/README.md#Owned Data ("Monetary value per point (default: 1 point ≈ 50 cents)")

**cacheArtifacts.varyBy defaults to ["TENANT"]:**
**Evidence:** schemas/contracts/module_manifest.schema.json (field: $defs.cacheArtifact.properties.varyBy.default = ["TENANT"])

**job.concurrency defaults to 1:**
**Evidence:** schemas/contracts/module_manifest.schema.json (field: $defs.job.properties.concurrency.default = 1)

**job.retryPolicy defaults to maxAttempts=3, backoffSeconds=5:**
**Evidence:** schemas/contracts/module_manifest.schema.json (field: $defs.job.properties.retryPolicy.default = {"maxAttempts": 3, "backoffSeconds": 5})

**events.publishes and events.consumes default to []:**
**Evidence:** schemas/contracts/module_manifest.schema.json (field: properties.events.default = {"publishes": [], "consumes": []})

### 4.7 Required Relationships (Inferred)

Data integrity constraints inferred from schema descriptions:

**file_id in AnnouncementWidgetConfig MUST reference existing MediaFile:**
**Evidence:** Inferred from schemas/content.md#AnnouncementWidgetConfig ("file_id — reference to MediaFile")

**file_id and category_id in FileCategoryAssociation MUST reference same tenant:**
**Evidence:** Inferred from schemas/content.md#FileCategoryAssociation ("File and category must belong to the same tenant")

**principalId in search/analytics queries MUST match authenticated principal:**
**Evidence:** Inferred from schemas/contracts/search_query.schema.json and analytics_query.schema.json requiring principalId in executionContext

**tenantId in all queries MUST match request context tenant:**
**Evidence:** Inferred from architecture.md#I7 ("Search queries MUST be scoped to tenantId from request context")

### 4.8 Ordering Dependencies (Inferred)

Sequencing constraints inferred from architecture:

**Modules must be registered before actions can be invoked:**
**Evidence:** Inferred from architecture.md#Module Governance ("Module manifest schema and registry")

**Schema registry must validate events before dispatch:**
**Evidence:** Inferred from architecture.md#Ingress Chokepoint Rules ("Schema Validation: UI intent events validated against schema")

**Authorization policies must be loaded before evaluation:**
**Evidence:** Inferred from architecture.md#P2 ("Authorizer service retrieves active policies for tenant")

**Tenant must exist before tenant database operations:**
**Evidence:** Inferred from architecture.md#Tenancy Model ("Each tenant has a dedicated database")

---

## 5. Compiler Inputs (Pass 0)

This section lists **verbatim** the files and artifacts that the compiler will accept as-is, even if messy, ambiguous, or incomplete. These are the frozen inputs for Pass 0.

### 5.1 Mandatory Inputs (Compiler MUST Accept)

**Architecture & Invariants:**
- `architecture.md` — Complete system architecture with 12 non-negotiable invariants

**JSON Schemas (Contract Definitions):**
- `schemas/contracts/event_envelope.schema.json`
- `schemas/contracts/module_manifest.schema.json`
- `schemas/contracts/policy_ast.schema.json`
- `schemas/contracts/cache_policy.schema.json`
- `schemas/contracts/search_document.schema.json`
- `schemas/contracts/search_query.schema.json`
- `schemas/contracts/analytics_event.schema.json`
- `schemas/contracts/analytics_query.schema.json`

**Error Taxonomy:**
- `error_taxonomy.json`

**Fixtures (Golden Test Data):**
- `fixtures/valid_event_envelope.json`
- `fixtures/invalid_event_envelope_missing_idempotency.json`
- `fixtures/sample_module_manifest.json`
- `fixtures/sample_policy_bundle.json`
- `fixtures/sample_page_create_intent.json`
- `fixtures/expected_page_created_event.json`
- `fixtures/search_documents.json`
- `fixtures/search_query.json`
- `fixtures/expected_search_results_filtered.json`
- `fixtures/analytics_events.json`
- `fixtures/analytics_query.json`
- `fixtures/expected_analytics_buckets.json`

**Module Manifest Example:**
- `modules/content-pages.json`

### 5.2 Reference Inputs (Compiler SHOULD Accept)

**Glossary:**
- `glossary.md` — Authoritative terminology

**Cross-Cutting Concerns:**
- `crosscut/events.md`
- `crosscut/security.md`
- `crosscut/storage.md`
- `crosscut/tenancy.md`

**Module Specifications (All Modules):**
- `modules/audit/{README.md, surfaces.md, events.md}`
- `modules/badges/{README.md, surfaces.md, events.md}`
- `modules/comms/{README.md, surfaces.md, events.md}`
- `modules/content/{README.md, surfaces.md, events.md}`
- `modules/import/{README.md, surfaces.md, events.md}`
- `modules/org/{README.md, surfaces.md, events.md}`
- `modules/points/{README.md, surfaces.md, events.md}`
- `modules/tokens/{README.md, surfaces.md, events.md}`

**Conceptual Schemas (All Modules):**
- `schemas/audit.md`
- `schemas/badges.md`
- `schemas/comms.md`
- `schemas/content.md`
- `schemas/import.md`
- `schemas/org.md`
- `schemas/points.md`
- `schemas/tokens.md`

### 5.3 Documentation Inputs (Compiler MAY Ignore)

**Navigation & Organization:**
- `README.md`
- `index.md`
- `SUMMARY.md`

**Schema Documentation:**
- `schemas/README.md`
- `fixtures/README.md`

### 5.4 Excluded Artifacts (Not Part of Spec Surface)

**Deleted Files (from git status):**
- All files under `specs/book/` (generated mdBook output)
  - HTML, CSS, JS, fonts, images
  - These were build artifacts, not source specs

---

## 6. Summary & Observations

### 6.1 What is Well-Specified

- **JSON Schemas:** Precise, machine-readable, with validation rules
- **Architecture Invariants:** Non-negotiable constraints clearly stated
- **Event Envelope Structure:** Required fields, formats, patterns
- **Module Manifest Schema:** Comprehensive governance model
- **Error Taxonomy:** Structured, categorized error codes
- **Fixtures:** Golden test data with explicit invariants

### 6.2 What is Underspecified

- **Module surface.md files:** High density of "TODO / Open Questions"
- **Conceptual schemas:** Relationships described in prose, not formal notation
- **Authorization granularity:** Role hierarchy, delegation, business unit permissions
- **Operational procedures:** Migration rollback, disaster recovery, scaling
- **Performance characteristics:** Limits, throughput, latency expectations
- **Storage implementation:** File backends, placeholders, virus scanning
- **Token evaluation logic:** Syntax, execution model, security

### 6.3 Ambiguities & Design Choices Deferred

- **Module boundary overlaps:** Announcement targeting (content vs. org?)
- **Badge criteria complexity:** Query limits, context filtering
- **Cache varyBy interactions:** ABAC_CONTEXT cardinality concerns
- **Policy AST completeness:** Missing operators (in, regex, startsWith?)
- **Intent ingestion architecture:** Sync vs. async, queue vs. direct write
- **Projection rebuild procedures:** Downtime, data migration, rollback

### 6.4 Observed Conventions

- **Naming:** kebab-case modules, snake_case schemas, dotted event types
- **Versioning:** Semver for modules, integer versions for schemas
- **Tenant scoping:** Every entity has tenant_id
- **Timestamps:** created_at, updated_at, occurred_at patterns
- **Event naming:** Domain.Entity.PastTenseVerb

### 6.5 Critical Dependencies Not in Specs

- User/Principal directory
- Session management
- Schema registry implementation
- File storage backend
- Message bus / queue
- Cache service
- Authorization engine
- Ingress gateway implementation
- Tenant provisioning
- Migration tooling

### 6.6 Non-normative Notes (Pass 0)

This inventory captures the spec surface as it exists. Notable characteristics:

**High Certainty Areas:**
- JSON schemas provide machine-enforceable contracts
- Architecture document explicitly states 12 non-negotiable invariants
- Fixtures encode expected behavior with inline comments

**Areas of Uncertainty:**
- Module specs contain numerous "TODO / Open Questions" sections
- Cross-module relationships are described in prose without formal contracts
- Performance characteristics and operational procedures lack quantitative targets
- Authorization granularity beyond tenant/admin/user is underspecified

**Implicit Infrastructure:**
- Multiple critical components (user directory, schema registry, message bus) are referenced but not defined in module specs
- Platform core is assumed to provide these via ports/adapters pattern
- No module manifests exist for platform core components

**Design Flexibility:**
- Conceptual schemas explicitly avoid physical implementation details
- Many "Open Questions" preserve design flexibility for future passes
- Optional manifest fields allow modules to declare only required capabilities

---

## Appendix: Spec Artifact Count

- **Total Files:** 67
- **Markdown Docs:** 38
- **JSON Schemas:** 8
- **JSON Fixtures:** 13
- **JSON Manifest Examples:** 2
- **Deleted Generated Files:** ~100 (mdBook build artifacts, not source)

**Breakdown:**
- Root-level: 6 files
- crosscut/: 4 files
- modules/: 25 files (8 modules × 3 files each + 1 manifest)
- schemas/: 18 files (1 README + 9 conceptual schemas + 8 JSON contracts)
- fixtures/: 14 files (1 README + 13 examples)

---

**End of Inventory**
