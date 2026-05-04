# Organization Module

## Purpose

Manages users, roles, and organizational structure within a tenant. This module owns the tenant-facing administration of identity and access: user directory, role management, profile schema configuration, and business units.

**Note:** The cross-cutting identity infrastructure (User entity, Permission, Role data model) is defined in `crosscut/identity.md` and `schemas/identity.md`. This module provides the **admin surfaces and workflows** for managing that data.

## Responsibilities

### User Management
- View and search users within the tenant (user directory)
- Invite new users (triggers Keycloak invitation flow)
- Suspend, reactivate, and deactivate users
- View and edit user profiles (tenant-configurable fields)
- Assign and revoke roles for users

### Role Management
- Create, edit, and archive tenant-defined roles
- Assign permissions to roles (from the set of permissions available for the tenant's enabled modules)
- View default system roles (Tenant Admin, User) and customize their permissions

### Profile Schema Management
- Define and publish the tenant's user profile schema (what custom fields exist on user profiles)
- Preview schema changes before publishing

### Business Unit Management
- Create and manage business units (named collections of users and/or other business units)
- Add/remove users from business units
- Support nested business units (business unit contains other business units)
- Provide business unit membership query API for other modules
- Provide seamless user search and bulk addition capabilities

## Owned Data

**User Directory** (admin view over identity data)
- User listing, search, filtering (by role, status, profile fields, business unit)

**Roles** (tenant-defined)
- Role name, description, permission assignments, status

**User Profile Schema** (tenant-defined)
- JSON Schema defining custom user profile fields

**Business Units**
- Business unit name, description, tenant scope, parent business unit (for nesting)

**Business Unit Membership**
- User-to-business-unit associations
- Business-unit-to-business-unit associations (nesting)

## Dependencies

### Consumed Services
- `crosscut/identity` — User entity, Permission definitions, Role/UserRole data model
- Keycloak — user invitation, IdP subject binding
- Schema Registry — profile schema storage and validation

### Consumed By
- **modules/comms** — messaging widget uses business units for send/view permissions
- **modules/badges** — badge rules may target business units or roles
- **modules/points** — point grants may target roles or business units
- **modules/import** — spreadsheet uploads may reference business units
- **modules/audit** — all org management intents recorded in intent history
- Any feature requiring organizational segmentation or role-based targeting

## Runtime Behavior

**User Management**
1. Admin views user directory (paginated list with search/filter)
2. Admin can invite a new user (email → Keycloak invitation → JIT provision on first login)
3. Admin can view user detail: identity, profile, roles, business unit memberships
4. Admin can edit user profile (validated against tenant's profile schema)
5. Admin can assign/revoke roles
6. Admin can suspend or deactivate a user

**Role Management**
1. Admin views list of roles (system roles + tenant-created)
2. Admin creates a new role with name and description
3. Admin assigns permissions to the role (grouped by module for discoverability)
4. Admin can modify permissions on existing roles (including system role customization)
5. Admin can archive a role (revokes from all assigned users)

**Profile Schema Management**
1. Admin views current active profile schema (field list with types)
2. Admin creates a new draft schema version (add/remove/modify fields)
3. Admin previews impact (how many existing profiles would fail validation)
4. Admin publishes new schema version (old version deprecated, profiles flagged for revalidation)

**Business Unit Management**
1. Admin creates business unit with name and description
2. Admin searches for users to add (by name, email, role, profile fields)
3. Admin adds users individually or in bulk
4. Admin can nest business units (add another business unit as a member)
5. Other modules query business unit membership for permission checks or targeting

## Integration Points

- User directory API for search across the platform
- Role/permission resolution for authorization (consumed by `crosscut/authz`)
- Business unit membership API for permission checks (consumed by comms, badges, etc.)
- Profile schema validation via schema registry
- Keycloak integration for user invitation and IdP subject binding
- Hierarchical queries (resolve nested business units)

## Open Questions

- Do nested business units imply transitive membership? (user in child unit is also in parent unit?)
- Is there a depth limit for nesting?
- Can a business unit belong to multiple parent units (graph vs. tree)?
- Are there default business units (e.g., "All Users")?
- Can business units be archived/deleted, and what happens to dependent configurations?
- Is there an org chart visualization?
- Should role assignment support scoping to a business unit? (e.g., "Content Editor for Sales team only")
- How does user invitation integrate with Keycloak? (API call, email template, etc.)
- Should there be a user import surface (CSV/SCIM) or is that handled by the import module?
- How are profile schema changes communicated to users whose profiles need updating?
