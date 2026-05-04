# Organization Module Events

## Intents Emitted

### User Management

**user_invited**
- When: Admin invites a new user via email
- Context: email, display_name (optional), initial role assignments, tenant
- Side effects: triggers Keycloak invitation flow

**user_suspended**
- When: Admin suspends an active user
- Context: user_id, reason (optional), tenant
- Side effects: user cannot authenticate, role assignments preserved

**user_reactivated**
- When: Admin reactivates a suspended user
- Context: user_id, tenant
- Side effects: user can authenticate again, existing role assignments resume

**user_deactivated**
- When: Admin permanently deactivates a user
- Context: user_id, tenant
- Side effects: all role assignments revoked, user cannot authenticate, irreversible

**user_profile_updated**
- When: Admin edits a user's profile fields
- Context: user_id, changed_fields (field names + new values), schema_version, tenant
- Side effects: profile data validated against active schema

### Role Management

**role_created**
- When: Admin creates a new tenant-defined role
- Context: role_id, name, description, initial permission assignments, tenant

**role_updated**
- When: Admin changes role name or description
- Context: role_id, changes made, tenant

**role_archived**
- When: Admin archives a role
- Context: role_id, name, affected_user_count, tenant
- Side effects: role revoked from all assigned users, effective permissions cache invalidated

**role_permission_granted**
- When: Admin adds a permission to a role
- Context: role_id, permission_code, tenant
- Side effects: effective permissions cache invalidated for all users with this role

**role_permission_revoked**
- When: Admin removes a permission from a role
- Context: role_id, permission_code, tenant
- Side effects: effective permissions cache invalidated for all users with this role

**user_role_assigned**
- When: Admin assigns a role to a user
- Context: user_id, role_id, expires_at (optional), assigned_by, tenant
- Side effects: effective permissions cache invalidated for this user

**user_role_revoked**
- When: Admin revokes a role from a user
- Context: user_id, role_id, revoked_by, tenant
- Side effects: effective permissions cache invalidated for this user

### Profile Schema Management

**profile_schema_created**
- When: Admin creates a new draft profile schema version
- Context: schema_id, version, field_definitions, tenant

**profile_schema_published**
- When: Admin publishes a draft schema, making it active
- Context: schema_id, version, previous_version (deprecated), affected_profile_count, tenant
- Side effects: previous active schema deprecated, profiles flagged for revalidation

### Business Unit Management

**business_unit_created**
- When: Admin creates a new business unit
- Context: business unit name, description, tenant

**business_unit_updated**
- When: Admin modifies business unit (name, description)
- Context: business unit ID, changes made, tenant

**business_unit_deleted**
- When: Admin deletes a business unit
- Context: business unit name, member count, tenant

**user_added_to_business_unit**
- When: Admin adds a user to a business unit
- Context: user ID, business unit ID, tenant

**user_removed_from_business_unit**
- When: Admin removes a user from a business unit
- Context: user ID, business unit ID, tenant

**business_unit_nested**
- When: Admin adds a business unit as a member of another business unit
- Context: parent business unit ID, child business unit ID, tenant

**business_unit_unnested**
- When: Admin removes a nested business unit relationship
- Context: parent business unit ID, child business unit ID, tenant

**bulk_users_added_to_business_unit**
- When: Admin adds multiple users at once (via search + bulk select)
- Context: business unit ID, user count, search criteria used, tenant

## Intents Consumed

**user_authenticated** (from crosscut/identity — system event)
- When: User successfully authenticates via Keycloak for the first time in this tenant
- Action: JIT provision — create User record if none exists for this `(tenant_id, idp_subject)`
- Context: idp_subject, email, display_name (from JWT claims), tenant

**user_role_expired** (from system — time-based)
- When: A time-limited role assignment reaches its `expires_at` timestamp
- Action: Mark assignment as expired, invalidate effective permissions cache
- Context: user_id, role_id, tenant

## Event Integration

**Outbound — Authorization**
- Role and permission changes trigger cache invalidation for effective permissions
- Cache key pattern: `authz:permissions:{tenant_id}:{user_id}` (I9 compliant)
- Invalidation is event-driven via tags (I10 compliant)

**Outbound — Cross-Module**
- User deactivation events notify other modules to handle cleanup (e.g., remove from active messaging)
- Business unit membership changes may affect permissions in comms, badges
- Role changes affect what users can access across all modules

**Used By**
- **crosscut/authz** — effective permissions resolution, cache invalidation
- **modules/comms** — queries business unit membership for messaging permissions
- **modules/badges** — may query business units or roles for badge eligibility
- **modules/points** — may query roles for point grant targeting
- **modules/audit** — records ALL org intents in intent history

## Open Questions

- Are there webhooks or notifications when business unit membership changes?
- Do other modules cache business unit membership or query on-demand?
- Is there an event for "user's business unit membership resolved" (computed with nesting)?
- How does the system handle Keycloak-side changes (user deleted in Keycloak but not in Atlas)?
- Should role assignment/revocation events include the full permission set or just the role reference?
