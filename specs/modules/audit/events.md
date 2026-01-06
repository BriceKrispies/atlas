# Audit Module Events

## Intents Emitted

The audit module itself does not typically emit intents; it is a sink for intents from other modules. However, there may be meta-events:

**intent_history_queried**
- When: Admin or module queries intent history (possibly, for audit of audit access)
- Context: querying user/module, filter criteria, result count, timestamp, tenant
- Note: May be high-volume; consider whether to record

**intent_history_exported**
- When: Admin exports intent history to file
- Context: export format, filter criteria, record count, admin ID, tenant

## Intents Consumed

**ALL intents from all modules:**
- modules/tokens: token_created, token_updated, token_deleted, token_evaluated (possibly)
- modules/comms: email_sent, email_status_updated, message_sent, template_created, etc.
- modules/org: business_unit_created, user_added_to_business_unit, etc.
- modules/content: file_uploaded, file_privacy_toggled, announcement_configured, etc.
- modules/points: points_awarded, points_deducted, points_configuration_updated, etc.
- modules/import: spreadsheet_uploaded, spreadsheet_validated, import_committed, etc.
- modules/badges: badge_awarded, badge_rule_created, etc.

The audit module is the central repository for all system activity.

## Event Integration

**Inbound**
- Receives all intents from every module
- Stores intents immutably for historical record

**Outbound**
- Provides intent query API for badges (evaluate badge criteria based on user intents)
- Provides intent display for admin UI
- May feed analytics or reporting systems

## Open Questions

- Is there a pub/sub or event bus architecture for intent distribution?
- Are intents written synchronously or queued asynchronously?
- Is there a circuit breaker if audit module is down (prevent cascading failures)?
- Are there performance metrics on intent write throughput?
- Can modules query intents in real-time, or is there a delay?
