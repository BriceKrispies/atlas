# SYSTEM_MAP.md

> This document helps AI agents quickly understand the shape of the Atlas repository and find things.
> All claims are traceable to concrete files/paths. If something couldn't be verified, it's marked UNKNOWN.

---

## A. One-Screen Overview

**What this repo is**: A multi-tenant CMS platform implementing hexagonal architecture with CQRS, event sourcing, and ABAC authorization. The system is specification-first: specs are the source of truth, code is secondary.

**How to get it running locally**:
```bash
# Build all crates
make build

# Start database (requires docker or podman)
make db-up && make db-migrate && make db-seed

# Run ingress service (with database)
CONTROL_PLANE_ENABLED=true TENANT_ID=tenant-001 make run-ingress

# Run ingress service (in-memory mode, no database)
make run-ingress

# Run workers
make run-workers

# Run tests
make test

# Validate specs/fixtures
make spec-check
```

**Evidence**:
- `README.md:1-3` (description)
- `README.md:274-307` (quick start commands)
- `Makefile:61-84` (build/run targets)

---

## B. Workspace / Top-Level Layout

```
atlas/
├── crates/                    # Rust workspace members (core libraries + binaries)
│   ├── core/                  # Pure domain logic, types, policy evaluation
│   ├── runtime/               # Port traits (hexagonal architecture abstractions)
│   ├── adapters/              # Concrete implementations (in-memory, postgres)
│   ├── ingress/               # HTTP ingress binary (single chokepoint)
│   ├── workers/               # Background job processor binary
│   ├── spec_validate/         # Fixture validation CLI
│   ├── atlasctl/              # Operator CLI client
│   ├── control_plane_db/      # Database migrations and seeds
│   ├── diagnostics/           # Logging, tracing, metrics setup
│   └── atlas-compiler/        # EMPTY/STUB - future use
├── apps/
│   └── control-plane/         # Control plane HTTP API service
├── specs/                     # Specifications (source of truth)
│   ├── crosscut/              # Cross-cutting concerns (authn, authz, events, etc.)
│   ├── modules/               # Module specifications (8 modules)
│   ├── schemas/               # Conceptual data schemas + JSON contract schemas
│   └── fixtures/              # Golden examples (validatable)
├── infra/
│   ├── compose/               # Docker/Podman compose files
│   ├── docker/                # Dockerfiles
│   ├── k8s/                   # EMPTY - placeholder for K8s manifests
│   └── kafka/                 # EMPTY - placeholder for Kafka config
├── scripts/                   # Shell scripts for lifecycle management
├── tests/
│   └── blackbox/              # Black-box integration tests (28 tests, 6 suites)
├── tools/
│   └── cli/                   # Development scaffolding CLI (`atlas` command)
├── Cargo.toml                 # Workspace definition
├── Makefile                   # Build, test, infra automation
└── README.md                  # Main documentation entry point
```

**Evidence**:
- `Cargo.toml:1-19` (workspace members)
- `README.md:32-43` (workspace structure)
- Directory listing via `find . -maxdepth 2 -type d`

---

## C. Architecture Landmarks

### Core Invariants / Architecture Documentation

| Document | Location | Purpose |
|----------|----------|---------|
| Architecture spec | `specs/architecture.md` | Hexagonal, event-driven, policy-first design |
| Normative requirements | `specs/normative_requirements.md` | Compiler validation rules (RFC 2119) |
| Surface inventory | `specs/spec_surface_inventory.md` | Descriptive inventory of all artifacts |
| Error taxonomy | `specs/error_taxonomy.json` | Canonical error codes (25+ codes) |
| Glossary | `specs/glossary.md` | Core terminology definitions |

### Specs / Schemas / Fixtures

| Type | Location | Count |
|------|----------|-------|
| JSON Schema contracts | `specs/schemas/contracts/*.schema.json` | 9 schemas |
| Conceptual schemas | `specs/schemas/*.md` | 8 files |
| Fixtures (golden examples) | `specs/fixtures/*.json` | 13 files |
| Module specifications | `specs/modules/*/` | 8 modules |
| Cross-cutting specs | `specs/crosscut/*.md` | 8 files |

### Runtime / Ingress / Workers / Adapters

| Component | Location | Entry Point |
|-----------|----------|-------------|
| Core domain types | `crates/core/` | `src/lib.rs` |
| Port traits | `crates/runtime/src/ports.rs` | EventStore, Cache, SearchEngine, etc. |
| In-memory adapters | `crates/adapters/src/memory.rs` | InMemoryEventStore, InMemoryCache |
| Postgres adapter | `crates/adapters/src/postgres_registry.rs` | PostgresControlPlaneRegistry |
| Ingress HTTP | `crates/ingress/src/main.rs` | Routes: `/api/v1/intents`, `/`, `/metrics` |
| Workers | `crates/workers/src/main.rs` | Background event processor |
| Control Plane API | `apps/control-plane/src/main.rs` | Admin routes: `/healthz`, `/admin/*` |

