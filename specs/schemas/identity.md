# Identity Schema

## Module Overview

Identity is a cross-cutting concern, not a feature module. It provides the foundational User entity, role/permission model, and tenant-configurable user profiles that all modules depend on.

**Data Ownership:**
- Owns: User, Role, Permission, RolePermission, UserRole, UserProfileSchema, UserProfile
- References: Keycloak (external IdP), Tenant (control plane)

**Purpose:**
Provide a stable identity anchor, fine-grained RBAC, and tenant-configurable user attributes without coupling identity to any specific module's concerns.

## Entities

### User

**Description:**
The core identity record for a person within a tenant. Intentionally minimal — business attributes live in UserProfile, module data lives in modules.

**Tenant Scope:** Tenant-scoped

**Lifecycle:** JIT provisioned on first auth, or created by admin invite. Suspendable, deactivatable (soft delete). Never hard-deleted.

**Key Fields:**
- `user_id` — UUID, primary key
- `tenant_id` — owning tenant, immutable after creation
- `idp_subject` — Keycloak `sub` claim, immutable, unique within tenant
- `email` — synced from IdP claims, mutable
- `display_name` — synced from IdP claims, mutable
- `status` — `active`, `suspended`, `deactivated`
- `created_at` — creation timestamp
- `updated_at` — last modification

**Invariants:**
- `(tenant_id, idp_subject)` is unique
- `(tenant_id, email)` is unique
- Status transitions: active↔suspended, active→deactivated, suspended→deactivated. No return from deactivated.
- User is never hard-deleted (audit trail integrity)

---

### Permission

**Description:**
A system-defined capability atom. Permissions represent specific actions the platform knows about. Modules declare their permissions in their manifests. Tenants cannot create or modify permissions — they compose them into Roles.

**Tenant Scope:** Global (platform-defined). Not tenant-scoped.

**Lifecycle:** Created when a module is registered. Immutable once published. Deprecated (not deleted) when a module version removes an action.

**Key Fields:**
- `permission_id` — UUID, primary key
- `code` — unique string, format: `{module}.{resource}.{verb}` (e.g., `content.pages.create`, `badges.definitions.update`, `audit.history.view`)
- `module_id` — which module declared this permission
- `description` — human-readable explanation
- `status` — `active`, `deprecated`
- `created_at` — when registered

**Invariants:**
- `code` is globally unique
- `code` format matches the actionId format in `crosscut/authz.md` — these are the same atoms
- Permissions are never deleted, only deprecated (existing role assignments remain valid until role is updated)
- Every actionId in a module manifest MUST have a corresponding Permission

**Relationship to ActionId:**
The `permission.code` and the `actionId` in intent payloads use the same namespace. When the ABAC engine evaluates a policy, it checks whether the principal's roles include a permission whose code matches the intent's actionId. This is the bridge between Roles (identity layer) and policy evaluation (authz layer).

---

### Role

**Description:**
A tenant-defined grouping of permissions. Roles are how tenants compose fine-grained access control without touching individual permissions. A tenant might create "Content Editor", "Badge Administrator", "Read-Only Auditor", each with a different set of permissions.

**Tenant Scope:** Tenant-scoped. Each tenant defines their own roles.

**Lifecycle:** Created by tenant admin. Mutable (permissions can be added/removed). Can be archived.

