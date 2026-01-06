# Tokens Module Schema

## Module Overview

The tokens module owns the token registry: a system for defining named placeholders that can be embedded in text (e.g., `[site_url]`, `[current_user_points]`) and dynamically evaluated at runtime.

**Data Ownership:**
- Owns: Token definitions (name, type, value/logic)
- References: User point balances (modules/points), other system state for dynamic token evaluation

**Purpose:**
Provide a reusable, tenant-scoped substitution system for dynamic content across the platform.

## Entities

### TokenDefinition

**Description:**
A named placeholder that can be evaluated to produce text. Tokens can be static (fixed value) or dynamic (evaluated from system state at runtime).

**Tenant Scope:** Tenant-scoped

**Lifecycle:**
- Created by tenant admin
- Updated by tenant admin (name, type, value/logic)
- Deleted by tenant admin
- Mutable configuration entity

**Key Fields:**
- token_id — unique identifier
- tenant_id — owning tenant
- token_name — unique name within tenant (e.g., `site_url`, `current_user_points`)
- token_type — static or dynamic
- static_value — fixed text value (for static tokens)
- evaluation_logic — how to resolve the token at runtime (for dynamic tokens)
- description — optional admin reference
- created_at — creation timestamp
- updated_at — last modification timestamp

**Invariants:**
- token_name must be unique within a tenant
- token_type must be either 'static' or 'dynamic'
- Static tokens must have static_value populated
- Dynamic tokens must have evaluation_logic defined
- Token names should follow consistent format (lowercase, underscores, no spaces)

## Relationships

### Internal Relationships
None — this module has a single entity.

### Cross-Module Relationships

**TokenDefinition → (references) → User Point Balances (modules/points)**
- Cardinality: Dynamic tokens may reference point balances (many-to-one per evaluation)
- Directionality: References (read-only query during evaluation)
- Notes: Dynamic tokens like `[current_user_points]` query the points module at evaluation time

**TokenDefinition → (referenced by) → EmailTemplate (modules/comms)**
- Cardinality: One token can be used in many email templates (one-to-many)
- Directionality: Referenced by
- Notes: Email templates embed token placeholders; token evaluation happens at email send time

**TokenDefinition → (may reference) → Other System State**
- Cardinality: Dynamic tokens may read from unspecified system components
- Directionality: References (read-only query)
- Notes: Spec does not define all possible dynamic token data sources

## Derived / Computed Concepts

**Token Evaluation Result:**
- Not stored as persistent data
- Computed on-demand when a module requests token substitution
- Input: token name, context (user, tenant, timestamp)
- Output: resolved text value
- For static tokens: returns static_value
- For dynamic tokens: executes evaluation_logic and returns result

**Token Usage:**
- Spec does not explicitly track which tokens are used where
- Usage is implicit (email templates, possibly other surfaces)

## Events & Audit Implications

**Intents Emitted:**
- `token_created` — when admin creates new token (mutable admin activity)
- `token_updated` — when admin modifies token (mutable admin activity)
- `token_deleted` — when admin deletes token (mutable admin activity)
- `token_evaluated` (possibly) — when token is evaluated at runtime (high-volume, may not be tracked)

**Immutability:**
- TokenDefinition is mutable (can be updated/deleted)
- Token evaluation is ephemeral (not persisted)
- Token CRUD operations generate audit intents for history

**Audit Dependency:**
- Token management intents are consumed by modules/audit for history tracking

## Open Questions

### Evaluation Logic Definition
- How is evaluation_logic stored and executed? (SQL snippet? predefined function ID? scripting language?)
- Can tokens accept parameters at evaluation time? (e.g., `[user_points:user_id]`)
- What is the security model for dynamic token evaluation? (sandboxing, permission checks?)

### Token Failure Handling
- What happens if a dynamic token fails to evaluate? (error message, empty string, keep placeholder, throw exception?)
- Are there fallback values for failed evaluations?

### Token Nesting and Dependencies
- Can tokens reference other tokens? (e.g., `[site_[env]_url]`)
- If so, how is circular dependency detected and prevented?

### Token Lifecycle and References
- What happens to email templates (or other content) when a referenced token is deleted?
- Is there a warning or validation system to prevent deleting tokens in use?
- Are there built-in/system-provided tokens that cannot be edited or deleted?

### Token Evaluation Tracking
- Should every token evaluation be recorded as an intent? (performance vs. observability trade-off)
- Are there metrics on token evaluation frequency, failures, or latency?

### Token Scope
- Are tokens always tenant-scoped, or are there global/system tokens?
- Can tokens be shared or templated across tenants?
