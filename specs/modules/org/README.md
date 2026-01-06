# Organization Module

## Purpose

Manages the organizational structure within a tenant through business units, which are named collections of users and/or other business units.

## Responsibilities

- Create and manage business units
- Add/remove users from business units
- Support nested business units (business unit contains other business units)
- Provide business unit membership query API for other modules
- Make business units globally available to widgets and features that need organizational structure
- Provide seamless user search and bulk addition capabilities

## Owned Data

**Business Units**
- Business unit name, description, tenant scope, parent business unit (for nesting)

**Business Unit Membership**
- User-to-business-unit associations
- Business-unit-to-business-unit associations (nesting)

## Dependencies

### Consumed Services
- User directory/management system (to search for users by username, role, etc.)

### Consumed By
- **modules/comms** — messaging widget uses business units for send/view permissions
- **modules/badges** — badge rules may target business units
- **modules/import** — spreadsheet uploads may reference business units
- Any feature requiring organizational segmentation

## Runtime Behavior

**Business Unit Management**
1. Admin creates business unit with name and description
2. Admin searches for users to add (by username, role, filters)
3. Admin adds users individually or in bulk
4. Admin can nest business units (add another business unit as a member)
5. Other modules query business unit membership for permission checks or targeting

**User Search Capabilities**
- Search by username pattern (e.g., "all users with 'smith' in username")
- Search by role (e.g., "all users in role 'Manager'")
- Bulk selection for adding multiple users at once

## Integration Points

- Business unit membership API for permission checks (consumed by comms, badges, etc.)
- User search/directory integration
- Hierarchical queries (resolve nested business units)

## Open Questions

- Do nested business units imply transitive membership? (user in child unit is also in parent unit?)
- Is there a depth limit for nesting?
- Can a user belong to multiple business units?
- Can a business unit belong to multiple parent units (graph vs. tree)?
- Are there default business units (e.g., "All Users")?
- Can business units be archived/deleted, and what happens to dependent configurations?
- Is there an org chart visualization?
