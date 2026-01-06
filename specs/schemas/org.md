# Organization Module Schema

## Module Overview

The org module owns the organizational structure within a tenant through business units: named collections of users and/or other business units.

**Data Ownership:**
- Owns: Business units, business unit membership (user-to-unit and unit-to-unit)
- References: User directory (external to these specs)

**Purpose:**
Provide organizational segmentation for permissions, messaging, and badge targeting.

## Entities

### BusinessUnit

**Description:**
A named collection of users and/or other business units within a tenant. Used for organizing users and targeting communications/permissions.

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created by tenant admin
- Updated by tenant admin (name, description)
- Deleted by tenant admin (with warnings if referenced by other modules)
- Mutable configuration entity

**Key Fields:**
- business_unit_id — unique identifier
- tenant_id — owning tenant
- name — unique name within tenant
- description — optional descriptive text
- parent_unit_id — reference to parent business unit (for nesting), nullable
- created_at — creation timestamp
- updated_at — last modification timestamp

**Invariants:**
- Business unit name must be unique within a tenant
- Business units can be nested (parent_unit_id references another business unit)
- Circular nesting must be prevented (unit A → unit B → unit A)
- All business units are tenant-scoped
- Business units cannot reference users or units from other tenants

---

### BusinessUnitMembership

**Description:**
Association between a business unit and its members (users or nested business units).

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created when admin adds user or business unit to a business unit
- Deleted when admin removes member
- Mutable association (can be added/removed)

**Key Fields:**
- membership_id — unique identifier
- business_unit_id — the business unit
- tenant_id — owning tenant (for isolation)
- user_id — member user (nullable, mutually exclusive with child_business_unit_id)
- child_business_unit_id — member business unit (nullable, mutually exclusive with user_id)
- created_at — when membership was created

**Invariants:**
- Exactly one of user_id or child_business_unit_id must be populated (not both, not neither)
- User can belong to multiple business units
- Business unit can belong to multiple parent business units (graph structure, unless tree is enforced)
- Circular nesting must be prevented
- All memberships are tenant-scoped

## Relationships

### Internal Relationships

**BusinessUnit → (parent-child) → BusinessUnit**
- Cardinality: One-to-many (one parent can have many child units)
- Directionality: parent_unit_id in BusinessUnit references another BusinessUnit
- Notes: Supports nested organizational structures; circular references must be prevented

**BusinessUnit → (members) → BusinessUnitMembership**
- Cardinality: One-to-many (one business unit has many memberships)
- Directionality: Owns
- Notes: Membership tracks both user and business unit members

### Cross-Module Relationships

**BusinessUnitMembership → (references) → User (external)**
- Cardinality: Many-to-one (many memberships to one user)
- Directionality: References user directory (external to these specs)
- Notes: user_id must exist in user management system

**BusinessUnit → (referenced by) → MessagingWidgetConfig (modules/comms)**
- Cardinality: One-to-many (one business unit can be in many widget configs)
- Directionality: Referenced by
- Notes: Messaging widget permissions reference business units

**BusinessUnit → (referenced by) → Message (modules/comms)**
- Cardinality: One-to-many (one business unit receives many messages)
- Directionality: Referenced by
- Notes: Messages are sent to business units

**BusinessUnit → (referenced by) → Badge criteria (modules/badges)**
- Cardinality: One-to-many (business units may be used in badge targeting)
- Directionality: Referenced by (possibly)
- Notes: Spec mentions badges may target business units, but details are unclear

## Derived / Computed Concepts

**Resolved Business Unit Membership:**
- Not stored separately
- Computed at query time: given a user, resolve all business units they belong to (direct and transitive through nesting)
- Involves graph traversal if nesting is supported
- Cached or computed on-demand (spec does not specify)

**Business Unit Hierarchy:**
- Derived from parent_unit_id relationships
- Can be visualized as org chart (spec mentions this as open question)
- Tree or graph structure (depends on whether multi-parent is allowed)

**Bulk User Addition from Searches:**
- Spec mentions "all users with 'manager' in username" or "all users in role 'Engineer'"
- Two possibilities:
  1. Static snapshot: search executes once, members added, no auto-update
  2. Dynamic query: search criteria saved, membership auto-updates when role/username changes
- Spec does not clarify which approach is used

## Events & Audit Implications

**Intents Emitted:**
- `business_unit_created` — admin creates business unit (mutable admin activity)
- `business_unit_updated` — admin modifies business unit (mutable admin activity)
- `business_unit_deleted` — admin deletes business unit (mutable admin activity)
- `user_added_to_business_unit` — admin adds user to business unit (mutable membership)
- `user_removed_from_business_unit` — admin removes user from business unit (mutable membership)
- `business_unit_nested` — admin adds business unit as member of another (mutable membership)
- `business_unit_unnested` — admin removes nested business unit (mutable membership)
- `bulk_users_added_to_business_unit` — admin adds multiple users at once (mutable membership)

**Immutability:**
- BusinessUnit is mutable
- BusinessUnitMembership is mutable (can be added/removed)
- All org changes generate audit intents for history tracking

**Audit Dependency:**
- All business unit management intents are consumed by modules/audit for history tracking
- Membership changes may trigger downstream effects in other modules (comms permissions, badge eligibility)

## Open Questions

### Business Unit Nesting Semantics
- Do nested business units imply transitive membership? (user in child unit is also in parent unit?)
- Can a business unit belong to multiple parent units (graph) or only one (tree)?
- Is there a depth limit for nesting?
- How is circular nesting detected and prevented?

### User Search and Bulk Addition
- What is the exact search syntax or UI for "all users with this in username" or "all users in this role"?
- Are these searches saved as dynamic queries (membership auto-updates) or static snapshots?
- If dynamic, how is membership recalculated? (on-demand, scheduled, real-time?)
- Can the search criteria be edited after initial bulk addition?

### Business Unit Lifecycle
- Can business units be archived instead of deleted?
- What happens to dependent configurations (messaging widgets, badge rules) when a business unit is deleted?
- Is there validation to prevent deleting business units in use?
- Can deleted business units be restored?

### Business Unit Metadata
- Can business units have custom fields or metadata beyond name and description?
- Is there a bulk import for business unit membership (via CSV)?

### Membership Resolution Performance
- How is membership resolved for nested structures? (recursive query, pre-computed, cached?)
- Is there caching of resolved membership to avoid repeated graph traversal?
- Do other modules query membership on-demand or subscribe to membership change events?

### Default Business Units
- Are there default business units (e.g., "All Users") created for each tenant?
- Are system-provided business units read-only or editable?

### Visualization
- Is there an org chart or hierarchy visualization feature?
- How is the business unit graph/tree displayed to admins?
