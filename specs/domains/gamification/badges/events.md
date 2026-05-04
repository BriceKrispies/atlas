# Badges Module Events

## Intents Emitted

**badge_created**
- When: Admin creates a new badge definition
- Context: badge name, criteria, point reward, tenant

**badge_updated**
- When: Admin modifies an existing badge definition
- Context: badge ID, changes made, tenant

**badge_deleted**
- When: Admin deletes a badge definition
- Context: badge name, existing award count, tenant

**badge_awarded**
- When: User earns a badge (criteria met)
- Context: user ID, badge ID, points granted, timestamp, tenant

**badge_evaluation_triggered**
- When: Badge evaluation process runs (possibly, for audit)
- Context: trigger type (real-time, batch, manual), user count evaluated, badges awarded, tenant

**badge_revoked**
- When: Badge is removed from a user (if supported)
- Context: user ID, badge ID, reason, tenant

**manual_badge_award**
- When: Admin manually awards a badge to a user
- Context: user ID, badge ID, admin ID, reason, tenant

## Intents Consumed

**ALL user intents from modules/audit**
- Badge evaluation queries intents to determine if users meet badge criteria
- Examples: "file_uploaded", "training_completed", "points_awarded", etc.
- Consumes intent counts, timestamps, and context for criteria matching

**Role changes (from user management system)**
- Role-based badge criteria depend on user role assignments
- Role changes may trigger badge evaluation

## Event Integration

**Inbound**
- Queries intents from **modules/audit** for criteria evaluation
- May subscribe to real-time intent stream for immediate badge evaluation

**Outbound**
- Triggers **modules/points** to award points
- Triggers **modules/comms** to send badge award emails
- Emits "badge_awarded" intent to **modules/audit**

**Integration Flow**
1. User performs action → intent recorded in audit
2. Badge module evaluates criteria (queries audit for intent counts)
3. If criteria met:
   - Award badge (write to badge_awards table)
   - Call points module to grant points → generates "points_awarded" intent
   - Call comms module to send email → generates "email_sent" intent
   - Emit "badge_awarded" intent to audit

## Open Questions

- Is badge evaluation event-driven (real-time on every intent) or batch (scheduled)?
- Are there performance concerns with querying intents for every user on every action?
- Is there caching or pre-aggregation of intent counts for performance?
- Can badge evaluation be paused or throttled during high-load periods?
- Are there webhooks or notifications for badge awards beyond email?
