# Audit Module

## Purpose

Records and displays a complete, filterable history of all user intents (activities) within the system for audit, troubleshooting, and analytics.

## Responsibilities

- Capture all user intents from across the system
- Store intent records immutably (read-only after creation)
- Provide filterable and searchable intent history UI
- Support intent queries for other modules (e.g., badges evaluating criteria)
- Maintain performance despite high write volume

## Owned Data

**Intent History**
- Intent type (e.g., "file_uploaded", "badge_awarded", "email_sent")
- Actor (user or system component that triggered the intent)
- Timestamp
- Context/payload (relevant details specific to intent type)
- Tenant scope

## Dependencies

### Consumed Services
- None directly; audit module is a sink for intents

### Consumed By
- **modules/badges** — queries intents to evaluate badge award criteria
- Tenant admins viewing intent history page
- Analytics and reporting features

### Produces Data From
- **All modules** — every module emits intents that are recorded here
  - modules/tokens
  - modules/comms
  - modules/org
  - modules/content
  - modules/points
  - modules/import
  - modules/badges

## Runtime Behavior

**Intent Recording Flow**
1. User performs action in any module
2. Module emits intent event
3. Audit module receives intent
4. Intent is written to immutable history store
5. Intent is immediately available for querying

**Intent Query Flow**
1. User or module queries intents (filters: user, type, date range, etc.)
2. Audit module executes query against intent history
3. Returns paginated results

**Badge Evaluation Flow**
1. Badges module queries audit for user's intents matching criteria
2. Audit returns matching intent count or list
3. Badges module evaluates if criteria met

## Integration Points

- Intent ingestion API (consumed by all modules)
- Intent query API (consumed by badges, UI, analytics)
- Real-time or near-real-time intent availability

## Open Questions

- Are intents strongly typed with schemas, or free-form JSON?
- Is there a retention policy, or are intents kept indefinitely?
- How is high write volume managed (async queuing, batching)?
- Is there full-text search on intent context/payload?
- Can intents be exported (CSV, JSON)?
- Are there aggregate analytics on top of intent history?
- Is intent history partitioned by tenant for performance?
