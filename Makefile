.PHONY: build test fmt lint clean run-ingress run-workers spec-check help
.PHONY: db-up db-down db-reset db-migrate db-seed db-status db-wait db-logs
.PHONY: obs-up obs-down obs-logs obs-reset obs-open obs-status
.PHONY: itest-up itest-down itest-restart itest-logs itest-status itest-clean itest-reset itest-test itest

# Container runtime configuration
CONTAINER_RUNTIME ?= docker
COMPOSE_CMD = $(CONTAINER_RUNTIME)-compose
COMPOSE_FILE = infra/compose/compose.control-plane.yml
CONTAINER_NAME = atlas-platform-control-plane-db

# Database connection settings (must match .env)
DB_HOST ?= localhost
DB_PORT ?= 5432
DB_USER ?= atlas_platform
DB_NAME ?= control_plane
PGPASSWORD ?= local_dev_password

help:
	@echo "Available targets:"
	@echo "  build         - Build all crates"
	@echo "  test          - Run all tests"
	@echo "  fmt           - Format code with rustfmt"
	@echo "  lint          - Lint code with clippy"
	@echo "  clean         - Clean build artifacts"
	@echo "  run-ingress   - Run ingress service"
	@echo "  run-workers   - Run workers service"
	@echo "  spec-check    - Validate golden fixtures"
	@echo ""
	@echo "Database targets (using $(CONTAINER_RUNTIME)):"
	@echo "  db-up         - Start Postgres container and wait for readiness"
	@echo "  db-down       - Stop Postgres container"
	@echo "  db-status     - Check if database container is running and healthy"
	@echo "  db-wait       - Wait for database to be ready to accept connections"
	@echo "  db-logs       - Show database container logs"
	@echo "  db-reset      - Reset database (down, up, migrate)"
	@echo "  db-migrate    - Run database migrations"
	@echo "  db-seed       - Seed database with sample data"
	@echo ""
	@echo "Observability targets (using $(CONTAINER_RUNTIME)):"
	@echo "  obs-up        - Start observability stack (Prometheus, Grafana, Loki)"
	@echo "  obs-down      - Stop observability stack"
	@echo "  obs-status    - Check observability services status"
	@echo "  obs-logs      - Show observability logs"
	@echo "  obs-reset     - Reset observability (down, remove volumes, up)"
	@echo "  obs-open      - Show URLs for observability services"
	@echo ""
	@echo "Integration Test targets (using $(CONTAINER_RUNTIME)):"
	@echo "  itest-up      - Start full integration test stack (all services + ops UI)"
	@echo "  itest-down    - Stop integration test stack"
	@echo "  itest-restart - Restart integration test stack"
	@echo "  itest-logs    - Show logs from all itest containers"
	@echo "  itest-status  - Check integration test services status"
	@echo "  itest-clean   - Remove integration test volumes"
	@echo "  itest-reset   - Full reset (down, clean, up)"
	@echo "  itest-test    - Run black-box integration tests"
	@echo "  itest         - Full workflow: up + wait + test"
	@echo ""
	@echo "Set CONTAINER_RUNTIME=docker to use docker instead of podman"

build:
	cargo build

test:
	cargo test

fmt:
	cargo fmt --all

lint:
	cargo clippy --all-targets --all-features -- -D warnings

clean:
	cargo clean

run-ingress:
	cargo run -p atlas-platform-ingress

run-workers:
	cargo run -p atlas-platform-workers

spec-check:
	cargo run -p atlas-platform-spec-validate

# Database lifecycle targets
db-status:
	@echo "=== Database Container Status ==="
	@bash -c ' \
		if $(CONTAINER_RUNTIME) ps --format "{{.Names}}" | grep -q "^$(CONTAINER_NAME)$$"; then \
			echo "✓ Container '\''$(CONTAINER_NAME)'\'' is running"; \
			echo ""; \
			echo "Container details:"; \
			$(CONTAINER_RUNTIME) ps --filter "name=$(CONTAINER_NAME)" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"; \
		else \
			echo "✗ Container '\''$(CONTAINER_NAME)'\'' is NOT running"; \
			exit 1; \
		fi \
	'

db-wait:
	@echo "Waiting for Postgres to accept connections..."
	@bash -c ' \
		for i in {1..30}; do \
			if $(CONTAINER_RUNTIME) exec $(CONTAINER_NAME) pg_isready -h localhost -U $(DB_USER) -d $(DB_NAME) > /dev/null 2>&1; then \
				echo "✓ Postgres is ready (attempt $$i/30)"; \
				exit 0; \
			fi; \
			echo "  Waiting for Postgres... (attempt $$i/30)"; \
			sleep 1; \
		done; \
		echo "✗ Postgres failed to become ready after 30 attempts"; \
		exit 1 \
	'

