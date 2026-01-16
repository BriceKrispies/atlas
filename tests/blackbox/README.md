# Atlas Platform Black-Box Integration Tests

This directory contains black-box integration tests for the Atlas Platform. These tests interact with the ingress service via HTTP only, treating the system as an opaque black box.

## Overview

The test suite validates:
- **Health checks** - Service availability and metrics endpoints
- **Intent submission** - Core API functionality for event submission
- **Idempotency** - Invariant I3 enforcement (duplicate keys return same event)
- **Authorization** - Policy-based access control (Invariant I2)
- **Authentication** - OIDC/JWT token validation with Keycloak (Invariant I1)
- **Observability** - Metrics collection and instrumentation

## Directory Structure

```
tests/blackbox/
├── README.md              # This file
├── Cargo.toml             # Test workspace configuration
├── .env.local             # Local test environment config
├── .env.aws               # AWS test environment config (template)
├── harness/               # Test framework code
│   ├── mod.rs             # Module exports
│   ├── client.rs          # HTTP client wrapper
│   ├── config.rs          # Environment-based configuration
│   ├── fixtures.rs        # Test data builders
│   ├── assertions.rs      # Custom test assertions
│   └── keycloak.rs        # Keycloak OIDC client for auth tests
└── suites/                # Test suites
    ├── health_test.rs              # Smoke tests
    ├── intent_submission_test.rs   # Core API tests
    ├── idempotency_test.rs         # Idempotency tests
    ├── authorization_test.rs       # Authorization tests
    ├── authentication_test.rs      # OIDC/JWT auth tests
    └── observability_test.rs       # Metrics tests
```

## Quick Start

### Prerequisites

- Rust toolchain (1.75+)
- Docker or Podman
- Running integration test stack (see below)

### Running Tests Locally

1. **Start the integration test stack:**
   ```bash
   make itest-up
   ```

2. **Run all tests:**
   ```bash
   make itest-test
   ```

3. **Run a specific test suite:**
   ```bash
   cd tests/blackbox
   cargo test --test health
   cargo test --test intent_submission
   cargo test --test idempotency
   cargo test --test authorization
   cargo test --test authentication
   cargo test --test observability
   ```

4. **Stop the stack:**
   ```bash
   make itest-down
   ```

## Test Configuration

Tests are configured via environment variables loaded from `.env.local` (default) or `.env.aws` (when `AWS_ENV=true`).

### Local Configuration (`.env.local`)

```bash
INGRESS_BASE_URL=http://localhost:3000
CONTROL_PLANE_BASE_URL=http://localhost:8000
PROMETHEUS_BASE_URL=http://localhost:9090
TEST_TENANT_ID=tenant-itest-001
HTTP_TIMEOUT_SECONDS=5
RETRY_ATTEMPTS=3

# Keycloak OIDC (for authentication tests)
KEYCLOAK_BASE_URL=http://localhost:8081
KEYCLOAK_REALM=atlas
KEYCLOAK_CLIENT_ID=atlas-s2s
KEYCLOAK_CLIENT_SECRET=<your-client-secret>
```

### AWS Configuration (`.env.aws`)

```bash
INGRESS_BASE_URL=https://atlas-itest.example.com
CONTROL_PLANE_BASE_URL=https://control-plane-itest.example.com
PROMETHEUS_BASE_URL=https://prometheus-itest.example.com
TEST_TENANT_ID=tenant-aws-itest-001
HTTP_TIMEOUT_SECONDS=10
RETRY_ATTEMPTS=5
```

### Switching Environments

```bash
# Local (default)
cargo test

# AWS
AWS_ENV=true cargo test
```

## Test Harness API

### TestClient

The `TestClient` provides high-level HTTP interactions:

```rust
use harness::TestClient;

let client = TestClient::from_env();

// Health check
client.health_check().await?;

// Submit intent
let payload = valid_intent_payload();
let response = client.submit_intent(payload).await?;

// Get metrics
let metrics = client.get_metrics().await?;
```

### Fixtures

Test data builders for common scenarios:

```rust
use harness::*;

// Valid intent
let payload = valid_intent_payload();

// Custom idempotency key
let payload = intent_with_idempotency_key("my-key".to_string());

// Invalid schema (for negative testing)
let payload = intent_with_invalid_schema();
```

### Assertions

Custom assertions for common checks:

```rust
use harness::*;

assert_status(&response, 202);
assert_valid_event_id(&response);
assert_tenant_id(&response, "tenant-itest-001");
assert_same_event(&response1, &response2);
```

## Test Suites

### Health Tests

