# Authorization

This document describes the **implemented** authorization system in the Atlas Platform ingress service.

## Invariants

**Invariant I2: Authorization Before Execution**
Every non-public ingress request MUST perform a primary authorization decision before dispatch. No handler logic executes until authorization allows.

**Invariant I4: Deny-Overrides-Allow**
- Any DENY rule overrides all ALLOW rules
- If no policies match, default decision is DENY
- Policy evaluation is deterministic

**Invariant I5: Single Source of Truth for Tenant**
- Authorization decisions MUST use the canonical tenant_id from the authenticated Principal
- Request body tenant_id fields are validated against Principal's tenant_id
- Mismatch between Principal tenant and request tenant results in rejection

## Authorization Model

The platform uses an **ABAC (Attribute-Based Access Control)** policy engine with deny-overrides-allow semantics.

**Implementation**: `crates/core/src/policy.rs`

**Note**: The policy engine is designed to be replaceable with Cedar in the future. Current implementation uses a simpler condition-based evaluator that follows the same deny-overrides-allow semantics Cedar uses.

## Action/Resource Model

Actions and resources are **derived from the intent payload**, not hardcoded constants. This enables fine-grained authorization that matches the actual operations defined in module manifests.

### Action Identity

**Source**: `payload.actionId` field in the intent envelope

**Format**: `{Module}.{Resource}.{Verb}` or `{Module}.{Verb}`

**Examples**:
- `ContentPages.Page.Create` - Create a page in ContentPages module
- `ContentPages.Page.Update` - Update an existing page
- `Analytics.Query` - Query analytics data

**Validation Rules**:
- At least 2 dot-separated segments required
- Each segment must be non-empty
- Each segment must be alphanumeric (underscores allowed)

**Relationship to Module Manifests**: Action IDs in intents MUST match `actionId` declarations in module manifests. This enables:
1. Discovery of valid actions at deploy time
2. Action registry validation
3. Audit logging with stable identifiers

### Resource Identity

**Source**: `payload.resourceType` and optional `payload.resourceId` from the intent envelope

| Field | Description | Example |
|-------|-------------|---------|
| `resource_type` | Type of resource (from manifest) | `Page`, `WidgetInstance` |
| `resource_id` | Specific resource ID (optional) | `page-123` |

**Validation Rules**:
- `resource_type` is required and must be alphanumeric
- `resource_id` is optional (absent for creation operations)

### Intent Payload Structure

For authorization, intents MUST include these fields in their payload:

```json
{
  "actionId": "ContentPages.Page.Create",
  "resourceType": "Page",
  "resourceId": null,
  "payload": {
    // action-specific data
  }
}
```

**Implementation**: `IntentAuthzRequest::from_payload()` in `crates/ingress/src/authz.rs`

### Why This Design

1. **Not Generic**: Instead of a single `Intent.Submit` action, we use the specific action from the payload. This enables policies like "allow user X to create pages but not delete them."

2. **Manifest-Aligned**: Action IDs match module manifest declarations, creating a single source of truth for what actions exist.

3. **Extensible**: Adding new actions requires only manifest updates and policies - no code changes to the authorization layer.

4. **Auditable**: Logs and metrics capture the specific action, not a generic "submit intent."

## Authorization Components

### Principal

Identity of the requester, constructed during authentication:

```rust
pub struct Principal {
    pub id: String,
    pub principal_type: PrincipalType,  // User, Service, Anonymous
    pub tenant_id: String,
    pub claims: HashMap<String, serde_json::Value>,
}
```

Principal attributes available in policies via `to_policy_attributes()`:
- `id`: Principal identifier
- `type`: "user", "service", or "anonymous"
- `tenant_id`: Tenant the principal belongs to
- Any additional claims from authentication

### Authorization Context

Built from the intent payload and principal:

