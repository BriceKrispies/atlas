# Security

## Role-Based Access Patterns

### Roles Implied by Features

**Tenant Admin**
- Access to all admin pages: Tokens, Email Templates, Business Units, Points, Email Notifications, Badges
- Can configure widgets: Announcements, Messaging
- Can manage media library categories and file visibility
- Can perform spreadsheet uploads (possibly admin-only)
- Full read access to intent history within their tenant

**End User**
- Can view announcements (widget)
- Can participate in messaging (subject to widget configuration)
- Can upload/view media (subject to privacy rules)
- Can earn badges and points
- May have limited access to their own intent history

**Role Determination**
- Features marked "admin page" or "tenant admin" require tenant admin role
- Features marked "widget" or "user" are accessible to end users
- Features marked "maybe admin only" are uncertain (see specific module TODOs)

### Permission Patterns

**Page Access**
- Admin pages require tenant admin role
- Permission checks occur before page load

**Widget Configuration**
- Only tenant admins can configure widgets
- Configuration determines who can view/interact with the widget instance

**Data Privacy**
- Users can only see data within their tenant
- Media library files are private by default, require explicit public toggle
- Email notifications are admin-visible only
- Intent history is read-only

**Business Unit Permissions**
- Messaging widget allows "arbitrary configuration of who can send and view messages for business units"
- Specific permission model is undefined (see modules/comms TODO)

## Authentication & Authorization

### Assumptions

- User authentication exists and provides tenant + role context
- Session management is handled by the platform
- Password policies and MFA are out of scope for these features

### Open Questions

- What is the full role hierarchy? (e.g., are there department admins, moderators, etc.?)
- Can tenant admins delegate permissions to other users?
- How granular are business unit permissions? (read vs. send, etc.)
- Is there role-based data filtering within tenant (e.g., HR sees different data than Sales)?
- Can end users configure widgets for themselves, or only admins?
