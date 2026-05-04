# Identity

This document defines the User entity and its relationship to authentication, authorization, and tenant-scoped data in the Atlas Platform.

## Design Principles

**Thin identity core.** The User entity is a stable identity anchor — it answers "who is this person" and nothing else. Business attributes, module-specific data, and tenant-configurable fields live in separate layers. The User table never absorbs module concerns.

**Keycloak is the authentication authority.** Atlas does not store passwords, manage sessions, or handle MFA. Keycloak owns the authentication lifecycle. The `idp_subject` field on User links to the Keycloak `sub` claim, and this is the only join point between the two systems.

**Tenant-configurable profiles.** Tenants need to track different things about their users (department, employee ID, hire date, office location). Rather than adding columns to User, tenants define a profile schema and user profiles are stored as schema-validated JSON. This uses the same schema registry infrastructure as module manifests.

**Module data stays in modules.** Points balance belongs to the points module. Badge awards belong to the badges module. Comms preferences belong to the comms module. If you find yourself wanting to add a field to User that relates to a specific module, that's a signal the data belongs in a module-owned projection, not in identity.

## Invariants

**INV-ID-001: Single Identity per Tenant**
A user has exactly one User record per tenant. The combination of `(tenant_id, idp_subject)` is unique. A person who exists in multiple tenants has separate User records with separate profile data.

**INV-ID-002: Keycloak Subject Binding**
Every User record is bound to a Keycloak subject (`idp_subject`). There is no User without a corresponding Keycloak identity. User creation is triggered by first successful authentication from Keycloak (JIT provisioning) or by admin invitation.

**INV-ID-003: User Table Stability**
The User table schema is fixed. Tenant-specific or module-specific attributes MUST NOT be added as columns to the User table. Use profile data (tenant-configurable) or module-owned data instead.

**INV-ID-004: Profile Schema Governance**
User profile data MUST be validated against the tenant's active profile schema before persistence. Invalid profile data is rejected, not silently stored.

**INV-ID-005: Identity Deletion is Soft**
Users are never hard-deleted. Deactivation sets `status = deactivated` and revokes all role assignments. The User record persists for audit trail integrity (referenced by events, intent history, etc.).

## User Entity

The core identity record. Intentionally minimal.

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | UUID | Primary key. Platform-generated. |
| `tenant_id` | String | Owning tenant. Immutable after creation. |
| `idp_subject` | String | Keycloak `sub` claim. Immutable. Unique within tenant. |
| `email` | String | User's email address. From Keycloak claims. Mutable (synced from IdP). |
| `display_name` | String | Human-readable name. From Keycloak claims. Mutable. |
| `status` | Enum | `active`, `suspended`, `deactivated`. See lifecycle below. |
| `created_at` | Timestamp | When the User record was created. Immutable. |
| `updated_at` | Timestamp | Last modification. Auto-updated. |

**What is NOT on this table:** roles, permissions, department, job title, profile photo, preferences, points balance, badge count, or any module-specific data.

## User Lifecycle

```
                  ┌─────────────┐
   JIT provision  │             │  Admin invite
   ─────────────► │   active    │ ◄───────────
                  │             │
                  └──────┬──────┘
                         │
              ┌──────────┼──────────┐
              ▼                     ▼
      ┌───────────┐        ┌──────────────┐
      │ suspended  │        │ deactivated  │
      └─────┬─────┘        └──────────────┘
            │                   ▲
            └───────────────────┘
              (can deactivate from suspended)

   suspended → active  (reactivation by admin)
   active → suspended  (temporary lock by admin)
   active → deactivated  (permanent off-board)
   suspended → deactivated  (permanent off-board)
   deactivated → (no return)
```

**JIT Provisioning:** When a user authenticates via Keycloak for the first time and no User record exists for their `(tenant_id, idp_subject)`, a User record is created automatically with `status = active`. Claims from the JWT (email, name) populate the initial record.

**Suspension:** Temporary. Suspended users cannot authenticate. Their data, role assignments, and profile remain intact. Admin can reactivate.

**Deactivation:** Permanent (within the system). All role assignments are revoked. Profile data is retained for audit. The User record is kept for referential integrity (events, intent history).

## User Profile (Tenant-Configurable)

Each tenant defines a **user profile schema** that specifies what additional attributes they want to track for their users.

### Profile Schema

Stored in the schema registry. Each tenant has at most one active user profile schema.

| Field | Type | Description |
|-------|------|-------------|
| `schema_id` | UUID | Primary key. |
| `tenant_id` | String | Owning tenant. |
| `schema` | JSON Schema | The profile field definitions. |
| `version` | Integer | Monotonically increasing. |
| `status` | Enum | `draft`, `active`, `deprecated` |
| `created_at` | Timestamp | When this schema version was created. |

**Example tenant profile schema:**
```json
{
  "type": "object",
  "properties": {
    "department": { "type": "string" },
    "employee_id": { "type": "string" },
    "hire_date": { "type": "string", "format": "date" },
    "office_location": { "type": "string" },
    "cost_center": { "type": "string" },
    "manager_user_id": { "type": "string", "format": "uuid" }
  },
  "required": ["department", "employee_id"]
}
```

### Profile Data

| Field | Type | Description |
|-------|------|-------------|
| `user_id` | UUID | References User. |
| `tenant_id` | String | Owning tenant. |
| `profile_data` | JSONB | Validated against tenant's active profile schema. |
| `schema_version` | Integer | Which schema version this data conforms to. |
| `updated_at` | Timestamp | Last modification. |

**Schema evolution:** When a tenant updates their profile schema (adds a field, changes a required field), existing profiles are validated against the new schema on next access. Profiles that don't conform are flagged for migration but not silently dropped.

## Relationship to Principal

The existing `Principal` struct (from `crosscut/authn.md`) is the **request-scoped** identity resolved during authentication. The User entity is the **persisted** identity.

```
Keycloak JWT  ──►  authn.rs resolves Principal  ──►  Principal.id maps to User.idp_subject
                   (request-scoped)                  (persistent record)
```

The Principal's `claims` HashMap may contain transient session data (token expiry, auth method). The User entity stores durable identity. The Principal's `tenant_id` is validated against the User's `tenant_id`.

## Relationship to Modules

Modules reference users by `user_id`. They do NOT embed user data.

| Module | User-related data owned by module |
|--------|----------------------------------|
| `org` | BusinessUnitMembership (which units a user belongs to) |
| `points` | UserPointBalance, PointTransaction |
| `badges` | BadgeAward (which badges a user has earned) |
| `comms` | Message sender/recipient references, notification preferences |
| `audit` | Intent history entries (principal_id references user) |
| `content` | Page author references |

**Rule:** If a module needs user data (email, display_name), it queries the User entity. It does not copy user fields into its own tables.

## Open Questions

- Should profile schema changes require approval or take effect immediately?
- Is there a profile data migration tool when schemas change (backfill defaults for new required fields)?
- Should the platform provide a "standard" profile schema that tenants can extend, or is it fully custom?
- How does user search work across profile fields? (JSONB indexing strategy)
- Is there a user import mechanism (bulk creation from CSV/SCIM)?
- Should there be a user merge capability (when duplicate Keycloak accounts are discovered)?
- How are user avatars / profile photos handled? (reference to media library, or separate?)
