# Project Progress

## Snapshot

- **Last updated:** 2026-01-16
- **Current state:** Core ingress pipeline (authn/authz/idempotency/schema validation) is implemented and tested. OIDC/JWT validation is functional with Keycloak. Workers, projections, and Cedar policy migration are stubbed. All 8 feature modules are spec-only.

## Now Working

- **Schema Validation:** Just completed - validates intent payloads against JSON schemas at ingress (`crates/ingress/src/schema.rs`)
- **OIDC/JWT Authentication:** JWT validation via JWKS fetching (`crates/ingress/src/authn.rs:498-758`)
- **Debug/whoami endpoint:** For validating OAuth2 token parsing locally (`crates/ingress/src/main.rs:196-213`)

## Done (Proof)

### Invariant I1: Single Ingress Enforcement
- **Status:** Implemented + proven
- **Files:** `crates/ingress/src/main.rs`
- **Tests:** `tests/blackbox/suites/health_test.rs`, `tests/blackbox/suites/intent_submission_test.rs`
- **Proof:** All external requests flow through single `/api/v1/intents` endpoint with middleware chain

### Invariant I2: Authorization Before Execution
- **Status:** Implemented + proven
- **Files:** `crates/ingress/src/authz.rs`, `crates/core/src/policy.rs`
- **Tests:** `tests/blackbox/suites/authorization_test.rs` (3 tests)
- **Proof:** `test_unauthorized_action_returns_403`, `test_policy_evaluation_metrics_recorded`

### Invariant I3: Idempotency Before Execution
- **Status:** Implemented + proven
- **Files:** `crates/adapters/src/memory.rs:33-48`
- **Tests:** `tests/blackbox/suites/idempotency_test.rs` (4 tests)
- **Proof:** `test_duplicate_idempotency_key_returns_same_event`, `test_idempotency_across_multiple_retries`

### Invariant I4: Deny-Overrides-Allow
- **Status:** Implemented + proven
- **Files:** `crates/core/src/policy.rs:39-88`
- **Tests:** Unit tests in `crates/core/src/policy.rs:123-206`
- **Proof:** `test_deny_overrides_allow`, `test_default_deny`

### Invariant I5: Tenant Isolation / Mismatch Detection
- **Status:** Implemented + proven
- **Files:** `crates/ingress/src/authz.rs:321-338`
- **Tests:** Unit tests in `crates/ingress/src/authz.rs:677-696`
- **Proof:** `test_validate_tenant_match_failure` verifies cross-tenant rejection

### Authentication (Authn)
- **Status:** Implemented + proven
- **Files:** `crates/ingress/src/authn.rs` (1040 lines)
- **Tests:** `tests/blackbox/suites/authentication_test.rs` (8 tests)
- **Proof:** `test_missing_token_returns_401`, `test_valid_keycloak_token_returns_200_with_principal`

### Fixture/Spec Validation
- **Status:** Implemented + proven
- **Files:** `crates/spec_validate/src/main.rs`, `crates/spec_validate/src/validate/`
- **Tests:** `make spec-check` validates all fixtures against schemas
- **Proof:** Validates event_envelope, module_manifest, search_documents, analytics_events

### Control Plane Database
- **Status:** Implemented + proven
- **Files:** `crates/control_plane_db/migrations/*.sql` (3 migrations), `crates/control_plane_db/src/bin/seed.rs`
- **Tests:** Manual via `make db-migrate && make db-seed`
- **Proof:** Tables: tenants, modules, module_versions, tenant_modules, schema_registry, policies

### Port Traits (Hexagonal Architecture)
- **Status:** Implemented + proven
- **Files:** `crates/runtime/src/ports.rs`
- **Tests:** Unit tests in `crates/adapters/src/memory.rs:324-438`
- **Proof:** EventStore, Cache, SearchEngine, AnalyticsStore, ControlPlaneRegistry traits defined

### In-Memory Adapters
- **Status:** Implemented + proven
- **Files:** `crates/adapters/src/memory.rs`
- **Tests:** `test_event_store_idempotency`, `test_cache_tag_invalidation`, `test_search_tenant_isolation`
- **Proof:** All port traits have working in-memory implementations

