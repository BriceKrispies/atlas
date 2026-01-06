# Atlas Platform

A multi-tenant CMS platform implementing hexagonal architecture with CQRS, event sourcing, and ABAC authorization.

## Documentation

**All platform documentation lives in `/specs`.**

This system is **specification-first**. All implementation must conform to the specifications in `/specs`:

- **Feature Specifications** — Module definitions, UI surfaces, and event contracts
- **Cross-Cutting Concerns** — Tenancy, security, events, and storage patterns
- **Data Schemas** — Conceptual data models for each module
- **JSON Schemas** — `*.schema.json` files defining domain contracts
- **Fixtures** — `fixtures/*.json` golden examples demonstrating correct behavior

**The specs are the source of truth.** Code is secondary.

### Viewing Documentation

To browse the full specification documentation with navigation and search:

```bash
cd specs
mdbook serve
```

Then visit `http://localhost:3000`

Or read the markdown files directly in `/specs`.

## Workspace Structure

```
crates/
├── core/              # Pure domain logic, policy evaluation, schema validation
├── runtime/           # Ports, action registry, projection abstractions
├── adapters/          # Adapters (in-memory and postgres implementations)
├── control_plane_db/  # Database migrations and seed scripts
├── ingress/           # HTTP ingress binary (single chokepoint)
├── workers/           # Background job runner binary
└── spec_validate/     # Fixture validation binary
```

## Control Plane Registry

The Control Plane Registry is a centralized Postgres database that stores:
- **Module manifests** (versioned) - action definitions, schemas, handlers
- **Schema registry** (versioned) - JSON schemas for domain types
- **Tenant configurations** - which module versions are enabled per tenant
- **Policy bundles** (versioned) - ABAC authorization policies per tenant

The ingress service bootstraps at startup by loading its runtime configuration from the Control Plane Registry. This enables:
- Dynamic module loading based on tenant configuration
- Multi-tenancy with isolated policies
- Versioned schema evolution
- Centralized policy management

### Prerequisites

The database runs in a container using **podman** by default. Install podman and podman-compose:

```bash
# For most Linux distributions
sudo apt install podman podman-compose  # Debian/Ubuntu
sudo dnf install podman podman-compose  # Fedora/RHEL

# For macOS
brew install podman podman-compose

# For Windows
# Option 1: Use WSL2 (recommended)
#   Install WSL2, then install podman in your WSL distribution
#   Follow: https://podman.io/getting-started/installation
# Option 2: Use Docker Desktop
#   Install Docker Desktop for Windows
#   Set CONTAINER_RUNTIME=docker when running make commands

# Alternatively, use Docker on any platform
export CONTAINER_RUNTIME=docker  # Set this to use docker instead
```

**Note for Windows users**: The Makefile and lifecycle script require a bash shell. Use Git Bash, WSL2, or MSYS2.

### Database Setup

#### Option 1: Using Make (Recommended)

```bash
# 1. Copy environment configuration (optional, has sensible defaults)
cp infra/compose/.env.example infra/compose/.env

# 2. Start Postgres database (automatically waits for readiness)
make db-up

# 3. Run migrations
make db-migrate

# 4. Seed sample data (optional)
make db-seed

# Check database status
make db-status

# View database logs
make db-logs

# Stop database (when done)
make db-down

# Reset database (drop all data, restart, and re-migrate)
make db-reset
```

**Using Docker instead of Podman:**
```bash
# Set environment variable before running make commands
export CONTAINER_RUNTIME=docker
make db-up
```

#### Option 2: Using Lifecycle Script (Advanced)

For more control, use the standalone lifecycle script:

```bash
# Start database and wait for readiness
./scripts/db-lifecycle.sh start

# Check status and health
./scripts/db-lifecycle.sh status

# View logs (pass -f to follow)
./scripts/db-lifecycle.sh logs
./scripts/db-lifecycle.sh logs -f

# Restart database
./scripts/db-lifecycle.sh restart

# Stop database
./scripts/db-lifecycle.sh stop

# Get help
./scripts/db-lifecycle.sh help
```

The script provides:
- ✓ Automatic health checking with pg_isready
- ✓ Colored output for better visibility
- ✓ Smart waiting (up to 30 seconds with progress)
- ✓ Status verification before operations
- ✓ Works with both podman and docker

### Environment Variables

Create `infra/compose/.env` or set these in your shell:

```bash
# Control Plane Database
CONTROL_PLANE_DB_URL=postgres://atlas_platform:local_dev_password@localhost:5432/control_plane
CONTROL_PLANE_ENABLED=true

# Tenant ID (used for bootstrap)
TENANT_ID=tenant-001

# Postgres credentials (for Docker Compose)
POSTGRES_DB=control_plane
POSTGRES_USER=atlas_platform
POSTGRES_PASSWORD=local_dev_password
POSTGRES_PORT=5432
```

### Running with Database

```bash
# Start database and run migrations
make db-up
make db-migrate
make db-seed

# Run ingress service (bootstraps from database)
CONTROL_PLANE_ENABLED=true \
CONTROL_PLANE_DB_URL=postgres://atlas_platform:local_dev_password@localhost:5432/control_plane \
TENANT_ID=tenant-001 \
make run-ingress
```

### Accessing the Database

**pgAdmin Web Interface:**
- After running `make db-up`, pgAdmin is available at http://localhost:5050
- Default credentials:
  - Email: `admin@example.com`
  - Password: `admin`
- The Postgres server "Atlas Platform Control Plane" is pre-configured
- When connecting for the first time, enter the database password: `local_dev_password`
- All tables are in the `control_plane` schema