**Evidence**:
- `specs/` directory structure
- `crates/*/Cargo.toml` files
- `crates/ingress/src/main.rs:1-100`
- `crates/runtime/src/ports.rs`

---

## D. Runtime Request Flow

Trace of a typical request from edge to domain (based on `crates/ingress/src/main.rs`):

```
1. HTTP Entry (POST /api/v1/intents)
   └── crates/ingress/src/main.rs:handle_intent()

2. Authentication (authn_middleware)
   └── crates/ingress/src/authn.rs
   └── Extracts Principal from:
       - X-Debug-Principal header (test mode only, feature-gated)
       - OIDC JWT token (production)
   └── Principal: { id, principal_type, tenant_id, claims }

3. Tenant Validation (validate_tenant_match)
   └── crates/ingress/src/authz.rs
   └── Ensures request tenant_id matches Principal tenant_id

4. Payload Validation
   └── Extracts actionId, resourceType from payload
   └── Validates actionId format: Module.Verb

5. Authorization (authorize)
   └── crates/ingress/src/authz.rs
   └── Loads policies from RuntimeConfig
   └── Evaluates via PolicyEngine (deny-overrides-allow)
   └── Returns 403 on deny

6. Idempotency Check
   └── crates/adapters/src/memory.rs:InMemoryEventStore
   └── Checks idempotency_key against seen keys
   └── Returns existing event_id if duplicate

7. Event Store Append
   └── crates/runtime/src/ports.rs:EventStore::append()
   └── Stores EventEnvelope

8. Response (202 Accepted)
   └── Returns { event_id, tenant_id }
```

**Workers Processing** (background, `crates/workers/src/main.rs`):
```
1. Poll EventStore for new events
2. Extract cache_invalidation_tags from event payload
3. Invalidate cache by tags (I10)
4. TODO: Apply to projections (I12)
5. TODO: Trigger analytics, jobs
```

**Evidence**:
- `crates/ingress/src/main.rs` (full file)
- `crates/ingress/src/authn.rs`
- `crates/ingress/src/authz.rs`
- `crates/workers/src/main.rs`

---

## E. Data & Storage

### Databases Used

| Database | Purpose | Configuration |
|----------|---------|---------------|
| PostgreSQL 16 | Control plane registry | `infra/compose/compose.control-plane.yml` |
| In-memory | Development/testing fallback | `CONTROL_PLANE_ENABLED=false` |

### Control Plane Schema

Tables (inferred from `crates/control_plane_db/src/bin/seed.rs`):
- `control_plane._migrations` - Migration tracking
- `control_plane.tenants` - Tenant records
- `control_plane.modules` - Module registry
- `control_plane.module_versions` - Versioned manifests
- `control_plane.tenant_modules` - Tenant-module enablement
- `control_plane.schema_registry` - JSON schema storage
- `control_plane.policies` - Policy bundles

### Migrations Location

| Type | Location | Invocation |
|------|----------|------------|
| SQL migrations | `crates/control_plane_db/migrations/*.sql` | `make db-migrate` |
| Migration runner | `crates/control_plane_db/src/bin/migrate.rs` | Binary: `migrate` |
| Seed script | `crates/control_plane_db/src/bin/seed.rs` | `make db-seed` |

### Environment Variables

```bash
CONTROL_PLANE_DB_URL=postgres://atlas_platform:local_dev_password@localhost:5432/control_plane
CONTROL_PLANE_ENABLED=true|false
TENANT_ID=tenant-001
```

**Evidence**:
- `infra/compose/compose.control-plane.yml`
- `crates/control_plane_db/src/lib.rs`
- `crates/control_plane_db/src/bin/seed.rs`
- `README.md:213-229`

---

## F. Modules / Bounded Contexts

### Feature Modules (from `specs/modules/`)

| Module | Purpose | Spec Location |
|--------|---------|---------------|
| audit | Intent history & activity tracking | `specs/modules/audit/` |
| badges | Badge awards system | `specs/modules/badges/` |
| comms | Communications & messaging | `specs/modules/comms/` |
| content | Content & media library | `specs/modules/content/` |
| import | Spreadsheet upload & validation | `specs/modules/import/` |
| org | Organization & business units | `specs/modules/org/` |
| points | Point system & rewards | `specs/modules/points/` |
| tokens | Token registry & evaluation | `specs/modules/tokens/` |

Each module directory contains:
- `README.md` - Overview
- `surfaces.md` - UI surfaces
- `events.md` - Event definitions

### Module Manifest Schema

