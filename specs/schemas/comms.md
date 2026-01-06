# Communications Module Schema

## Module Overview

The comms module owns all communication channels: email templates, messaging between users/business units, and email delivery tracking.

**Data Ownership:**
- Owns: Email templates, email notification history, messages, messaging widget configuration
- References: Tokens (modules/tokens) for template evaluation, Business units (modules/org) for messaging permissions

**Purpose:**
Provide reusable email templates, track all sent emails, and enable business-unit-scoped messaging.

## Entities

### EmailTemplate

**Description:**
A reusable email layout that can be used by any part of the system when sending emails. Templates may contain token placeholders for dynamic content.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created by tenant admin
- Updated by tenant admin
- Deleted by tenant admin
- Mutable configuration entity

**Key Fields:**
- template_id — unique identifier
- tenant_id — owning tenant
- template_name — unique name within tenant
- subject — email subject line (may contain token placeholders)
- body_html — HTML email body (may contain token placeholders)
- body_plain — plain text email body (may contain token placeholders)
- description — optional admin reference
- created_at — creation timestamp
- updated_at — last modification timestamp

**Invariants:**
- template_name must be unique within a tenant
- Templates can contain arbitrary token placeholders (e.g., `[site_url]`)
- Tokens are not evaluated until email send time
- Templates are reusable across multiple email sends

---

### EmailNotification

**Description:**
An immutable record of every email sent by the system, tracking delivery status and full message content.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when system sends an email
- Status updated asynchronously as delivery confirmations arrive
- Never deleted
- Append-only / immutable (except status field)

**Key Fields:**
- email_id — unique identifier
- tenant_id — owning tenant
- template_id — reference to email template (if used), nullable
- from_address — sender email address
- to_address — recipient email address
- subject — fully rendered email subject (tokens already evaluated)
- body_html — fully rendered HTML body (tokens already evaluated)
- body_plain — fully rendered plain text body (tokens already evaluated)
- sent_at — timestamp when email was sent
- status — delivery status (sent, pending, delivered, bounced, failed)
- created_at — record creation timestamp
- updated_at — last status update timestamp

**Invariants:**
- All emails sent by the system must be recorded
- Email content is immutable after creation (body, subject, addresses)
- Status can be updated asynchronously
- History is never deleted
- Emails are searchable by address, subject, and content

---

### Message

**Description:**
A message sent by a user to a business unit via the messaging widget.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when user sends message
- Read-only after creation (spec does not mention editing/deletion)
- Immutable or append-only (unclear if deletion is supported)

**Key Fields:**
- message_id — unique identifier
- tenant_id — owning tenant
- sender_id — user who sent the message
- recipient_business_unit_id — target business unit
- content — message body/text
- timestamp — when message was sent
- created_at — record creation timestamp

**Invariants:**
- Messages are scoped to tenant
- Sender must belong to a business unit with send permission
- Recipients are determined by business unit membership (users with view permission)
- Message content is immutable after sending

---

### MessagingWidgetConfig

**Description:**
Configuration for a messaging widget instance, defining which business units can send and view messages.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when widget is configured by tenant admin
- Updated when permissions change
- Mutable configuration entity

**Key Fields:**
- widget_instance_id — unique identifier (may be scoped to page/context)
- tenant_id — owning tenant
- send_allowed_business_units — list of business unit IDs with send permission
- view_allowed_business_units — list of business unit IDs with view permission
- created_at — creation timestamp
- updated_at — last modification timestamp

**Invariants:**
- Widget configuration is per-instance (multiple widgets can have different configs)
- Business units must exist in modules/org
- Permissions are evaluated at message send/view time

## Relationships

### Internal Relationships

**EmailTemplate → EmailNotification**
- Cardinality: One template can be used for many emails (one-to-many)
- Directionality: EmailNotification references EmailTemplate
- Notes: template_id in EmailNotification is nullable (emails can be sent without template)

**MessagingWidgetConfig → Message**
- Cardinality: One widget config can govern many messages (one-to-many)
- Directionality: Config defines permissions, messages are sent within those permissions
- Notes: Relationship is implicit through permission enforcement, not a foreign key

### Cross-Module Relationships