### Schema Validation at Ingress
- **Status:** Implemented + proven
- **Files:** `crates/ingress/src/schema.rs`, `crates/ingress/src/main.rs:227-267`, `crates/ingress/src/errors.rs:197-212`
- **Tests:** `tests/blackbox/suites/intent_submission_test.rs` (2 schema tests)
  - `test_submit_intent_with_invalid_schema_returns_error` - validates unknown schema_id returns 400 with UNKNOWN_SCHEMA
  - `test_submit_intent_with_schema_mismatch_returns_error` - validates non-conforming payload returns 400 with SCHEMA_VALIDATION_FAILED
- **Unit Tests:** `crates/ingress/src/schema.rs` (5 tests)
  - `test_register_and_validate_valid_payload`, `test_validate_unknown_schema`, `test_validate_invalid_payload`, `test_different_versions`, `test_default_registry_has_test_schema`
- **Proof:** Schema lookup + JSON Schema validation enforced before idempotency/authz checks

### Liveness/Readiness Health Endpoints
- **Status:** Implemented + proven
- **Files:**
  - `crates/ingress/src/main.rs:146-147` - Route definitions for `/healthz` and `/readyz`
  - `crates/ingress/src/main.rs:190-269` - Handler implementations (`liveness_check`, `readiness_check`)
  - `tests/blackbox/harness/client.rs:157-220` - Test client methods (`liveness_check`, `readiness_check`)
- **Tests:** `tests/blackbox/suites/health_test.rs` (4 tests)
  - `test_liveness_endpoint_returns_200_without_auth` - verifies `/healthz` returns 200 OK without auth
  - `test_readiness_endpoint_returns_200_when_ready` - verifies `/readyz` returns 200 with check details when dependencies ready
  - `test_readiness_endpoint_accessible_without_auth` - verifies `/readyz` does not require authentication
- **Proof:**
  - Liveness (`/healthz`): Returns 200 `{"status":"ok"}` if HTTP server is running. No dependency checks.
  - Readiness (`/readyz`): Returns 200 with check details when schema_registry and policies are loaded. Returns 503 with failure details if any dependency unavailable.

## Implemented but Unproven

### Invariant I7/I8: Tenant Isolation + Permission Filtering in Search
- **Status:** Implemented but unproven
- **Files:** `crates/adapters/src/memory.rs:240-269`
- **Tests:** Unit test `test_search_tenant_isolation` exists but no integration tests
- **Notes:** In-memory implementation has the logic; needs black-box test coverage

### Cache Tag-Based Invalidation (I9/I10)
- **Status:** Implemented but unproven
- **Files:** `crates/adapters/src/memory.rs:119-207`, `crates/workers/src/main.rs:20-80`
- **Tests:** Unit tests only, no integration tests proving event-driven invalidation
- **Notes:** Workers loop polls events but no shared event store with ingress in tests

### Correlation/Causation Propagation (I5/I6)
- **Status:** Partially implemented but unproven
- **Files:** `crates/core/src/types.rs` (EventEnvelope has fields)
- **Tests:** None
- **Notes:** Fields exist but no test verifies propagation through the pipeline

### API Key Authentication
- **Status:** Stubbed, returns error
- **Files:** `crates/ingress/src/authn.rs:793-811`
- **Notes:** `try_api_key_from_header()` returns "not yet implemented"

## Stubbed / TODO

### Workers / Projections
- **Status:** Stubbed
- **Files:** `crates/workers/src/main.rs:70-73`
- **Notes:** Comments: "TODO: Apply event to projections", "TODO: Trigger derived analytics events", "TODO: Trigger scheduled jobs"

### Cedar Policy Language
- **Status:** Stubbed (using simpler policy engine)
- **Files:** `crates/core/src/policy.rs`
- **Notes:** Architecture docs mention Cedar; current impl uses custom Condition-based evaluator

### Postgres Adapter (Full)
- **Status:** Partially implemented
- **Files:** `crates/adapters/src/postgres_registry.rs`
- **Notes:** ControlPlaneRegistry implemented; EventStore/Cache/Search not implemented for Postgres

### Action Registry Validation
- **Status:** Stubbed
- **Files:** None
- **Notes:** Actions from intents are not validated against module manifest declarations

### atlasctl CLI (Operator Client)
- **Status:** Partially implemented
- **Files:** `crates/atlasctl/`
- **Notes:** `status` and `invoke` work; `actions list` and `trace` are stubs

### atlas-compiler
- **Status:** Empty/stub
- **Files:** `crates/atlas-compiler/`
- **Notes:** Directory exists but no implementation

