# Badges Module Schema

## Module Overview

The badges module owns badge definitions and badge awards: awarding badges to users based on their intents and roles, granting points, and sending email notifications.

**Data Ownership:**
- Owns: Badge definitions, badge awards
- References: Intents (modules/audit) for criteria evaluation, Points (modules/points) for rewards, Email templates (modules/comms) for notifications, Media files (modules/content) for badge images, User roles (external)

**Purpose:**
Recognize user achievements through badge awards, trigger point grants, and notify users via email.

## Entities

### BadgeDefinition

**Description:**
A badge that can be earned by users based on intent-based criteria (e.g., "upload 10 files") or role-based criteria (e.g., "has role Manager").

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created by tenant admin
- Updated by tenant admin (name, description, criteria, point reward, image, email template)
- Deleted by tenant admin
- Mutable configuration entity

**Key Fields:**
- badge_id — unique identifier
- tenant_id — owning tenant
- name — badge name
- description — badge description
- criteria — JSON payload defining badge criteria (intent-based or role-based)
- points_reward — point amount to grant when badge is awarded
- image_file_id — reference to MediaFile in modules/content (badge image)
- email_template_id — reference to EmailTemplate in modules/comms (notification template)
- created_at — creation timestamp
- updated_at — last modification timestamp

**Invariants:**
- Badge criteria can be intent-based (count of specific intent type) or role-based
- Badge awards trigger point grants and email sends
- Badge image must exist in media library (modules/content)
- Email template must exist in comms module
- Badge evaluation respects tenant boundaries

---

### BadgeAward

**Description:**
An immutable record of a badge being awarded to a user, including the points granted and timestamp.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when badge criteria is met and badge is awarded
- Never updated or deleted
- Append-only / immutable

**Key Fields:**
- award_id — unique identifier
- user_id — user who earned the badge
- badge_id — which badge was awarded
- tenant_id — owning tenant
- points_granted — point amount granted with this award
- awarded_at — timestamp when badge was awarded
- created_at — record creation timestamp

**Invariants:**
- Badge awards are immutable
- Each badge award generates an intent (`badge_awarded`) for audit
- Badge awards trigger point grants (PointTransaction in modules/points)
- Badge awards trigger email sends (EmailNotification in modules/comms)
- Users may earn the same badge multiple times (or only once, unclear from spec)

## Relationships

### Internal Relationships

**BadgeDefinition → BadgeAward**
- Cardinality: One-to-many (one badge can be awarded to many users)
- Directionality: BadgeAward references BadgeDefinition
- Notes: Award records which badge was earned

### Cross-Module Relationships

**BadgeDefinition → (references) → MediaFile (modules/content)**
- Cardinality: Many-to-one (many badges can use same image)
- Directionality: References
- Notes: image_file_id must exist in modules/content

**BadgeDefinition → (references) → EmailTemplate (modules/comms)**
- Cardinality: Many-to-one (many badges can use same email template)
- Directionality: References
- Notes: email_template_id must exist in modules/comms

**BadgeDefinition → (queries) → Intent (modules/audit)**
- Cardinality: Many-to-many (badge criteria queries intents)
- Directionality: BadgeDefinition queries Intent for criteria evaluation
- Notes: Intent-based criteria like "10 file_uploaded intents" requires querying modules/audit

**BadgeDefinition → (references) → User Roles (external)**
- Cardinality: Many-to-many (role-based badges reference roles)
- Directionality: References role system (external to these specs)
- Notes: Role-based criteria like "has role Manager" requires querying user roles

**BadgeAward → (triggers) → PointTransaction (modules/points)**
- Cardinality: One-to-one or one-to-many (one award triggers one point transaction)
- Directionality: BadgeAward triggers point grant
- Notes: When badge is awarded, points module is called to grant points_reward

**BadgeAward → (triggers) → EmailNotification (modules/comms)**
- Cardinality: One-to-one (one award triggers one email)
- Directionality: BadgeAward triggers email send
- Notes: When badge is awarded, comms module is called to send notification email

**BadgeAward → (references) → User (external)**
- Cardinality: Many-to-one (many awards to one user)
- Directionality: References user directory
- Notes: user_id must exist in user management system

## Derived / Computed Concepts

**Badge Eligibility:**
- Not stored separately
- Computed by evaluating badge criteria against user intents and roles
- For intent-based: query modules/audit for user's intent counts
- For role-based: query user role system
- Evaluation triggered by intent creation, role change, manual trigger, or batch process (spec unclear)