```rust
pub struct AuthorizationContext {
    pub request: IntentAuthzRequest,  // action_id, resource_type, resource_id
    pub tenant_id: String,            // From Principal (canonical)
}
```

### PolicyEvaluationContext

The context passed to the policy engine:

```rust
pub struct PolicyEvaluationContext {
    pub principal_attributes: HashMap<String, serde_json::Value>,
    pub resource_attributes: HashMap<String, serde_json::Value>,
    pub environment_attributes: HashMap<String, serde_json::Value>,
}
```

**principal_attributes**: From `Principal::to_policy_attributes()`
- `id`, `type`, `tenant_id`, plus any claims

**resource_attributes**: From the intent payload
- `action_id`: The specific action (e.g., `ContentPages.Page.Create`)
- `resource_type`: Type of resource (e.g., `Page`)
- `resource_id`: Specific resource ID (if applicable)

**environment_attributes**: Environmental context
- `tenant_id`: Request tenant scope (from Principal)
- `timestamp`: Request timestamp (ISO 8601)

## Enforcement Point

### Primary Enforcement: Ingress Gateway

**Location**: `crates/ingress/src/main.rs` - `handle_intent()` handler

**Authorization Flow**:
```
Request arrives at /api/v1/intents
    |
authn_middleware extracts Principal
    |
Handler validates idempotency key
    |
Handler validates tenant match (Principal.tenant_id == envelope.tenant_id)
    |
Extract IntentAuthzRequest from envelope.payload:
  - action_id from payload.actionId
  - resource_type from payload.resourceType
  - resource_id from payload.resourceId (optional)
    |
If extraction fails: 400 Bad Request
    |
Build AuthorizationContext:
  - request: IntentAuthzRequest
  - tenant_id: from Principal
    |
Build PolicyEvaluationContext:
  - principal_attributes: from Principal
  - resource_attributes: action_id, resource_type, resource_id
  - environment_attributes: tenant_id, timestamp
    |
Call PolicyEngine.evaluate()
    |
If DENY: Return 403 Forbidden, log denial
If ALLOW: Proceed to business logic
```

**Implementation**: `crates/ingress/src/authz.rs`

## Tenant Handling

### Tenant Resolution

Tenant is determined by the authenticated Principal. The request body's `tenant_id` is validated to match.

**Tenant Sources** (precedence order):
1. X-Debug-Principal header tenant segment (test mode only)
2. X-Tenant-ID header
3. TENANT_ID environment variable

### Default Tenant Behavior

| Mode | Behavior |
|------|----------|
| Test mode (`TEST_AUTH_ENABLED=true`) | Default to "default" tenant if not specified |
| Production mode | Require explicit TENANT_ID or warn about degraded mode |

**Implementation**: `crates/ingress/src/bootstrap.rs`

### Tenant Validation

1. Principal's `tenant_id` is set during authentication
2. Authorization context uses Principal's `tenant_id`
3. Request body `tenant_id` is validated against Principal's `tenant_id`
4. Mismatch results in `403 Forbidden`

**Test Coverage**:
- Principal in tenant-A allowed to access tenant-A resources
- Principal in tenant-A denied access to tenant-B resources
- Invalid tenant format rejected with 400

## Policy Engine

**Implementation**: `crates/core/src/policy.rs`

### Policy Structure

```rust
pub struct Policy {
    pub policy_id: String,
    pub tenant_id: String,
    pub rules: Vec<PolicyRule>,
    pub version: u32,
    pub status: PolicyStatus,  // Active or Inactive
}

pub struct PolicyRule {
    pub rule_id: String,
    pub effect: PolicyEffect,  // Allow or Deny
    pub conditions: Condition,
}
```

### Condition Types

```rust
pub enum Condition {
    Literal { value: bool },
    And { operands: Vec<Condition> },
    Or { operands: Vec<Condition> },
    Not { operand: Box<Condition> },
    Equals { left: Box<Condition>, right: Box<Condition> },
    Attribute { path: String, source: AttributeSource },
}

pub enum AttributeSource {
    Principal,
    Resource,
    Environment,
}
```