## Missing

| Capability | Expected From | Evidence |
|------------|---------------|----------|
| Message Bus / Pub-Sub | `specs/architecture.md` (P3, outbox pattern) | No adapter implementation found |
| Tenant Databases (per-tenant) | `specs/architecture.md` (Tenancy Model) | Only control plane DB exists |
| K8s Manifests | `infra/k8s/` directory | Directory is empty |
| Kafka Configuration | `infra/kafka/` directory | Directory is empty |
| Projection Builders | `specs/architecture.md` (P4) | TODO in workers |
| Job Queue with DLQ | `specs/architecture.md` (Consumers Plane) | Not implemented |
| Break-Glass Access | `specs/crosscut/authz.md` | Not implemented |
| SCIM User Provisioning | `specs/architecture.md` | Not implemented |
| Rate Limiting | `specs/architecture.md` (Ingress Rules) | Not implemented |
| All 8 Feature Modules | `specs/modules/*` | Spec only, no domain code |

## Next Thin Slice

**Recommended:** Implement **Action Registry Validation** - validate that `actionId` from intents is declared in the module manifest.

This would:
1. Look up `actionId` from `envelope.payload` against `ActionRegistry` built from module manifests
2. Return 400 for unknown actions not declared by any enabled module
3. Strengthen authorization by ensuring only declared actions can be invoked
4. Build foundation for module-scoped permission checks

**Files to modify:**
- `crates/ingress/src/main.rs` (add action validation after schema validation)
- `crates/ingress/src/bootstrap.rs` (ensure action registry is populated)

**Alternative next slices:**
- **API Key Authentication:** Complete the stubbed `try_api_key_from_header()` for service-to-service auth
- **Control Plane Schema Loading:** Load schemas from `control_plane.schema_registry` table instead of hardcoded defaults

---

## Appendix: Evidence Map

| Component | Status | Key Files | Tests | Notes |
|-----------|--------|-----------|-------|-------|
| Ingress HTTP Server | Done | `crates/ingress/src/main.rs` | health_test.rs | Axum-based, port 3000 |
| Liveness/Readiness | Done | `crates/ingress/src/main.rs:190-269` | health_test.rs (4 tests) | /healthz, /readyz |
| Schema Validation | Done | `crates/ingress/src/schema.rs` | intent_submission_test.rs (2), Unit tests (5) | JSON Schema validation |
| Authn Middleware | Done | `crates/ingress/src/authn.rs` | authentication_test.rs (8) | OIDC/JWT + debug header |
| Authz Gate | Done | `crates/ingress/src/authz.rs` | authorization_test.rs (3) | ABAC policy engine |
| Policy Engine | Done | `crates/core/src/policy.rs` | Unit tests (3) | Deny-overrides-allow |
| EventStore Port | Done | `crates/runtime/src/ports.rs` | memory.rs unit tests | Trait + in-memory impl |
| Cache Port | Done | `crates/runtime/src/ports.rs` | memory.rs unit tests | Tag-based invalidation |
| SearchEngine Port | Done | `crates/runtime/src/ports.rs` | memory.rs unit tests | Tenant isolation |
| AnalyticsStore Port | Done | `crates/runtime/src/ports.rs` | None | Minimal impl |
| ControlPlaneRegistry | Done | `crates/adapters/src/postgres_registry.rs` | Manual | Postgres adapter |
| DB Migrations | Done | `crates/control_plane_db/migrations/` | Manual | 3 migration files |
| Workers Service | Stubbed | `crates/workers/src/main.rs` | None | Heartbeat + TODO |
| Spec Validator | Done | `crates/spec_validate/` | `make spec-check` | 4 fixture kinds |
| Black-box Test Harness | Done | `tests/blackbox/harness/` | 6 test suites | 30+ tests total |
| atlasctl CLI | Partial | `crates/atlasctl/` | None | status/invoke work |
| Feature Modules | Missing | `specs/modules/*/` | None | Spec only |
| Cedar Policies | Stubbed | `specs/schemas/contracts/policy_ast.schema.json` | None | Using simpler engine |
| Message Bus | Missing | N/A | N/A | Described but not built |
| Tenant DBs | Missing | N/A | N/A | Only control plane DB |

---

*Generated by audit of source code and specifications. Claims verified against actual file contents and test coverage.*
