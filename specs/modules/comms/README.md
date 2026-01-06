# Communications Module

## Purpose

Manages all communication channels within the platform: email templates, messaging between users/business units, and tracking of sent email notifications.

## Responsibilities

- Store and manage reusable email templates
- Provide email template selection API for other modules
- Send emails with token substitution
- Track email delivery status and history
- Provide messaging widget for business unit communications
- Enforce messaging permissions based on business unit membership

## Owned Data

**Email Templates**
- Template name, subject, body (HTML/plain text), tenant scope
- May contain tokens for dynamic content

**Email Notifications History**
- Every email sent by the system
- From/to addresses, subject, sent timestamp, delivery status
- Searchable and filterable

**Messages**
- Message content, sender, recipient (business unit or user), timestamp, tenant scope

**Messaging Widget Configuration**
- Per-instance settings: which business units can send, which can view
- Tenant scope

## Dependencies

### Consumed Services
- **modules/tokens** — evaluate tokens in email templates before sending
- **modules/org** — resolve business units for messaging permissions
- Email delivery service (SMTP, SendGrid, etc.) — not specified, assumed external

### Consumed By
- **modules/badges** — sends badge award emails
- Any module that needs to send emails (uses email templates)
- Business units and users (messaging widget)

## Runtime Behavior

**Email Sending Flow**
1. External module requests email send (template ID, recipient, context data)
2. Comms module loads email template
3. Calls tokens module to evaluate all `[token_name]` placeholders
4. Renders final email (subject + body)
5. Sends email via delivery service
6. Records email in notifications history with status "sent" or "pending"
7. Updates status asynchronously as delivery confirmations arrive

**Messaging Flow**
1. User composes message in messaging widget
2. Widget checks business unit permissions (can sender send to target?)
3. If authorized, message is saved and displayed to recipients
4. Recipients determined by business unit membership

## Integration Points

- Email template API for other modules
- Token evaluation integration
- Business unit permission checks
- Email delivery status webhooks (if supported by email provider)

## Open Questions

- What email delivery service is used? (affects status tracking capabilities)
- Are emails queued or sent immediately?
- Is there retry logic for failed email sends?
- Can users reply to messages, or is it one-way broadcast?
- Are messages real-time or polled?
- Is there message threading or just flat message list?
- Can messages include attachments?
