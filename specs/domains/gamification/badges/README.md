# Badges Module

## Purpose

Awards badges to users based on their intents and roles, grants associated points, and sends email notifications when badges are earned.

## Responsibilities

- Define badge rules (criteria for earning badges)
- Monitor user intents and role changes to detect badge eligibility
- Award badges when criteria are met
- Grant configured points upon badge award
- Send email notifications to users when they earn badges
- Track badge awards per user
- Display badge images from media library

## Owned Data

**Badge Definitions**
- Badge name, description, criteria (intent-based or role-based)
- Point reward amount
- Badge image (reference to media library file)
- Email template for notification
- Tenant scope

**Badge Awards**
- User-to-badge associations (who earned which badges and when)
- Points awarded with each badge
- Tenant scope

## Dependencies

### Consumed Services
- **modules/audit** — queries intents to evaluate badge criteria (e.g., "user uploaded 10 files")
- **modules/points** — awards points when badge is earned
- **modules/comms** — sends badge award email using template
- **modules/content** — retrieves badge images from media library
- **Role system** — checks user roles for role-based badge criteria

### Consumed By
- End users viewing their badge collection
- Leaderboards or profile pages (if applicable)
- **modules/audit** — badge awards generate intents

## Runtime Behavior

**Badge Award Flow**
1. User performs actions → intents recorded in audit module
2. Badge evaluation triggered (real-time, periodic batch, or on-demand)
3. Badges module queries audit for user's intents matching badge criteria
4. If criteria met (e.g., "uploaded 10 files", "has role Manager"):
   - Award badge to user
   - Call points module to grant configured points
   - Call comms module to send badge award email
   - Generate "badge_awarded" intent
5. User receives email: "Congratulations! You earned the [Badge Name] badge and [X] points"

**Badge Criteria Types**
- **Intent-based:** "Complete 5 'training_completed' intents"
- **Role-based:** "User has role 'Manager'"
- **Combined:** "User has role 'Sales' AND completed 10 'sales_call' intents"

**Email Notification**
- Uses email template from comms module
- Includes badge name, description, points awarded
- May include badge image

## Integration Points

- Intent query API from audit module
- Point award API from points module
- Email send API from comms module
- Media library image retrieval

## Open Questions

- When is badge evaluation triggered? (real-time, batch overnight, manual?)
- Can badges be revoked if criteria no longer met (e.g., role changed)?
- Can users earn the same badge multiple times, or only once?
- Are there badge tiers or levels (Bronze, Silver, Gold)?
- Is there a badge display page for users to see their collection?
- Can admins manually award badges?
- Are there badge expiration policies?
- Can badges have prerequisites (must earn Badge A before Badge B)?