**Key Fields:**
- `role_id` — UUID, primary key
- `tenant_id` — owning tenant
- `name` — unique within tenant, human-readable (e.g., "Content Editor")
- `description` — optional, explains the role's purpose
- `is_system` — boolean, true for platform-provided default roles (tenant can't delete, can customize permissions)
- `status` — `active`, `archived`
- `created_at` — creation timestamp
- `updated_at` — last modification

**Invariants:**
- `(tenant_id, name)` is unique
- System roles (`is_system = true`) cannot be deleted, but their permission assignments CAN be customized by the tenant
- Archiving a role revokes it from all users who have it

**Default System Roles:**
Created for every new tenant. Tenants can customize their permissions but not delete them.
- `Tenant Admin` — all permissions for all modules enabled for the tenant
- `User` — baseline permissions (view content, earn badges, participate in messaging)

---

### RolePermission

**Description:**
Join between Role and Permission. Defines which permissions a role grants.

**Tenant Scope:** Tenant-scoped (inherits from Role)

**Key Fields:**
- `role_id` — references Role
- `permission_id` — references Permission
- `tenant_id` — denormalized for query efficiency and tenant isolation
- `granted_at` — when this permission was added to the role

**Invariants:**
- `(role_id, permission_id)` is unique
- A role can only include permissions for modules that are enabled for the tenant
- Removing a permission from a role takes effect immediately for all users with that role

---

### UserRole

**Description:**
Assignment of a role to a user. This is the primary mechanism for granting access.

**Tenant Scope:** Tenant-scoped

**Key Fields:**
- `user_id` — references User
- `role_id` — references Role
- `tenant_id` — denormalized for query efficiency and tenant isolation
- `assigned_by` — user_id of the admin who made the assignment
- `assigned_at` — when the role was assigned
- `expires_at` — optional, for time-limited role assignments (e.g., temporary admin access)

**Invariants:**
- `(user_id, role_id)` is unique
- User and Role must belong to the same tenant
- Expired role assignments are treated as inactive (not deleted, for audit trail)
- Deactivating a user revokes all their role assignments

---

### UserProfileSchema

**Description:**
A tenant-defined JSON Schema that governs what custom fields exist on user profiles for that tenant.

**Tenant Scope:** Tenant-scoped. Each tenant has their own profile schema (or none).

**Lifecycle:** Created by tenant admin. Versioned — new versions can be published. Only one version is active at a time.

**Key Fields:**
- `schema_id` — UUID, primary key
- `tenant_id` — owning tenant
- `schema` — JSON Schema definition
- `version` — integer, monotonically increasing
- `status` — `draft`, `active`, `deprecated`
- `created_at` — when this version was created

**Invariants:**
- At most one `active` schema per tenant at any time
- Publishing a new version automatically deprecates the previous active version
- Draft schemas can be tested but not enforced

---

### UserProfile

**Description:**
Tenant-configurable attributes for a user, stored as schema-validated JSONB. This is where "department", "employee_id", "hire_date", "office_location" etc. live.

**Tenant Scope:** Tenant-scoped

**Key Fields:**
- `user_id` — references User, primary key (one profile per user)
- `tenant_id` — owning tenant
- `profile_data` — JSONB, validated against tenant's active UserProfileSchema
- `schema_version` — which schema version this data was last validated against
- `updated_at` — last modification

**Invariants:**
- Profile data MUST be valid against the tenant's active schema at write time
- If tenant's schema version is newer than `schema_version`, profile is flagged for revalidation on next read
- Profile data is retained even when user is deactivated (for audit/reporting)

## Relationships

### Internal Relationships

**User → UserProfile** (one-to-one)
- Each user has at most one profile per tenant
- Profile is optional — users function without profile data

**User → UserRole → Role** (many-to-many)
- Users can have multiple roles
- Roles can be assigned to multiple users

**Role → RolePermission → Permission** (many-to-many)
- Roles contain multiple permissions
- Permissions can appear in multiple roles

**UserProfileSchema → UserProfile** (one-to-many)
- Active schema governs all profiles for that tenant

### Cross-Module Relationships

**User → BusinessUnitMembership (modules/org)**
- Org module tracks which business units a user belongs to
- References user_id

**User → UserPointBalance (modules/points)**
- Points module owns per-user balances
- References user_id

**User → BadgeAward (modules/badges)**
- Badges module owns per-user awards
- References user_id

**User → Intent history (modules/audit)**
- Audit module records intents with principal_id → user_id

**Permission.code ↔ ActionId (crosscut/authz)**
- Same namespace. Permissions define what actions exist. AuthZ evaluates whether a principal has them.

## Derived / Computed Concepts

**Effective Permissions:**
- Not stored. Computed at authorization time.
- For a given user: collect all active, non-expired UserRole assignments → collect all RolePermission entries for those roles → union of permission codes = effective permissions.
- This set is what the ABAC engine checks against the intent's actionId.
- Should be cached per-user with invalidation on role assignment changes or role permission changes.

**User Directory View:**
- Combines User + UserProfile + UserRole for admin search/listing.
- Projected from the underlying tables, not a separate entity.
- Supports search by: email, display_name, role name, profile fields (JSONB), status, business unit membership.

## Events & Audit Implications

**User Lifecycle Events:**
- `user_created` — JIT provisioned or admin-invited
- `user_suspended` — admin action
- `user_reactivated` — admin action (suspended → active)
- `user_deactivated` — admin action (permanent)
- `user_profile_updated` — user or admin updates profile data

**Role Management Events:**
- `role_created` — admin creates new role
- `role_updated` — admin changes role name/description
- `role_archived` — admin archives role
- `role_permission_granted` — permission added to role
- `role_permission_revoked` — permission removed from role

**User Role Assignment Events:**
- `user_role_assigned` — admin assigns role to user
- `user_role_revoked` — admin revokes role from user
- `user_role_expired` — system auto-expires a time-limited assignment

**Profile Schema Events:**
- `profile_schema_created` — admin creates draft schema
- `profile_schema_published` — admin activates schema version
- `profile_schema_deprecated` — previous version deprecated on new publish

All events are consumed by `modules/audit` for intent history.

## Open Questions

- Should effective permissions be cached in a projection, or computed on every request?
- How are permissions discovered by the UI? (API endpoint that lists all permissions for the tenant's enabled modules?)
- Should there be permission groups / categories for the role editor UI? (e.g., "Content Permissions", "Badge Permissions")
- Is there a SCIM endpoint for bulk user provisioning from external HR systems?
- Should role assignment support scoping to a business unit? (e.g., "Content Editor for Sales team only")
- How are permission conflicts surfaced to admins? (e.g., role grants `content.pages.create` but a deny policy blocks it)
- Should there be a "preview" mode where an admin can see what a user with a given role would be able to do?
- How do time-limited role assignments interact with the cache invalidation strategy?
