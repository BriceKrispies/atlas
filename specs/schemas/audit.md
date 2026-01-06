# Audit Module Schema

## Module Overview

The audit module owns the central intent history: an immutable, filterable record of all user activities (intents) within the system.

**Data Ownership:**
- Owns: Intent history (all user and system activities)
- References: None directly (audit is a sink for intents from all modules)

**Purpose:**
Provide a complete, queryable audit trail for troubleshooting, compliance, analytics, and badge criteria evaluation.

## Entities

### Intent

**Description:**
An immutable record of a single user or system activity. Intents are the foundation for history tracking, badge awards, and analytics.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when any module emits an intent
- Never updated or deleted
- Append-only / immutable

**Key Fields:**
- intent_id — unique identifier
- tenant_id — owning tenant
- intent_type — type of intent (e.g., 'file_uploaded', 'badge_awarded', 'email_sent')
- actor_id — user or system component that triggered the intent
- timestamp — when the intent occurred
- context — JSON payload with intent-specific details (e.g., badge ID, file ID, point amount)
- created_at — record creation timestamp

**Invariants:**
- All intents are immutable (never edited or deleted)
- All intents are tenant-scoped
- Intents are preserved indefinitely (no retention policy specified)
- Intents are filterable by type, actor, date range
- Intents are searchable (keyword search on context payload, possibly)

## Relationships

### Internal Relationships
None — this module has a single entity.

### Cross-Module Relationships

**Intent → (consumed by) → BadgeDefinition (modules/badges)**
- Cardinality: Many-to-many (badges query intents to evaluate criteria)
- Directionality: Badges query intents
- Notes: Badges module queries audit to count intents of specific types for badge criteria evaluation

**Intent → (produced by) → All Modules**
- Cardinality: Many-to-one (many intents from one module)
- Directionality: All modules emit intents, audit consumes them
- Notes: Intent is the central event sink for the entire system

Specific intent producers:
- **modules/tokens** → token_created, token_updated, token_deleted, token_evaluated (possibly)
- **modules/comms** → email_sent, email_status_updated, message_sent, template_created, etc.
- **modules/org** → business_unit_created, user_added_to_business_unit, etc.
- **modules/content** → file_uploaded, file_privacy_toggled, announcement_configured, etc.
- **modules/points** → points_awarded, points_deducted, points_configuration_updated, etc.
- **modules/import** → spreadsheet_uploaded, spreadsheet_validated, import_committed, etc.
- **modules/badges** → badge_awarded, badge_created, etc.

## Derived / Computed Concepts

**Intent Count by Type:**
- Aggregate statistic: count of intents grouped by intent_type
- Computed on-demand for admin statistics or badge evaluation
- Not stored separately

**User Activity Summary:**
- Aggregate statistics per user: total intents, intents by type, recent activity
- Computed on-demand for reporting or badge criteria
- Not pre-aggregated

**Intent Search Results:**
- Filtered/searched intents based on criteria (type, actor, date range, keyword)
- Computed on-demand via query
- Paginated for performance

## Events & Audit Implications

**Intents Emitted:**
- `intent_history_queried` (possibly) — admin or module queries intent history (high-volume, may not be tracked)
- `intent_history_exported` (possibly) — admin exports intent history to file

**Immutability:**
- Intent is strictly append-only (never updated or deleted)
- Intent history is the authoritative audit trail for the entire system

**Audit Dependency:**
- Audit module is the final destination for all intents
- Audit module itself may emit meta-intents (queried, exported) which would be circular

## Open Questions

### Intent Type Schema
- Are intents strongly typed with schemas, or free-form JSON?
- Is there a registry of valid intent_type values?
- Can modules define custom intent types, or must they be pre-approved?
- Is there validation on the context payload structure?

### Intent Retention
- Is there a retention policy, or are intents kept indefinitely?
- Can old intents be archived or purged?
- If archived, are they still queryable or moved to cold storage?

### Intent Volume Management
- How is high write volume managed? (async queuing, batching, sharding?)
- Is intent ingestion synchronous or asynchronous?
- What happens if audit module is down? (circuit breaker, queue overflow, data loss?)

### Intent Searchability
- Is there full-text search on intent context/payload?
- Are intents indexed for efficient filtering (by type, actor, tenant, timestamp)?
- Can complex queries be run (e.g., "all file_uploaded intents by users in business unit X")?

### Intent Export
- Can intents be exported (CSV, JSON, bulk download)?
- Is export synchronous or async for large result sets?
- Are there performance concerns with exporting millions of intents?

### Intent Analytics
- Are there aggregate analytics on top of intent history? (dashboards, charts, trends?)
- Are analytics computed on-demand or pre-aggregated?
- Is there a separate analytics/reporting system fed by intents?

### Intent Partitioning
- Is intent history partitioned by tenant for performance?
- Is it partitioned by time (e.g., monthly tables)?
- How are cross-partition queries handled (e.g., "all badge_awarded intents across 2 years")?

### Badge Criteria Evaluation
- When badges query intents, is it a full table scan or indexed query?
- Are intent counts cached or pre-aggregated for badge evaluation performance?
- Can badge evaluation trigger expensive queries on millions of intents?

### Intent Ingestion Architecture
- Is there a pub/sub or event bus architecture for intent distribution?
- Do modules write intents directly to audit, or is there a message queue?
- Are intents written synchronously (blocking) or asynchronously (fire-and-forget)?

### Intent Query Performance
- Can modules query intents in real-time, or is there a delay (eventual consistency)?
- Are there performance metrics on intent write throughput or query latency?
- Is there caching for frequently queried intent aggregates?

### Intent Actor Resolution
- Is actor_id always a user, or can it be a system component or module?
- How are system-generated intents (e.g., scheduled badge evaluation) attributed?
- Can intents be attributed to API tokens, service accounts, or only human users?

### Intent Context Payload
- Is there a maximum size for the context JSON payload?
- Can large payloads (e.g., email bodies, file uploads) be stored inline or must they be referenced?
- Is the context payload schema-validated or free-form?

### Intent History UI
- Can end users view their own intent history, or is this admin-only?
- If user-visible, what level of detail is shown? (redacted context, full payload?)
- Are there privacy concerns with intent history (e.g., email content, file names)?

### Intent Aggregation for Badge Criteria
- When a badge requires "10 file_uploaded intents", is this a simple count or does it consider intent context (e.g., file size, category)?
- Can badge criteria filter intents by context (e.g., "10 file_uploaded intents where file size > 1MB")?
- How complex can badge criteria queries become?