Modules declare capabilities via manifest (`specs/schemas/contracts/module_manifest.schema.json`):
- `actions` - Actions module can handle
- `resources` - Resources module owns
- `events.publishes` - Events module emits
- `events.consumes` - Events module handles
- `projections` - Read models maintained
- `migrations` - Database migrations
- `jobs` - Background jobs
- `uiRoutes` - Frontend routes
- `cacheArtifacts` - Cached data

Example manifest: `specs/modules/content-pages.json`

**Evidence**:
- `specs/modules/*/` directory structure
- `specs/schemas/contracts/module_manifest.schema.json`
- `specs/modules/content-pages.json`

---

## G. Testing & Validation

### Black-Box Integration Tests

| Location | `tests/blackbox/` |
|----------|-------------------|
| Test suites | `tests/blackbox/suites/*.rs` |
| Test harness | `tests/blackbox/harness/` |
| Configuration | `tests/blackbox/.env.local` |

**Test Suites (28 tests total)**:

| Suite | Tests | Validates |
|-------|-------|-----------|
| health_test.rs | 3 | Service availability, metrics endpoint |
| intent_submission_test.rs | 5 | Core API functionality |
| idempotency_test.rs | 4 | Invariant I3 (idempotency) |
| authorization_test.rs | 3 | Invariant I2 (policy-based access) |
| authentication_test.rs | 8 | OIDC/JWT validation |
| observability_test.rs | 5 | Metrics instrumentation |

**Commands**:
```bash
# Start integration test stack
make itest-up

# Run all tests
make itest-test

# Full workflow
make itest

# Stop stack
make itest-down
```

### Fixture/Spec Validation

| Tool | `crates/spec_validate/` |
|------|------------------------|
| Binary | `spec_validate` |
| Command | `make spec-check` or `cargo run -p atlas-platform-spec-validate` |

**Fixture Naming Convention**: `<kind>__<expect>__<name>.json`
- Kinds: `event_envelope`, `module_manifest`, `search_documents`, `analytics_events`
- Expectations: `valid`, `invalid`

**Validatable Fixtures**:
- `event_envelope__valid__canonical.json`
- `event_envelope__invalid__missing_idempotency.json`
- `module_manifest__valid__content_pages.json`
- `search_documents__valid__sample.json`
- `analytics_events__valid__sample.json`

**Evidence**:
- `tests/blackbox/README.md`
- `tests/blackbox/suites/*.rs`
- `crates/spec_validate/src/main.rs`
- `specs/fixtures/README.md`

---

## H. Operations & Tooling

### Makefile Targets

