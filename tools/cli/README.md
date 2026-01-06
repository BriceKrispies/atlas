# Atlas CLI

A CLI tool for mechanically wiring up microservices. This tool makes service scaffolding, infrastructure generation, and validation deterministic and idempotent. **Now with OpenAPI support** for generating typed, validated API endpoints from OpenAPI specs!

## Installation

Build the CLI from the workspace root:

```bash
cargo build --release -p atlas-cli
```

The binary will be available at `target/release/atlas` (or `target/release/atlas.exe` on Windows).

For development, you can run directly with cargo:

```bash
cargo run -p atlas-cli -- <command>
```

## Commands

### `scaffold service <name>`

Scaffold a new service with boilerplate code, manifest, and run script.

**Usage:**
```bash
atlas scaffold <service-name> [OPTIONS]

Options:
  -t, --type <TYPE>                Service type: api, worker, projector, or hybrid [default: api]
  -l, --language <LANGUAGE>        Programming language [default: rust]
      --openapi <PATH>             Path to OpenAPI spec (local file)
      --openapi-format <FORMAT>    OpenAPI format: auto, json, or yaml [default: auto]
      --openapi-base-path <PATH>   Base path for API routes [default: /]
      --openapi-tags <TAGS>        Comma-separated list of tags to include
      --openapi-ops <OPS>          Comma-separated list of operation IDs to include
      --dry-run                    Show what would be created without writing files
```

**Examples:**
```bash
# Scaffold a Rust API service
atlas scaffold user-service

# Scaffold an API from an OpenAPI spec
atlas scaffold pet-api --openapi ./openapi/petstore.yaml

# Scaffold with tag filtering (only 'pets' endpoints)
atlas scaffold pet-api --openapi ./openapi/petstore.yaml --openapi-tags pets

# Scaffold with specific operations
atlas scaffold user-api --openapi ./api-spec.json --openapi-ops createUser,getUser

# Scaffold a Python worker
atlas scaffold email-worker --type worker --language python

# Scaffold a TypeScript projector
atlas scaffold analytics-projector --type projector --language typescript

# Preview what would be created
atlas scaffold my-service --dry-run
```

**What it creates:**
- `apps/<service>/service.yaml` - Service manifest (SSOT)
- `apps/<service>/<code-files>` - Language-specific application skeleton
- `apps/<service>/run.sh` - Cross-platform run script
- `apps/<service>/generated/` - **OpenAPI-generated code** (routes, models, validation)
- `apps/<service>/src/handlers/` - **Handler stubs** (not overwritten on regeneration)

### `validate`

Validate all service manifests and optionally check for drift.

**Usage:**
```bash
atlas validate [OPTIONS]

Options:
      --check-drift  Check for drift between manifests and generated files
      --json         Output results in JSON format
```

**Examples:**
```bash
# Basic validation
atlas validate

# Check for drift (detects if infra files don't match manifests)
atlas validate --check-drift

# Get machine-readable output
atlas validate --json
```

**What it validates:**
- All `apps/*/service.yaml` files parse correctly
- Required fields are present (`name`, `type`, `language`)
- Service names match directory names
- No duplicate service names
- Kafka config is well-formed (if present)
- Generated files match what `gen` would produce (with `--check-drift`)

### `gen`

Regenerate infrastructure from service manifests. This is idempotent - running it multiple times produces the same output.

**Usage:**
```bash
atlas gen [OPTIONS]

Options:
      --dry-run  Show what would be generated without writing files
```

**Examples:**
```bash
# Generate infrastructure for all services
atlas gen

# Preview what would be generated
atlas gen --dry-run
```

**What it generates:**
- `infra/k8s/services/<service>.yaml` - Kubernetes Deployment + Service
- `infra/kafka/<service>.yaml` - Kafka topics + ACLs (if service uses Kafka)
- `apps/<service>/generated/*` - **OpenAPI code** (routes, models) if manifest has `openapi` field

### `run <service>`

Run a specific service locally.