### Example: Action-Specific Policy

```rust
// Allow users with 'editor' role to create and update pages
Policy {
    policy_id: "editor-page-policy",
    tenant_id: "tenant-001",
    rules: vec![
        PolicyRule {
            rule_id: "allow-page-create",
            effect: PolicyEffect::Allow,
            conditions: Condition::And {
                operands: vec![
                    Condition::Attribute {
                        path: "role".to_string(),
                        source: AttributeSource::Principal,
                    },
                    // Additional condition to check action_id would go here
                ]
            },
        },
    ],
    version: 1,
    status: PolicyStatus::Active,
}
```

### Evaluation Semantics

1. Iterate through all **Active** policies
2. For each policy, evaluate all rules against the context
3. Collect matching ALLOW rules and DENY rules
4. **Deny-overrides-allow**: If any DENY rule matched, return DENY
5. If at least one ALLOW rule matched (and no DENY), return ALLOW
6. If no rules matched, return DENY (default deny)

### Decision Structure

```rust
pub struct PolicyDecision {
    pub decision: Decision,      // Allow or Deny
    pub matched_rules: Vec<String>,
    pub reason: String,
}
```

## Error Model

| Error | Status | Meaning |
|-------|--------|---------|
| Missing actionId/resourceType | 400 | Intent payload missing authorization fields |
| Invalid actionId format | 400 | actionId doesn't match required format |
| Invalid resourceType format | 400 | resourceType contains invalid characters |
| Authorization denied | 403 | Policy evaluation returned DENY |
| Tenant mismatch | 403 | Request tenant differs from Principal tenant |

**Response Format** (400 - Invalid Payload):
```json
{
  "error": "bad_request",
  "message": "Invalid request"
}
```

**Response Format** (403 - Forbidden):
```json
{
  "error": "forbidden",
  "message": "Access denied"
}
```

Note: Error responses intentionally do not leak internal details.

## Logging

**Authorization Request Validation Failed** (INFO level):
- `error`: Validation error message
- `event_type`: The event type from the envelope

**Authorization Denied** (INFO level):
- `action_id`: The specific action that was denied
- `resource_type`: Resource type
- `resource_id`: Resource ID (if present)
- `reason`: Policy denial reason
- `matched_rules`: Rules that caused denial
- `principal_id`: Who was denied
- `tenant_id`: Tenant scope

**Metrics**:
- `policy_evaluations_total{decision="allow|deny"}`: Counter of policy decisions

## Configuration

**Policy Loading**:
- Policies loaded at ingress startup from Control Plane (if enabled)
- Falls back to in-memory allow-all policy for development
- Bootstrap: `crates/ingress/src/bootstrap.rs`

**Default Development Policy**:
```rust
Policy {
    policy_id: "allow-all",
    tenant_id: "{configured_tenant}",
    rules: vec![PolicyRule {
        rule_id: "allow-all-rule",
        effect: PolicyEffect::Allow,
        conditions: Condition::Literal { value: true },
    }],
    version: 1,
    status: PolicyStatus::Active,
}
```

## Future: Cedar Integration

The current policy engine is designed to be replaced with Cedar:

**What will change**:
- Policy language: Current JSON conditions → Cedar policy language
- Policy storage: Current Vec<Policy> → Cedar policy store
- Evaluation: Current custom evaluator → Cedar authorization engine

**What will NOT change**:
- Authorization flow (same enforcement point)
- Action/Resource model (same mapping from intent payload)
- Deny-overrides-allow semantics (Cedar's default)
- Error model and response format

## Open Questions

- How are action IDs validated against the action registry at runtime?
- Should unknown action IDs be rejected or just logged?
- How are policies versioned and deployed across ingress instances?
- What is the cache invalidation strategy for compiled policies?
