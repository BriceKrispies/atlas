# Authentication

This document describes the **implemented** authentication system in the Atlas Platform ingress service.

## Invariants

**Invariant A1: Single Authn Point**
- All external requests enter through the ingress service
- Authentication is performed exactly once, in the `authn_middleware`
- No business logic executes before authentication completes

**Invariant A2: Principal Required for Protected Routes**
- Every request to a protected route MUST have a valid `Principal`
- Requests without valid authentication receive `401 Unauthorized`
- Public routes (health check, metrics) are exempt

## Trust Boundaries

**Ingress Gateway**
- Only external entry point to the platform
- Responsible for extracting and validating authentication credentials
- Constructs canonical `Principal` object from credentials
- Stores `Principal` in request extensions for downstream use

**Modules**
- Trust the `Principal` object provided by ingress
- MUST NOT perform their own authentication
- MUST NOT directly access raw authentication tokens
- Receive `Principal` via Axum's `Extension<Principal>` extractor

## Principal Model

The ingress gateway normalizes all authentication results into a canonical **Principal** object.

**Implementation**: `crates/ingress/src/authn.rs`

```rust
pub struct Principal {
    pub id: String,              // Unique identifier (e.g., "user-123", "svc-batch")
    pub principal_type: PrincipalType,  // User, Service, or Anonymous
    pub tenant_id: String,       // Tenant this principal belongs to
    pub claims: HashMap<String, serde_json::Value>,  // Additional ABAC attributes
}

pub enum PrincipalType {
    User,      // Human user
    Service,   // Machine/service identity
    Anonymous, // Unauthenticated (only for specific contexts)
}
```

**Principal to Policy Attributes**

The `Principal::to_policy_attributes()` method converts the principal to a `HashMap` for policy evaluation:
- `id` → principal ID
- `type` → "user", "service", or "anonymous"
- `tenant_id` → tenant ID
- All claims are included as additional attributes

## Routes Classification

**Public Routes** (no authentication required):
- `GET /` - Health check
- `GET /metrics` - Prometheus metrics

**Protected Routes** (authentication required):
- `POST /api/v1/intents` - Intent submission

## Tenant Resolution

Tenant context is resolved during authentication. The ingress gateway determines `tenant_id` using the following precedence:

**Resolution Order** (first match wins):
1. **X-Debug-Principal header** (test mode only): `type:id:tenant_id` extracts tenant from third segment
2. **X-Tenant-ID header**: Explicit tenant header for API requests
3. **Default tenant**: Falls back to server's configured `TENANT_ID` environment variable

**Implementation**: `crates/ingress/src/authn.rs` - `resolve_tenant_id()` function

**Validation**:
- Tenant ID must be non-empty
- Tenant ID must match pattern: alphanumeric, hyphens, underscores only
- Missing tenant ID → `400 Bad Request`
- Malformed tenant ID → `400 Bad Request`

## Authentication Methods

### Currently Implemented

**Test Auth Mode** (dev/test only)

For deterministic testing without a real IdP, the platform supports debug principal injection:

- **Header**: `X-Debug-Principal`
- **Format**: `type:id` or `type:id:tenant_id`
- **Examples**:
  - `user:123` → User with id "123", uses default tenant
  - `service:batch-worker` → Service principal
  - `user:456:tenant-xyz` → User with id "456" in tenant "tenant-xyz"

**Safety Guards** (both required):
1. **Compile-time**: Requires `test-auth` Cargo feature
2. **Runtime**: Requires `TEST_AUTH_ENABLED=true` environment variable

If `X-Debug-Principal` header is present but test auth mode is disabled, the header is ignored and normal authentication proceeds.

**Implementation**: `crates/ingress/src/authn.rs` - `try_debug_principal()` function

### Not Yet Implemented

**Bearer Token (JWT)**
- Placeholder exists in `try_bearer_token()`
- Returns `401` with "JWT validation not yet implemented"
- TODO: Implement JWKS endpoint, token validation, claim extraction

**API Key**
- Placeholder exists in `try_api_key()`
- Returns `401` with "API key validation not yet implemented"
- TODO: Implement key store lookup, validation, principal construction

## Authentication Flow

```
Request → authn_middleware
         ├─ Extract X-Correlation-ID (if present)
         ├─ Resolve tenant_id (header precedence)
         ├─ authenticate_request()
         │   ├─ [test-auth] Try X-Debug-Principal header
         │   ├─ Try Bearer token (not implemented)
         │   └─ Try API key (not implemented)
         ├─ On success: Insert Principal into request extensions
         │              Log: principal_id, principal_type, tenant_id
         │              Continue to next middleware/handler
         └─ On failure: Log warning with reason
                        Return 401 Unauthorized
```

## Error Model

| Error | Status | Meaning |
|-------|--------|---------|
| Missing credentials | 401 | No valid authentication method found |
| Invalid credentials | 401 | Credentials provided but invalid |
| Malformed tenant | 400 | Tenant ID format invalid |
| Missing tenant | 400 | No tenant could be resolved |

**Response Format**:
```json
{
  "error": "unauthorized",
  "message": "Authentication required"
}
```

Note: Error responses intentionally do not leak internal details.

## Logging

**Success** (INFO level):
- `principal_id`: Authenticated principal ID
- `principal_type`: user/service/anonymous
- `tenant_id`: Resolved tenant
- `correlation_id`: Request correlation ID (if present)

**Failure** (WARN level):
- `reason`: Category of failure (not secrets)
- `correlation_id`: Request correlation ID (if present)

## Configuration

**Environment Variables**:
- `TENANT_ID`: Default tenant ID for the ingress instance
- `TEST_AUTH_ENABLED`: Set to "true" to enable test auth mode (requires `test-auth` feature)

**Cargo Features**:
- `test-auth`: Enables X-Debug-Principal header support (NEVER enable in production)

## Open Questions

- What is the JWKS endpoint URL structure for JWT validation?
- What is the API key format and storage backend?
- Should tenant resolution support subdomain extraction?
- Are there IP allowlisting requirements for service principals?
- What is the session management strategy for interactive users?