db-logs:
	@echo "=== Database Container Logs ==="
	@$(CONTAINER_RUNTIME) logs $(CONTAINER_NAME)

db-up:
	@echo "=== Starting Postgres Container ==="
	@cd infra/compose && $(COMPOSE_CMD) -f compose.control-plane.yml up -d
	@echo ""
	@$(MAKE) db-wait
	@echo ""
	@echo "✓ Database is up and ready"

db-down:
	@echo "=== Stopping Postgres Container ==="
	@cd infra/compose && $(COMPOSE_CMD) -f compose.control-plane.yml down
	@echo "✓ Database stopped"

db-reset: db-down db-up db-migrate
	@echo "✓ Database reset complete"

db-migrate: db-wait
	@echo "=== Running Database Migrations ==="
	@cd infra/compose && $(COMPOSE_CMD) -f compose.control-plane.yml run --rm migrate
	@echo "✓ Migrations complete"

db-seed: db-wait
	@echo "=== Seeding Database ==="
	@cd infra/compose && $(COMPOSE_CMD) -f compose.control-plane.yml run --rm seed
	@echo "✓ Seed complete"

# Observability lifecycle targets
obs-status:
	@echo "=== Observability Services Status ==="
	@cd infra/compose && $(COMPOSE_CMD) -f compose.observability.yml ps

obs-logs:
	@echo "=== Observability Logs ==="
	@cd infra/compose && $(COMPOSE_CMD) -f compose.observability.yml logs -f

obs-up:
	@echo "=== Starting Observability Stack ==="
	@cd infra/compose && $(COMPOSE_CMD) -f compose.observability.yml up -d
	@echo "✓ Observability stack started"
	@echo ""
	@$(MAKE) obs-open

obs-down:
	@echo "=== Stopping Observability Stack ==="
	@cd infra/compose && $(COMPOSE_CMD) -f compose.observability.yml down
	@echo "✓ Observability stack stopped"

obs-reset:
	@echo "=== Resetting Observability Stack ==="
	@cd infra/compose && $(COMPOSE_CMD) -f compose.observability.yml down -v
	@echo ""
	@$(MAKE) obs-up

obs-open:
	@echo "Observability Services:"
	@echo "  Grafana:    http://localhost:3001 (admin/admin)"
	@echo "  Prometheus: http://localhost:9090"
	@echo "  Loki:       http://localhost:3100"
	@echo ""
	@echo "Application Metrics Endpoints:"
	@echo "  Ingress:    http://localhost:3000/metrics"
	@echo "  Workers:    http://localhost:9101/metrics"

# Integration Test Stack
ITEST_COMPOSE_FILE = infra/compose/docker-compose.itest.yml
ITEST_ENV_FILE = infra/compose/.env.itest

itest-up:
	@echo "=== Starting Integration Test Stack ==="
	@bash scripts/itest-lifecycle.sh up

itest-up-obs:
	@echo "=== Starting Integration Test Stack (with observability) ==="
	@ITEST_PROFILE=obs bash scripts/itest-lifecycle.sh up

itest-down:
	@echo "=== Stopping Integration Test Stack ==="
	@bash scripts/itest-lifecycle.sh down

itest-down-obs:
	@echo "=== Stopping Integration Test Stack (with observability) ==="
	@ITEST_PROFILE=obs bash scripts/itest-lifecycle.sh down

itest-restart:
	@echo "=== Restarting Integration Test Stack ==="
	@$(MAKE) itest-down
	@$(MAKE) itest-up

itest-restart-obs:
	@echo "=== Restarting Integration Test Stack (with observability) ==="
	@$(MAKE) itest-down-obs
	@$(MAKE) itest-up-obs

itest-logs:
	@bash scripts/itest-lifecycle.sh logs $(filter-out $@,$(MAKECMDGOALS))

itest-status:
	@bash scripts/itest-lifecycle.sh status

itest-clean:
	@echo "=== Cleaning Integration Test Volumes ==="
	@bash scripts/itest-lifecycle.sh clean

itest-reset:
	@echo "=== Resetting Integration Test Stack ==="
	@$(MAKE) itest-down
	@$(MAKE) itest-clean
	@$(MAKE) itest-up

itest-test:
	@echo "=== Running Black-Box Integration Tests ==="
	@cd tests/blackbox && cargo test --release -- --test-threads=4
	@echo "✓ All tests passed"

itest: itest-up
	@echo "→ Waiting for stack to stabilize (5s)..."
	@sleep 5
	@$(MAKE) itest-test

# Catch-all target for itest-logs arguments
%:
	@:
