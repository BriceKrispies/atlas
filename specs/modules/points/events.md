# Points Module Events

## Intents Emitted

**points_configuration_updated**
- When: Admin changes the monetary value per point
- Context: old value, new value, tenant

**points_awarded**
- When: Points are added to a user's balance
- Context: user ID, amount, reason, source module (badges, import, manual), timestamp, tenant

**points_deducted**
- When: Points are removed from a user's balance (if supported)
- Context: user ID, amount, reason, source, timestamp, tenant

**points_balance_queried**
- When: External module queries a user's point balance (possibly, for analytics)
- Context: user ID, current balance, querying module, tenant
- Note: May be high-volume; consider whether to record

**manual_points_adjustment**
- When: Admin manually awards or deducts points
- Context: user ID, amount, reason, admin ID, tenant

## Intents Consumed

None directly. Points module is a service provider that responds to requests from other modules.

## Event Integration

**Outbound**
- Point awards and configuration changes generate audit intents
- Point transactions feed into user history and analytics

**Consumed By**
- **modules/audit** — all point transactions recorded in intent history
- **modules/tokens** — queries point balances for dynamic token evaluation
- **modules/badges** — awards points when badges are earned

**Triggered By**
- **modules/badges** — badge awards trigger point awards
- **modules/import** — spreadsheet uploads may trigger bulk point awards

## Open Questions

- Should point balance queries be logged as intents? (Could be very high-volume)
- Are there real-time notifications when users earn points?
- Do point awards trigger webhook or pub/sub events for external systems?