| Category | Targets |
|----------|---------|
| Build | `build`, `test`, `fmt`, `lint`, `clean` |
| Services | `run-ingress`, `run-workers`, `spec-check` |
| Database | `db-up`, `db-down`, `db-reset`, `db-migrate`, `db-seed`, `db-status`, `db-logs` |
| Observability | `obs-up`, `obs-down`, `obs-status`, `obs-logs`, `obs-reset`, `obs-open` |
| Integration Tests | `itest-up`, `itest-down`, `itest-restart`, `itest-logs`, `itest-status`, `itest-clean`, `itest-reset`, `itest-test`, `itest` |

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/itest-lifecycle.sh` | Integration test stack lifecycle |
| `scripts/db-lifecycle.sh` | Control plane database lifecycle |
| `scripts/wait-for-healthy.sh` | Wait for container health |
| `scripts/test-authn.sh` | Authentication test runner |
| `scripts/test-authz.sh` | Authorization test runner |
| `scripts/test-authn.ps1` | PowerShell authn tests |
| `scripts/test-authz.ps1` | PowerShell authz tests |

### CLI Tools

| Tool | Location | Purpose |
|------|----------|---------|
| `atlasctl` | `crates/atlasctl/` | Operator CLI for runtime operations |
| `atlas` | `tools/cli/` | Development scaffolding CLI |

**atlasctl commands**:
- `status` - Check ingress health
- `invoke <action>` - Submit intent
- `actions list` - List actions (stub)
- `trace <id>` - Trace by correlation ID (stub)

**atlas commands** (dev scaffolding):
- `scaffold` - Scaffold new service
- `validate` - Validate manifests
- `gen` - Generate infrastructure
- `run` / `run-all` - Run services
- `dev` - Manage dev environment
- `module` - Manage modules

### Docker Compose Files

| File | Purpose |
|------|---------|
| `infra/compose/compose.dev.yml` | Local dev with Keycloak |
| `infra/compose/compose.keycloak.yml` | Standalone Keycloak |
| `infra/compose/compose.control-plane.yml` | Control plane database |
| `infra/compose/compose.observability.yml` | Prometheus, Grafana, Loki |
| `infra/compose/docker-compose.itest.yml` | Full integration test stack |

### Dockerfiles

| File | Builds |
|------|--------|
| `infra/docker/Dockerfile.ingress` | Ingress service image |
| `infra/docker/Dockerfile.workers` | Workers service image |
| `apps/control-plane/Dockerfile` | Control plane API image |

**Evidence**:
- `Makefile:1-241`
- `scripts/*.sh`
- `crates/atlasctl/src/main.rs`
- `tools/cli/src/main.rs`
- `infra/compose/*.yml`
- `infra/docker/Dockerfile.*`

---

## I. "Where to Change X" Quick Index

| Intent | Likely Location(s) |
|--------|-------------------|
| Add new action | 1. Define in module manifest (`specs/modules/*/`)<br>2. Add handler in domain crate<br>3. Register in action registry |
| Add new schema/fixture | 1. Schema: `specs/schemas/contracts/*.schema.json`<br>2. Fixture: `specs/fixtures/<kind>__<expect>__<name>.json` |
| Change authz policy semantics | 1. Policy engine: `crates/core/src/policy.rs`<br>2. Policy schema: `specs/schemas/contracts/policy_ast.schema.json` |
| Add a projection | 1. Declare in module manifest (`projections` array)<br>2. Implement in workers (`crates/workers/`) |
| Change ingress validation | 1. Handler: `crates/ingress/src/main.rs:handle_intent()`<br>2. Authn: `crates/ingress/src/authn.rs`<br>3. Authz: `crates/ingress/src/authz.rs` |
| Add new event type | 1. Define in `crates/core/src/types.rs`<br>2. Add to module manifest events<br>3. Add fixture: `specs/fixtures/event_envelope__valid__*.json` |
| Add new port/adapter | 1. Port trait: `crates/runtime/src/ports.rs`<br>2. In-memory: `crates/adapters/src/memory.rs`<br>3. Postgres: `crates/adapters/src/postgres_registry.rs` |
| Add new HTTP endpoint | 1. Ingress: `crates/ingress/src/main.rs` (Router)<br>2. Control plane: `apps/control-plane/src/main.rs` |
| Add database migration | 1. SQL file: `crates/control_plane_db/migrations/`<br>2. Run: `make db-migrate` |
| Add integration test | 1. New suite: `tests/blackbox/suites/*_test.rs`<br>2. Harness helpers: `tests/blackbox/harness/` |
| Add cross-cutting spec | `specs/crosscut/<concern>.md` |
| Add new module spec | 1. Dir: `specs/modules/<module>/`<br>2. Files: README.md, surfaces.md, events.md |

**Evidence**:
- All source files inspected throughout exploration

---

## J. Open Questions / UNKNOWNs

| Topic | What Couldn't Be Verified |
|-------|--------------------------|
| atlas-compiler | Crate exists but is empty/stub - purpose unknown |
| Full Postgres adapter | `postgres_registry.rs` implementation details not examined |
| Condition evaluation | Full policy condition types in `policy.rs` not examined |
| ActionRegistry | `crates/runtime/src/registry.rs` implementation not examined |
| Singleflight | `crates/runtime/src/singleflight.rs` implementation not examined |
| K8s manifests | `infra/k8s/` directory is empty |
| Kafka config | `infra/kafka/` directory is empty |
| Tenant databases | Database-per-tenant described in architecture but adapters use single control plane DB |
| Message bus | Described in architecture but no adapter implementation found |
| Cedar policies | Cedar policy language mentioned but current implementation uses simpler Policy type |
| Schema validation at ingress | Test marked `#[ignore]` - not fully implemented |
| Keycloak realm setup | Required for auth tests but configuration not in repo |

**Evidence**:
- Gaps identified during exploration of all directories and files

---

## Appendix: Core Invariants Reference

| ID | Invariant | Enforcement Location |
|----|-----------|---------------------|
| I1 | Single Ingress Enforcement | `crates/ingress/src/main.rs` |
| I2 | Authorization Precedes Execution | `crates/ingress/src/authz.rs` |
| I3 | Idempotency Before Execution | `crates/adapters/src/memory.rs` |
| I4 | Deny-Overrides-Allow | `crates/core/src/policy.rs` |
| I5 | Correlation Propagation | Event envelope fields |
| I6 | Causation Linkage | Event envelope `causationId` |
| I7 | Tenant Isolation in Search | `crates/runtime/src/ports.rs:SearchEngine` |
| I8 | Permission-Filtered Search | `crates/runtime/src/ports.rs:SearchEngine` |
| I9 | Cache Keys Include TenantId | `crates/runtime/src/ports.rs:Cache` |
| I10 | Event-Driven Cache Invalidation | `crates/workers/src/main.rs` |
| I11 | Deterministic Time Bucketing | `crates/runtime/src/ports.rs:AnalyticsStore` |
| I12 | Projections Are Rebuildable | TODO in workers |

**Evidence**:
- `specs/architecture.md:73-277` (invariant definitions)
- Source code locations as listed

---

*Generated from repository exploration. Last updated: 2026-01-11*
