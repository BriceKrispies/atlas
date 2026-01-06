# Events

## Event Vocabulary

**Intent**
A user-initiated action or activity within the system. Intents are the primary unit of user activity tracking.

**Event**
A system occurrence that may or may not be user-initiated. Broader than intents; includes system-generated actions.

**History**
A chronological, immutable record of past intents or events. Used for audit, reporting, and badge evaluation.

**Audit**
The process of recording and reviewing system activity for compliance, troubleshooting, or analysis.

## What Gets Recorded

### Intent History (modules/audit)
- All user activities ("intents") within the system
- Includes: who, what, when, and relevant context
- Read-only after creation
- Filterable and searchable
- Preserved indefinitely (no retention policy specified)

### Email Notifications History (modules/comms)
- All emails sent by the system
- Tracks: from address, recipient, subject, sent timestamp, delivery status
- Read-only after creation
- Filterable and searchable by email content, subject, user

### Spreadsheet Upload History (modules/import)
- Record of all spreadsheet uploads
- Includes validation results, dry run outputs, and committed changes
- Provides audit trail for bulk operations

### Badge Awards (modules/badges)
- When a badge is awarded to a user based on intents/roles
- Includes points granted and email notifications sent

## Event Flow Patterns

### Badge Award Flow
1. User performs actions → intents recorded
2. Badge system evaluates intents against badge rules
3. If criteria met → award badge, grant points, send email
4. All steps recorded in relevant history tables

### Email Sending Flow
1. System component requests email send (with template + tokens)
2. Token registry evaluates tokens
3. Email rendered and sent
4. Status tracked in email notifications history

### Spreadsheet Import Flow
1. User uploads spreadsheet
2. Validation runs (dry run mode)
3. User reviews results
4. User commits import
5. Intents generated from import
6. Upload history records entire process

## Event Consumption

### Badges Module
- Consumes intents from audit module
- Evaluates badge award criteria
- Produces badge award events and point grants

### Token System
- Tokens may read current user points (modules/points)
- Tokens may read other system state at evaluation time

## Open Questions

- Are intents strongly typed (e.g., "badge_awarded", "file_uploaded") or free-form?
- Do all intents get recorded, or only specific categories?
- What is the performance impact of recording all intents?
- Is there a webhook or pub/sub system for reacting to events in real-time?
- Can external systems consume events?
- Are there event schemas or just free-form JSON blobs?