Validates basic service availability:
- Health endpoint returns 200
- Metrics endpoint is accessible
- Expected metrics are exposed

### Intent Submission Tests

Validates core API functionality:
- Valid intents are accepted (202)
- Missing idempotency key returns 400
- Invalid schema returns error
- Invalid payload returns error

### Idempotency Tests

Validates Invariant I3:
- Duplicate idempotency keys return same event ID
- Different keys create different events
- Idempotency survives multiple retries
- Same key with different payload returns original event

### Authorization Tests

Validates Invariant I2:
- Authorized actions succeed
- Unauthorized actions return 403
- Policy evaluation metrics are recorded

### Authentication Tests

Validates OIDC/JWT authentication (Invariant I1):
- Missing token returns 401 Unauthorized
- Invalid/malformed tokens return 401
- Expired tokens return 401
- Valid Keycloak tokens return 200 with principal info
- Principal extraction works correctly (iss, sub, azp claims)
- X-Debug-Principal header works in test mode

**Requirements:** Keycloak must be running with the `atlas` realm and `atlas-s2s` client.

**Running authentication tests:**
```bash
# Start the dev stack (includes Keycloak)
docker compose -f infra/compose/compose.dev.yml up -d

# Run auth tests
cd tests/blackbox
cargo test --test authentication -- --nocapture
```

**Expected runtime:** ~2-5 seconds (includes real HTTP calls to Keycloak)

### Observability Tests

Validates metrics instrumentation:
- `http_requests_total` increments
- `events_appended_total` increments
- `http_request_duration_seconds` histogram recorded
- Metrics include proper labels
- Tenant ID filtering works

## Writing New Tests

### Step 1: Add Test Function

Create a new test in the appropriate suite:

```rust
#[tokio::test]
async fn test_my_new_scenario() {
    let client = TestClient::from_env();
    // Test logic here
}
```

### Step 2: Add Fixtures (if needed)

Add test data builders in `harness/fixtures.rs`:

```rust
pub fn my_custom_payload() -> IntentPayload {
    IntentPayload {
        // Custom fields
        ..valid_intent_payload()
    }
}
```

### Step 3: Add Assertions (if needed)

Add custom assertions in `harness/assertions.rs`:

```rust
pub fn assert_my_condition(response: &Response) {
    assert!(
        condition,
        "Meaningful error message"
    );
}
```

## Debugging Tests

### View Container Logs

```bash
# All containers
make itest-logs

# Specific service
docker logs atlas-itest-ingress -f
```

### Use Ops UI

- **Dozzle (Logs):** http://localhost:8080
- **pgAdmin (Database):** http://localhost:5050
- **Grafana (Metrics):** http://localhost:3001

### Run Tests with Verbose Output

```bash
cd tests/blackbox
cargo test -- --nocapture
```

### Inspect Test Failures

```bash
# Run single test
cargo test test_submit_valid_intent -- --exact --nocapture

# Show backtrace
RUST_BACKTRACE=1 cargo test
```

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Start integration test stack
  run: make itest-up

- name: Run black-box tests
  run: make itest-test

- name: Collect logs on failure
  if: failure()
  run: make itest-logs

- name: Stop integration test stack
  if: always()
  run: make itest-down
```

## Troubleshooting

### Port Conflicts

If ports are already in use:
```bash
# Check what's using port 3000
lsof -i :3000

# Kill the process or change INGRESS_PORT in .env.itest
```

### Container Health Failures

```bash
# Check container status
make itest-status

# View logs for unhealthy container
docker logs atlas-itest-ingress --tail 100
```

### Test Timeouts

Increase timeout in `.env.local`:
```bash
HTTP_TIMEOUT_SECONDS=30
```

### Clean State

Reset everything:
```bash
make itest-reset  # Stop, remove volumes, restart
```

## Best Practices

1. **Black-box only:** Tests should only use HTTP APIs, no direct DB/queue access
2. **Unique idempotency keys:** Use `unique_idempotency_key()` to avoid conflicts
3. **Cleanup:** Tests should be idempotent and not leave state
4. **Assertions:** Use custom assertions for better error messages
5. **Parallelism:** Tests run in parallel, avoid shared mutable state
6. **Environment-agnostic:** Use config from environment, not hardcoded URLs

## Performance

Typical test execution times (local):
- Health tests: ~100ms
- Intent submission tests: ~500ms
- Idempotency tests: ~2s (multiple submissions)
- Authorization tests: ~300ms
- Authentication tests: ~2-5s (real Keycloak token minting)
- Observability tests: ~400ms

**Total:** ~10-15 seconds for full suite
