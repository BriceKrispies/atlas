# Communications Module Events

## Intents Emitted

**email_template_created**
- When: Admin creates a new email template
- Context: template name, tenant

**email_template_updated**
- When: Admin modifies an existing email template
- Context: template name, tenant

**email_template_deleted**
- When: Admin deletes an email template
- Context: template name, tenant

**email_sent**
- When: System sends an email (via any module)
- Context: template ID (if used), recipient, subject, timestamp, tenant

**email_status_updated**
- When: Email delivery status changes (delivered, bounced, failed)
- Context: email ID, old status, new status, timestamp

**message_sent**
- When: User sends a message via messaging widget
- Context: sender, recipient business unit, message content (or ID), timestamp, tenant

**message_viewed**
- When: User views messages in messaging widget (possibly)
- Context: viewer, business unit, timestamp, tenant
- Note: May be high-volume if tracked

**messaging_widget_configured**
- When: Admin configures messaging widget permissions
- Context: widget instance, business unit permissions, tenant

## Intents Consumed

None directly. Comms module is primarily a service consumed by other modules.

## Event Integration

**Outbound**
- Email sending and status tracking generates intents for audit trail
- Message activity generates intents for user history
- Template management generates admin activity intents

**Consumed By**
- **modules/audit** — email and message intents contribute to intent history
- **modules/badges** — badge award flow triggers email sends

## Open Questions

- Should every message view be recorded as an intent? (Could be high-volume)
- Are there metrics/analytics on email open rates, click-through, etc.?
- Do message sends trigger notifications or just in-app visibility?
