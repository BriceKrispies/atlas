# Tenancy

## Tenant Boundary

All features in the system operate within tenant boundaries unless explicitly stated otherwise.

### Rules

- Every user belongs to exactly one tenant
- Business units, tokens, email templates, points, badges, and media are scoped to a single tenant
- Intents and email notifications are recorded per-tenant
- Cross-tenant data access is not permitted through user-facing features
- Tenant admins can only manage resources within their own tenant

### Data Isolation

- All database queries must filter by tenant ID
- File uploads in media library are tenant-scoped
- Email templates created by one tenant are not visible to other tenants
- Business units cannot contain users from other tenants
- Spreadsheet uploads process data only within the uploading user's tenant

### Configuration Scope

- Points value configuration is per-tenant
- Token definitions are per-tenant (each tenant can define `[site_url]` differently)
- Badge rules and awards are per-tenant
- Messaging widget configuration is per-tenant
- Announcement widget content is per-tenant

## Multi-Tenancy Assumptions

- The system supports multiple tenants concurrently
- Tenant admins are distinct from platform/system administrators
- No feature in the current list requires cross-tenant operations
- Tenant creation and management happens outside the scope of these features

## Open Questions

- Is there a super-admin or control plane role that spans tenants?
- How is tenant provisioning handled?
- Are there any shared resources (templates, media) across tenants?
