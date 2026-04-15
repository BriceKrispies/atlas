# Project Progress

## Environment Configuration Refactor (2026-01-25)

Removed all `.env` files and `dotenvy` dependency. The system is now **strict by default** (production behavior) unless explicitly put into dev mode.

### What Changed

1. **Created `atlas-config` crate** (`crates/atlas_config/`)
   - `AtlasEnv` enum: `Dev` or `Strict` (default)
   - `atlas_env()`: Returns `Strict` unless `ATLAS_ENV=dev`
   - `require_env(key)`: Fails with clear error if env var missing
   - `get_env_or_dev(key, default)`: Uses default only in dev mode
   - `forbid_in_strict(key, reason)`: Prevents certain vars in production

2. **Removed all `.env` files**
   - `infra/compose/.env`, `.env.example`, `.env.itest`
   - `tests/blackbox/.env.local`, `.env.aws`

3. **Removed `dotenvy` dependency** from test harness

4. **Updated CLI** - Injects all env vars directly, sets `ATLAS_ENV=dev`

5. **Updated docker-compose files** - Removed `${VAR:-default}` patterns

6. **Updated ingress bootstrap** - `TENANT_ID` forbidden in strict mode

### How to Run Dev

```bash
# Start the dev stack (recommended - handles all configuration)
atlas dev up

# For integration tests
make itest-up
make itest-test
```

### Environment Modes

- **Strict (default)**: All required config must be set; `TENANT_ID` forbidden
- **Dev (`ATLAS_ENV=dev`)**: Allows fallback defaults; CLI sets this automatically

---

## Snapshot

- **Last updated:** 2026-02-10
- **Current state:** Core ingress pipeline (authn/authz/idempotency/schema validation) is implemented and tested. OIDC/JWT validation is functional with Keycloak. WASM plugin runtime and render tree IR are implemented with end-to-end demo. Workers build projections and render trees. All 8 feature modules are spec-only.

## Now Working

- **Render Tree IR + WASM Demo Slice:** End-to-end: create a page via intent, WASM plugin produces render tree, worker persists it, viewer renders it in the browser.
- **Schema Validation:** Validates intent payloads against JSON schemas at ingress (`crates/ingress/src/schema.rs`)
- **OIDC/JWT Authentication:** JWT validation via JWKS fetching (`crates/ingress/src/authn.rs:498-758`)

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

### WASM Plugin Runtime (Zero-Authority Sandbox)
- **Status:** Implemented + proven
- **Files:**
  - `crates/wasm_runtime/src/lib.rs` — Plugin executor (zero imports, bounded memory/fuel/timeout)
  - `crates/wasm_runtime/src/render_tree.rs` — Render tree IR validator (V1–V17)
  - `plugins/demo-transform/src/lib.rs` — Demo WASM plugin (`no_std`, emits render tree)
- **Tests:** `cargo test -p atlas-wasm-runtime` (24 tests)
  - `test_execute_demo_plugin` — End-to-end: loads WASM, executes, validates render tree output
  - `test_module_with_imports_rejected` — Zero-authority enforcement
  - `test_fuel_exhaustion` — Bounded compute
  - `test_invalid_output_json` — Output validation
  - 20 render tree validation tests (V1–V17 coverage)
- **Proof:** WASM plugin produces structured render tree IR, validated before caching/delivery. No raw HTML.
- **Constraints enforced:** Zero host imports, 16 MB memory, 1M fuel, 5s timeout, fresh Store per invocation

### Render Tree IR
- **Status:** Implemented + proven
- **Files:**
  - `specs/schemas/contracts/render_tree.schema.json` — JSON Schema for the render tree format
  - `specs/fixtures/render_tree__valid__basic.json` — Golden fixture: heading + paragraph
  - `specs/fixtures/render_tree__valid__extension.json` — Golden fixture: extension with fallback
  - `crates/wasm_runtime/src/render_tree.rs` — Validator implementing 17 rules