**Usage:**
```bash
atlas run <service-name>
```

**Examples:**
```bash
# Run the user-service
atlas run user-service

# Run a specific worker
atlas run email-worker
```

### `run-all`

Run all services concurrently with prefixed log streaming.

**Usage:**
```bash
atlas run-all
```

**Example:**
```bash
atlas run-all
```

Logs are prefixed with `[service-name]` for easy identification. Press Ctrl+C to stop all services.

## Dev Environment Commands

The `dev` command group manages your local development environment, including the control plane, database, and tenants.

### `dev quickstart <tenant-key>`

One-command setup: starts services, seeds control plane, and creates a tenant.

**Usage:**
```bash
atlas dev quickstart <tenant-key> [OPTIONS]

Options:
      --name <NAME>  Tenant display name
```

**Example:**
```bash
# Quick setup with tenant 't1'
atlas dev quickstart t1

# With custom name
atlas dev quickstart t1 --name "My Test Tenant"
```

**What it does:**
1. Starts PostgreSQL container
2. Runs control plane migrations
3. Starts control plane API
4. Seeds control plane database
5. Creates tenant with database
6. Runs tenant migrations and seeds

### `dev up`

Start control plane and dependencies (PostgreSQL).

**Usage:**
```bash
atlas dev up [OPTIONS]

Options:
      --detach            Run in background
      --skip-migrations   Skip running migrations
```

**Examples:**
```bash
# Start in foreground (logs to stdout)
atlas dev up

# Start in background
atlas dev up --detach

# Start without running migrations
atlas dev up --detach --skip-migrations
```