**Direct Connection:**
```bash
# Using psql
docker exec -it atlas-platform-control-plane-db psql -U atlas_platform -d control_plane

# Or from your host (if you have psql installed)
psql postgres://atlas_platform:local_dev_password@localhost:5432/control_plane
```

### Running without Database (In-Memory Mode)

```bash
# Run ingress with in-memory fallback
CONTROL_PLANE_ENABLED=false \
make run-ingress
```

## Quick Start

```bash
# Build all crates
make build

# Run tests
make test

# Format code
make fmt

# Lint
make lint

# Validate specs
make spec-check

# Database operations (optional - for Control Plane Registry)
make db-up          # Start Postgres (waits for readiness)
make db-status      # Check if database is running and healthy
make db-migrate     # Run migrations (waits for DB first)
make db-seed        # Seed sample data (waits for DB first)
make db-logs        # View database logs
make db-down        # Stop database
make db-reset       # Drop all data and re-migrate

# Run services (with database)
CONTROL_PLANE_ENABLED=true TENANT_ID=tenant-001 make run-ingress

# Run services (without database - in-memory mode)
make run-ingress
make run-workers
```

## Integration Testing

Atlas Platform includes a comprehensive black-box integration test suite that validates the entire system in a production-like environment.

### Quick Start

```bash
# Start the full integration test stack (all services + ops UI)
make itest-up

# Run all black-box tests
make itest-test

# Or do both in one command
make itest

# Stop the stack
make itest-down
```

### What's Included

The integration test stack includes:

**Application Services:**
- **Ingress** (port 3000) - HTTP API server (primary test target)
- **Workers** (port 9101) - Background job processor
- **Control Plane** (port 8000) - Module registry service
- **PostgreSQL** (port 5432) - Control plane database

**Observability Stack:**
- **Prometheus** (port 9090) - Metrics collection
- **Grafana** (port 3001) - Dashboards and visualization
- **Loki** (port 3100) - Log aggregation

**Ops UI:**
- **Dozzle** (port 8080) - Real-time container log viewer
- **pgAdmin** (port 5050) - Database management UI

### Available Commands

```bash
make itest-up        # Start full integration test stack
make itest-down      # Stop integration test stack
make itest-restart   # Restart all services
make itest-logs      # View logs from all containers
make itest-status    # Check service health and status
make itest-clean     # Remove volumes (clean state)
make itest-reset     # Full reset: down + clean + up
make itest-test      # Run black-box integration tests
make itest           # Full workflow: up + wait + test
```

### Test Suites

The black-box tests are located in `tests/blackbox/` and validate:

- **Health Tests** - Service availability and metrics endpoints
- **Intent Submission Tests** - Core API functionality
- **Idempotency Tests** - Invariant I3 enforcement
- **Authorization Tests** - Policy-based access control (Invariant I2)
- **Observability Tests** - Metrics instrumentation

All tests interact with the ingress service via HTTP only, treating the system as a black box.

### Accessing the Ops UI

After running `make itest-up`, access these dashboards:

- **Logs (Dozzle):** http://localhost:8080 - Real-time log viewer with search
- **Database (pgAdmin):** http://localhost:5050 - SQL queries and schema inspection
  - Credentials: `admin@itest.local` / `admin`
- **Metrics (Grafana):** http://localhost:3001 - Metrics dashboards
  - No login required (anonymous access enabled)
- **Prometheus:** http://localhost:9090 - Raw metrics queries

### Running Tests

```bash
# Run all test suites
make itest-test

# Run specific test suite
cd tests/blackbox
cargo test health
cargo test intent_submission
cargo test idempotency
cargo test authorization
cargo test observability

# Run with verbose output
cd tests/blackbox
cargo test -- --nocapture
```

### Debugging

```bash
# View live logs from all containers
make itest-logs

# View logs from specific service
docker logs atlas-itest-ingress -f

# Check container health
make itest-status

# Open log viewer UI
open http://localhost:8080  # Dozzle

# Inspect database
open http://localhost:5050  # pgAdmin
```

### Clean State

If you need to start fresh:

```bash
# Full reset (removes all volumes and data)
make itest-reset

# Or manually
make itest-down
make itest-clean
make itest-up
```

### CI/CD Integration

Example GitHub Actions workflow:

```yaml
- name: Start integration test stack
  run: make itest-up

- name: Run black-box tests
  run: make itest-test

- name: Stop integration test stack
  if: always()
  run: make itest-down
```

For more details, see `tests/blackbox/README.md`.

## Core Invariants

The following 12 core invariants (I1-I12) must be enforced by any implementation:

- I1: Single Ingress Enforcement
- I2: Authorization Precedes Execution
- I3: Idempotency Before Execution
- I4: Deny-Overrides-Allow Authorization
- I5: Correlation Propagation
- I6: Causation Linkage
- I7: Tenant Isolation in Search
- I8: Permission-Filtered Search
- I9: Cache Keys Include TenantId
- I10: Event-Driven Cache Invalidation
- I11: Deterministic Time Bucketing (Analytics)
- I12: Projections Are Rebuildable

## Development

### Prerequisites

- Rust 1.75+ (use rustup)
- cargo, rustfmt, clippy

### Commands

```bash
cargo build              # Build all crates
cargo test               # Run all tests
cargo fmt                # Format code
cargo clippy             # Lint code
cargo run -p ingress     # Run ingress service
cargo run -p workers     # Run workers service
cargo run -p spec_validate  # Validate fixtures
```

## License

Proprietary