**Badge Award Flow:**
- Multi-step process:
  1. Evaluate criteria → determine eligibility
  2. Create BadgeAward record
  3. Call modules/points to grant points_reward → creates PointTransaction
  4. Call modules/comms to send email → creates EmailNotification
  5. Emit `badge_awarded` intent → recorded in modules/audit
- Flow is orchestrated but not stored as separate entity

**Badge Leaderboard / User Badge Collection:**
- Derived from BadgeAward: query all awards for a user
- Can be displayed in user profile or leaderboard
- Not stored separately

## Events & Audit Implications

**Intents Emitted:**
- `badge_created` — admin creates badge definition (mutable admin activity)
- `badge_updated` — admin modifies badge definition (mutable admin activity)
- `badge_deleted` — admin deletes badge definition (mutable admin activity)
- `badge_awarded` — user earns badge (immutable event)
- `badge_evaluation_triggered` (possibly) — badge evaluation process runs (for audit, possibly)
- `badge_revoked` (possibly) — badge removed from user (if supported, immutable event)
- `manual_badge_award` (possibly) — admin manually awards badge (if supported, immutable event)

**Downstream Intents:**
- Badge award triggers `points_awarded` intent (modules/points)
- Badge award triggers `email_sent` intent (modules/comms)

**Immutability:**
- BadgeDefinition is mutable
- BadgeAward is immutable (append-only)

**Audit Dependency:**
- All badge management and award intents are consumed by modules/audit for history tracking
- Badges module queries modules/audit to evaluate intent-based criteria

## Open Questions

### Badge Evaluation Trigger
- When is badge evaluation triggered? (real-time on every intent, periodic batch, manual trigger?)
- If real-time, how are performance concerns addressed (querying intents for every user on every action)?
- If batch, how often does it run? (nightly, hourly?)

### Badge Criteria Complexity
- Can criteria be combined (e.g., "10 intents AND has role X")?
- Can criteria reference multiple intent types (e.g., "5 file_uploaded AND 3 badge_awarded")?
- Can criteria filter intents by context (e.g., "10 file_uploaded where file size > 1MB")?
- What is the UI for defining criteria? (form builder, JSON editor, wizard?)

### Badge Criteria Storage
- How is the criteria JSON payload structured?
- Is there a schema or validation for criteria?
- Can criteria reference business units, dates, or other constraints?

### Badge Award Duplication
- Can users earn the same badge multiple times, or is it one-time only?
- If multiple times, is there a cooldown or limit?
- How is this tracked in BadgeAward? (one record per award, or count field?)

### Badge Revocation
- Can badges be revoked if criteria no longer met (e.g., role changed)?
- If revoked, is points_granted deducted from user balance?
- Is revocation tracked as separate entity or just deletion of BadgeAward?

### Manual Badge Awards
- Can admins manually award badges (bypass criteria)?
- If so, how is this tracked? (flag in BadgeAward, separate ManualBadgeAward entity, intent only?)
- Is there approval workflow or audit trail beyond the intent?

### Badge Prerequisites
- Can badges have prerequisites (must earn Badge A before eligible for Badge B)?
- If so, how is this represented in BadgeDefinition.criteria?

### Badge Tiers
- Are there badge tiers or levels (Bronze, Silver, Gold)?
- Or is each tier a separate badge?

### Badge Deletion and References
- What happens when a badge definition is deleted?
- Do existing BadgeAward records remain? (orphaned references?)
- Is deletion prevented if awards exist?

### Image and Template References
- What happens when image_file_id references a file that is deleted or toggled private?
- What happens when email_template_id references a template that is deleted?
- Is deletion prevented, or are references allowed to break?

### Badge Evaluation Performance
- How is badge evaluation optimized for large numbers of users and intents?
- Is there caching or pre-aggregation of intent counts?
- Can badge evaluation be paused or throttled during high-load periods?

### Badge Notification Failure
- If email send fails, is badge still awarded?
- Is there retry logic for failed email sends?
- How is email failure surfaced to admin?

### Badge Display
- Is there a user-facing badge display page or widget?
- Can users see their earned badges and progress toward unearned badges?
- Are badges displayed with images from media library?

### Badge Award History
- Can admins view badge award history (who earned which badges)?
- Is this a separate UI or derived from BadgeAward query?
- Can history be filtered by badge, user, date range?

### Role-Based Badge Evaluation
- How are role changes detected for role-based badge evaluation?
- Does user role system emit intents that trigger badge evaluation?
- Or is role-based evaluation batch-only?

### Badge Criteria Change Impact
- What happens when badge criteria is changed after some users already earned it?
- Are existing awards retroactively revoked?
- Or are existing awards grandfathered in?