**What it starts:**
- PostgreSQL container (localhost:5432)
- pgAdmin (http://localhost:5050)
- Control Plane API (http://localhost:8000)

### `dev seed-control`

Seed the control plane database with sample data.

**Usage:**
```bash
atlas dev seed-control
```

**What it seeds:**
- Sample tenant (tenant-001)
- Sample module manifests
- Schema registry entries
- Policy bundles

### `dev tenant create <tenant-key>`

Create a new tenant with its own database.

**Usage:**
```bash
atlas dev tenant create <tenant-key> [OPTIONS]

Options:
      --name <NAME>       Tenant display name
      --region <REGION>   Region identifier
      --skip-migrate      Skip tenant database migrations
      --skip-seed         Skip tenant database seeding
      --json              Output as JSON
```

**Examples:**
```bash
# Create tenant with default settings
atlas dev tenant create t2

# Create with custom name and region
atlas dev tenant create t2 --name "Tenant 2" --region us-east

# Get JSON output for automation
atlas dev tenant create t3 --json
```

**What it does:**
- Creates tenant record in control plane
- Creates dedicated PostgreSQL database
- Runs tenant migrations (unless --skip-migrate)
- Seeds tenant database (unless --skip-seed)
- Returns connection information

### `dev tenant delete <tenant-key>`

Delete a tenant and its database (dev only).

**Usage:**
```bash
atlas dev tenant delete <tenant-key> [OPTIONS]

Options:
      --yes  Skip confirmation prompt
```

**Examples:**
```bash
# Delete with confirmation prompt
atlas dev tenant delete t2

# Skip confirmation
atlas dev tenant delete t2 --yes
```

**Safety:**
- Only works in dev environment
- Requires explicit confirmation (--yes flag)
- Drops tenant database and all data

### `dev status`

Show the status of your dev environment.

**Usage:**
```bash
atlas dev status [OPTIONS]

Options:
      --logs  Show recent control plane logs
```

**Examples:**
```bash
# Show status
atlas dev status

# Show status with logs
atlas dev status --logs
```

**What it shows:**
- PostgreSQL status (running/stopped)
- Control Plane API status (running/stopped)
- List of tenants
- Recent logs (with --logs)

### `dev reset`

Reset the entire local dev environment.

**Usage:**
```bash
atlas dev reset [OPTIONS]

Options:
      --yes  Skip confirmation prompt
```

**Example:**
```bash
# Reset with confirmation
atlas dev reset

# Skip confirmation
atlas dev reset --yes
```

**What it destroys:**
- All running services
- Control plane database
- All tenant databases
- Docker volumes
- .dev directory

⚠️ This is destructive and cannot be undone!

## Module Commands

The `module` command group manages modules as first-class workspace crates, driven by JSON manifests that conform to the module manifest schema.

### `module validate`

Validate module manifest(s) against the JSON schema.

**Usage:**
```bash
atlas module validate [OPTIONS]

Options:
      --manifest <PATH>  Path to specific module manifest to validate
      --check-drift      Check for drift between manifests and generated crates
      --json             Output results in JSON format
```

**Examples:**
```bash
# Validate all module manifests in specs/modules/
atlas module validate

# Validate a specific manifest
atlas module validate --manifest specs/modules/content-pages.json

# Check for drift (detects if crates don't match manifests)
atlas module validate --check-drift

# Get JSON output for automation
atlas module validate --json
```

**What it validates:**
- Manifest conforms to `/specs/module_manifest.schema.json`
- Required fields: `manifestVersion`, `moduleId`, `displayName`, `version`, `moduleType`
- Module ID format (lowercase letters, digits, hyphens only)
- Module types are valid (ui, api, worker, projection, hybrid)
- Generated crate exists (with `--check-drift`)

### `module scaffold`

Generate a module crate from a manifest.

**Usage:**
```bash
atlas module scaffold --manifest <PATH> [OPTIONS]

Options:
      --manifest <PATH>  Path to module manifest JSON file (required)
      --dry-run          Show what would be created without writing files
```

**Examples:**
```bash
# Scaffold a module from a manifest
atlas module scaffold --manifest specs/modules/content-pages.json

# Preview what would be generated
atlas module scaffold --manifest specs/modules/my-module.json --dry-run
```

**What it generates:**
- `crates/modules/<module-id>/Cargo.toml` - Module crate manifest
- `crates/modules/<module-id>/src/lib.rs` - Module entry point with constants
- `crates/modules/<module-id>/src/actions.rs` - Declared actions (if any)
- `crates/modules/<module-id>/src/events.rs` - Published/consumed events (if any)
- `crates/modules/<module-id>/src/projections.rs` - Projection definitions (if any)
- `crates/modules/<module-id>/src/jobs.rs` - Background job definitions (if any)
- `crates/modules/<module-id>/.manifest_metadata.json` - Manifest metadata for drift detection
- Automatically adds module to workspace `Cargo.toml`

**What it generates is:**
- Deterministic: Same manifest always produces same output
- Idempotent: Re-running doesn't create duplicates
- Compile-safe: Generated crate compiles immediately

### Module Manifest Specification

Module manifests are stored in `specs/modules/<module-id>.json` and conform to `/specs/module_manifest.schema.json`.

**Required Fields:**
```json
{
  "manifestVersion": 2,
  "moduleId": "my-module",
  "displayName": "My Module",
  "version": "1.0.0",
  "moduleType": ["api"]
}
```

**Optional Capabilities:**
```json
{
  "capabilities": ["content-management", "analytics"],
  "actions": [
    {
      "actionId": "MyModule.Resource.Create",
      "resourceType": "Resource",
      "verb": "create",
      "auditLevel": "SENSITIVE"
    }
  ],
  "events": {
    "publishes": [
      {
        "eventType": "MyModule.ResourceCreated",
        "category": "DOMAIN",
        "schemaId": "domain.mymodule.resource.created.v1",
        "compatibility": "BACKWARD"
      }
    ],
    "consumes": []
  },
  "projections": [
    {
      "projectionName": "ResourceView",
      "inputEvents": ["MyModule.ResourceCreated"],
      "outputModel": "resource_view_json",
      "rebuildable": true
    }
  ],
  "jobs": [
    {
      "jobId": "MyModule.ProcessData",
      "kind": "SCHEDULED",
      "schedule": "0 0 * * *"
    }
  ],
  "migrations": [],
  "uiRoutes": [],
  "cacheArtifacts": []
}
```

**Module Types:**
- `ui` - Frontend UI components
- `api` - API endpoints and handlers
- `worker` - Background workers
- `projection` - Event-sourced projections
- `hybrid` - Combination of multiple types

### Example Module Workflow

```bash
# 1. Create a module manifest
cat > specs/modules/my-feature.json <<EOF
{
  "manifestVersion": 2,
  "moduleId": "my-feature",
  "displayName": "My Feature",
  "version": "1.0.0",
  "moduleType": ["api"],
  "actions": [
    {
      "actionId": "MyFeature.Create",
      "resourceType": "Feature",
      "verb": "create",
      "auditLevel": "INFO"
    }
  ]
}
EOF

# 2. Validate the manifest
atlas module validate --manifest specs/modules/my-feature.json

# 3. Scaffold the module crate
atlas module scaffold --manifest specs/modules/my-feature.json

# 4. Review generated code
cd crates/modules/my-feature
cat src/lib.rs          # Module constants and info
cat src/actions.rs      # Declared actions

# 5. Implement module logic
# Edit src/lib.rs to add your business logic

# 6. Build the module
cargo build -p atlas-module-my_feature

# 7. Validate everything still matches
atlas module validate --check-drift
```

### Module Dependencies

Modules can depend on:
- ✅ `crates/core` - Core utilities and types
- ❌ NOT `crates/adapters` - Modules should be adapter-agnostic
- ❌ NOT `crates/ingress` - Modules should not depend on ingress layer
- ❌ NOT `crates/workers` - Modules define jobs but don't depend on worker runtime

This ensures modules remain portable and loosely coupled.

## Workflow

### Creating a New Service

```bash
# 1. Scaffold the service
atlas scaffold payment-service --type api --language rust

# 2. Edit the manifest to add your requirements
cd apps/payment-service
# Edit service.yaml to add ports, env vars, Kafka topics, etc.

# 3. Generate infrastructure
cd ../..
atlas gen

# 4. Validate everything
atlas validate --check-drift

# 5. Run the service
atlas run payment-service
```

### Updating an Existing Service

```bash
# 1. Edit apps/<service>/service.yaml

# 2. Regenerate infrastructure
atlas gen

# 3. Validate (ensure no drift)
atlas validate --check-drift
```

### Setting Up Local Dev Environment

```bash
# Option 1: Quickstart (recommended for first time)
atlas dev quickstart my-tenant

# Option 2: Step-by-step
atlas dev up --detach
atlas dev seed-control
atlas dev tenant create my-tenant

# Check status
atlas dev status

# Create additional tenants
atlas dev tenant create another-tenant --name "Another Tenant"

# When done, clean up
atlas dev reset --yes
```

### Working with Tenants

```bash
# Create a tenant for feature development
atlas dev tenant create feature-xyz --name "Feature XYZ Testing"

# Create a tenant for integration testing
atlas dev tenant create integration-test

# List all tenants
atlas dev status

# Delete a tenant when done
atlas dev tenant delete feature-xyz --yes
```

## service.yaml Specification

The `service.yaml` manifest is the single source of truth for service wiring.

### Required Fields

```yaml
name: my-service          # Must match directory name
type: api                 # api | worker | projector | hybrid
language: rust            # rust | typescript | python | go | etc.
```

### Optional Fields

```yaml
# Exposed ports (typically for api/hybrid services)
ports:
  - name: http
    containerPort: 8080
    protocol: TCP         # TCP | UDP (default: TCP)

# Non-secret environment variables
env:
  LOG_LEVEL: info
  FEATURE_FLAG: enabled

# Secret names (values stored externally)
secrets:
  - DATABASE_URL
  - API_KEY

# Kafka configuration
kafka:
  consumes:
    - topic: user.events
      group: payment-processor
  produces:
    - topic: payment.events

# Resource limits
resources:
  cpu: "500m"
  memory: "512Mi"

# Number of replicas
replicas: 3

# Health check endpoints
health:
  livenessPath: /healthz     # default: /healthz
  readinessPath: /readyz     # default: /readyz
```

### Complete Example

```yaml
name: payment-service
type: api
language: rust

ports:
  - name: http
    containerPort: 8080
    protocol: TCP

env:
  LOG_LEVEL: info
  ENVIRONMENT: production

secrets:
  - DATABASE_URL
  - STRIPE_API_KEY

kafka:
  consumes:
    - topic: order.created
      group: payment-processor
  produces:
    - topic: payment.processed
    - topic: payment.failed

resources:
  cpu: "1000m"
  memory: "1Gi"

replicas: 3

health:
  livenessPath: /healthz
  readinessPath: /readyz
```

## Service Types

### `api`
- HTTP/gRPC service with exposed ports
- Includes health check endpoints
- Generates Kubernetes Service for network access

### `worker`
- Background job processor
- No exposed ports
- Long-running process

### `projector`
- Event stream processor (typically Kafka consumer)
- Builds/maintains read models or projections
- Includes Kafka configuration by default

### `hybrid`
- Combination of API + background processing
- Has exposed ports AND background work
- Most flexible but use sparingly

## Extension Points

The CLI is designed to be extensible:

### Adding New Commands

1. Create a new module in `src/commands/`
2. Implement the `Command` trait
3. Register in `src/commands/mod.rs`
4. Add to the CLI enum in `src/main.rs`

### Adding New Service Types

1. Add variant to `ServiceType` enum in `src/types/manifest.rs`
2. Add handler logic in `src/generators/scaffold.rs`
3. Update templates in `src/generators/k8s.rs` if needed

### Adding New Languages

1. Add template functions in `src/generators/scaffold.rs`
2. Follow the pattern of existing `generate_<lang>_code` methods
3. Add appropriate run scripts in `generate_run_script`

## Design Principles

1. **Deterministic**: Same input always produces same output
2. **Idempotent**: Re-running commands doesn't create duplicates or drift
3. **service.yaml is SSOT**: All generated files derive from manifests
4. **Cross-platform**: Works on Windows and Linux
5. **Extensible**: Easy to add new commands and service types
6. **Mechanical**: Generation is template-based, not hand-coded

## Troubleshooting

### Service won't run

Ensure the run script has execute permissions:
```bash
chmod +x apps/<service>/run.sh
```

### Validation fails with drift

Regenerate infrastructure to sync with manifests:
```bash
atlas gen
atlas validate --check-drift
```

### Import/module errors

Ensure all dependencies are installed:
```bash
# For Rust
cd apps/<service> && cargo build

# For Node.js
cd apps/<service> && npm install

# For Python
cd apps/<service> && pip install -r requirements.txt

# For Go
cd apps/<service> && go mod tidy
```

## Testing

Run the test suite:

```bash
# From workspace root
cargo test -p atlas-cli

# Run specific test
cargo test -p atlas-cli test_scaffold_creates_service

# Run with output
cargo test -p atlas-cli -- --nocapture
```

## Contributing

When adding new features:

1. Maintain idempotency and determinism
2. Add tests in `tests/integration_test.rs`
3. Update this README
4. Follow existing code patterns

## License

Proprietary

## OpenAPI Integration

The Atlas CLI can generate typed, validated API services from OpenAPI v3 specifications.

### Quick Start with OpenAPI

```bash
# 1. Scaffold a service from an OpenAPI spec
atlas scaffold my-api --openapi ./specs/api.yaml

# 2. Review the generated code
cd apps/my-api
ls generated/     # routes.rs, models.rs, validation.rs
ls src/handlers/  # Handler stubs (implement your business logic here)

# 3. Implement handlers in src/handlers/*.rs
# Each handler has typed request/response models from the OpenAPI spec

# 4. Run the service
atlas run my-api
```

### What Gets Generated

When you provide an `--openapi` spec, the CLI generates:

**Generated Files** (regenerated on `atlas gen`):
- `apps/<service>/generated/models.rs` - Typed request/response structs from OpenAPI schemas
- `apps/<service>/generated/routes.rs` - Axum router with all API routes
- `apps/<service>/generated/validation.rs` - Request validation utilities
- `apps/<service>/generated/mod.rs` - Module exports

**Handler Stubs** (created once, NOT overwritten):
- `apps/<service>/src/handlers/<operation_id>.rs` - One file per operation
- `apps/<service>/src/handlers/mod.rs` - Handler module exports

Each handler stub returns a "Not implemented" response (HTTP 501). You implement the actual business logic.

### Health Endpoints

**Health endpoints are ALWAYS present**, regardless of OpenAPI spec:
- `/healthz` - Liveness probe
- `/readyz` - Readiness probe

These are required for Kubernetes deployments.

### OpenAPI Features

**Supported:**
- ✅ Request body schemas → Typed Rust structs
- ✅ Response models → Typed Rust structs
- ✅ Path parameters → Axum extractors
- ✅ Multiple HTTP methods (GET, POST, PUT, DELETE, PATCH)
- ✅ Tag filtering (`--openapi-tags`)
- ✅ Operation ID filtering (`--openapi-ops`)
- ✅ Base path customization (`--openapi-base-path`)
- ✅ JSON and YAML spec formats
- ✅ Hash-based drift detection

**Current Limitations (Rust only):**
- ⚠️ Query parameters: Manual implementation required
- ⚠️ Header parameters: Manual implementation required
- ⚠️ Response validation: Only request validation is enforced
- ⚠️ Complex path parameters: May need manual adjustment
- ⚠️ TypeScript/Python/Go: OpenAPI generation only supports Rust currently

### Example Workflow

```bash
# Given an OpenAPI spec with these operations:
# - POST /users (createUser)
# - GET /users (listUsers)
# - GET /users/{id} (getUser)

# 1. Scaffold
atlas scaffold user-service --openapi api.yaml

# 2. Generated structure:
apps/user-service/
├── service.yaml                    # Includes OpenAPI metadata
├── Cargo.toml
├── src/
│   ├── main.rs                     # Includes health endpoints + generated routes
│   └── handlers/
│       ├── mod.rs
│       ├── create_user.rs          # Stub: impl your logic here
│       ├── list_users.rs           # Stub: impl your logic here
│       └── get_user.rs             # Stub: impl your logic here
├── generated/
│   ├── mod.rs
│   ├── models.rs                   # CreateUserRequest, ListUsersResponse, etc.
│   ├── routes.rs                   # Router with /users routes
│   └── validation.rs
└── run.sh

# 3. Edit handler (example: src/handlers/create_user.rs)
pub async fn create_user(
    Json(payload): Json<CreateUserRequest>
) -> Result<Json<CreateUserResponse>, StatusCode> {
    // Your business logic here
    let user = db.create_user(payload.email, payload.name).await?;
    
    Ok(Json(CreateUserResponse {
        message: format!("Created user {}", user.id),
    }))
}

# 4. Regenerate if OpenAPI spec changes
atlas gen

# Handler implementations are preserved!
# Only generated/ directory is overwritten.
```

### Filtering Operations

Filter by tags:
```bash
atlas scaffold admin-api --openapi api.yaml --openapi-tags admin,internal
```

Filter by operation IDs:
```bash
atlas scaffold user-api --openapi api.yaml --openapi-ops createUser,getUser,updateUser
```

### Drift Detection

The CLI tracks the OpenAPI spec hash in `service.yaml`:

```yaml
openapi:
  source: specs/api.yaml
  basePath: /api/v1
  tags: []
  ops: []
  hash: a1b2c3d4...
```

When you run `atlas gen`, it:
1. Reads the spec from `source`
2. Compares hash with stored hash
3. Regenerates if changed
4. Updates hash in manifest

This ensures generated code stays in sync with your spec.