**EmailTemplate → (references) → TokenDefinition (modules/tokens)**
- Cardinality: Many-to-many (templates can use multiple tokens, tokens can be in multiple templates)
- Directionality: References (templates embed tokens via placeholders)
- Notes: Token evaluation happens at email send time, not template creation

**Message → (references) → BusinessUnit (modules/org)**
- Cardinality: Many-to-one (many messages to one business unit)
- Directionality: References
- Notes: recipient_business_unit_id must exist in modules/org

**MessagingWidgetConfig → (references) → BusinessUnit (modules/org)**
- Cardinality: Many-to-many (config lists multiple business units for send/view permissions)
- Directionality: References
- Notes: send_allowed_business_units and view_allowed_business_units reference modules/org

**EmailNotification → (triggered by) → Badge Award (modules/badges)**
- Cardinality: One badge award can trigger one email (one-to-one or one-to-many)
- Directionality: EmailNotification is created as a result of badge award flow
- Notes: Badges module calls comms API to send email

## Derived / Computed Concepts

**Rendered Email Content:**
- Not stored separately
- Computed at send time: template + token evaluation → final email body/subject
- Result is persisted in EmailNotification as fully rendered content

**Message Visibility:**
- Derived from MessagingWidgetConfig + BusinessUnit membership
- User can view messages if they belong to a business unit in view_allowed_business_units
- Computed at query time, not persisted

**Email Delivery Metrics:**
- Aggregate statistics (total sent, delivered, failed) derived from EmailNotification.status
- Not stored as separate entities (can be computed on-demand)

## Events & Audit Implications

**Intents Emitted:**
- `email_template_created` — admin creates template (mutable admin activity)
- `email_template_updated` — admin modifies template (mutable admin activity)
- `email_template_deleted` — admin deletes template (mutable admin activity)
- `email_sent` — system sends an email (immutable event)
- `email_status_updated` — delivery status changes (immutable event)
- `message_sent` — user sends message (immutable event)
- `message_viewed` (possibly) — user views messages (high-volume, may not be tracked)
- `messaging_widget_configured` — admin configures widget (mutable admin activity)

**Immutability:**
- EmailNotification is append-only (never deleted, content immutable, status mutable)
- Message is immutable after creation (unless deletion is supported, which is unclear)
- EmailTemplate is mutable
- MessagingWidgetConfig is mutable

**Audit Dependency:**
- All email and messaging intents are consumed by modules/audit for history tracking
- Email notification history provides a secondary audit trail for email sends

## Open Questions

### Email Delivery Service
- What email delivery service is used? (affects status tracking capabilities: sent, delivered, opened, clicked, bounced, failed?)
- Are emails queued or sent immediately?
- Is there retry logic for failed email sends?
- Can admins resend failed emails from the UI?

### Email Template Lifecycle
- What happens to badge configurations or other module references when an email template is deleted?
- Is there validation to prevent deleting templates in use?
- Are email templates versioned? (keep history of changes?)
- Can templates be duplicated?
- Are there default/system templates provided out of the box?

### Messaging Widget Behavior
- Is messaging one-to-many (broadcast to business unit) or one-to-one?
- Can users reply to messages, or is it announcement-style only?
- Are messages threaded or flat chronological list?
- Is there message search or filtering?
- Are there read receipts or read status tracking?
- Can messages be edited or deleted after sending?
- Can messages include attachments or rich media?

### Messaging Permissions
- What is the exact permission model? (read vs. send, per-business-unit or global?)
- Do nested business units (business unit contains other business units) affect messaging permissions?
- If a user belongs to multiple business units, can they send as any of them or just one?
- How are permissions resolved for users in nested business units?

### Message Delivery
- Are messages real-time (push notifications, WebSocket) or polled?
- Do message sends trigger email or push notifications, or just in-app visibility?

### Email Notification Storage
- Are email bodies stored in full or truncated?
- Is there PII concern with storing email content?
- Is there a retention policy for email notifications, or are they kept indefinitely?
- Can email notifications be exported (CSV, JSON)?

### Email Status Tracking
- What statuses are tracked? (sent, pending, delivered, opened, clicked, bounced, failed?)
- Are there performance metrics on email send throughput, latency, or failure rates?