- **Validation rules:** Version check (V1), non-empty nodes (V2), type presence (V3), known type or `x-` prefix (V4), flat primitive props (V5), required prop validation (V6), leaf node child prohibition (V7), nesting rules (V8), extension fallback required (V9), primitive-only fallback (V10), link URL schemes (V11), image URL schemes (V12), max depth 64 (V13), max 10k nodes (V14), max 1MB serialized (V15), max 100KB prop value (V16), non-empty text content (V17)
- **Node types:** 14 primitives in 4 categories (leaf: text, image, divider; block: heading, paragraph, code_block, blockquote, list, list_item, block; inline: strong, emphasis, code, link) + `x-` extensions with mandatory fallback

### Worker Projection Building + WASM Execution
- **Status:** Implemented + proven
- **Files:**
  - `crates/ingress/src/worker.rs` — In-process event loop, builds RenderPageModel and RenderTree projections
- **Tests:** `tests/blackbox/suites/closed_loop_test.rs`, `tests/blackbox/suites/render_tree_test.rs`
- **Proof:** Worker processes PageCreateRequested events, executes WASM plugin, stores validated render tree in projection store. On WASM failure, stores `renderError`. Pages without pluginRef get a default render tree.

### Render Tree Read API + Viewer
- **Status:** Implemented + proven
- **Files:**
  - `crates/ingress/src/main.rs` — `GET /api/v1/pages/:page_id/render` (authenticated), `GET /pages/:page_id` (public viewer)
  - `crates/ingress/static/viewer.html` — Frontend render tree viewer (all 14 primitives + unknown node placeholders + error panels)
- **Tests:** `tests/blackbox/suites/render_tree_test.rs` (1 test)
  - `test_page_create_produces_render_tree_with_heading` — Creates page, polls for render tree, asserts heading node
- **Proof:** Browser renders UI produced by WASM plugin via render tree IR. No raw HTML in the pipeline.

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
- **Status:** Partially implemented
- **Files:** `crates/ingress/src/worker.rs` (in-process loop), `crates/workers/src/main.rs` (standalone binary, still stubbed)
- **Notes:** In-process worker loop builds RenderPageModel + RenderTree projections with WASM execution. Standalone workers binary still has TODOs for analytics, scheduled jobs.

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
| WASM Plugin Runtime | Done | `crates/wasm_runtime/src/lib.rs` | 24 unit tests | Zero-authority sandbox |
| Render Tree IR | Done | `crates/wasm_runtime/src/render_tree.rs` | 20 unit tests | V1–V17 validation |
| Demo WASM Plugin | Done | `plugins/demo-transform/src/lib.rs` | via wasm_runtime tests | `no_std`, render tree output |
| Render Tree Viewer | Done | `crates/ingress/static/viewer.html` | render_tree_test.rs | 14 primitives + extensions |
| In-Process Worker | Done | `crates/ingress/src/worker.rs` | closed_loop_test.rs | Projections + WASM execution |
| Workers Service | Stubbed | `crates/workers/src/main.rs` | None | Standalone binary, heartbeat + TODO |
| Spec Validator | Done | `crates/spec_validate/` | `make spec-check` | 4 fixture kinds |
| Black-box Test Harness | Done | `tests/blackbox/harness/` | 8 test suites | 35+ tests total |
| atlasctl CLI | Partial | `crates/atlasctl/` | None | status/invoke work |
| Feature Modules | Missing | `specs/modules/*/` | None | Spec only |
| Cedar Policies | Stubbed | `specs/schemas/contracts/policy_ast.schema.json` | None | Using simpler engine |
| Message Bus | Missing | N/A | N/A | Described but not built |
| Tenant DBs | Missing | N/A | N/A | Only control plane DB |

---

*Generated by audit of source code and specifications. Claims verified against actual file contents and test coverage.*
