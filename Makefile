.PHONY: help
.PHONY: db-up db-down db-reset db-migrate db-seed db-status db-wait db-logs
.PHONY: obs-up obs-down obs-logs obs-reset obs-open obs-status
.PHONY: keycloak-up keycloak-down keycloak-status keycloak-logs keycloak-reset keycloak-open keycloak-wait
.PHONY: itest-up itest-down itest-restart itest-logs itest-status itest-clean itest-reset itest-test itest
.PHONY: itest-container-build itest-container-run itest-container

# ---------------------------------------------------------------------------
# Dev-stack lifecycle
#
# The db / obs / keycloak / smtp stacks are orchestrated by scripts/dev (the
# devctl tool). These make targets are THIN ALIASES over it — run devctl
# directly for machine-readable output:
#
#   pnpm devctl stack db up --json
#   pnpm devctl logs db --tail 100 --no-follow
#
# Compose-command resolution (podman-compose vs `podman compose` vs docker)
# and the Windows podman-compose-provider trap are handled inside the tool.
# Set CONTAINER_RUNTIME=docker to override podman (the tool reads it).
# ---------------------------------------------------------------------------
CONTAINER_RUNTIME ?= podman
export CONTAINER_RUNTIME

DEVCTL = node --experimental-transform-types scripts/dev/main.ts

CONTROL_PLANE_DB_URL ?= postgres://atlas_platform:local_dev_password@localhost:15433/control_plane

help:
	@echo "Atlas dev stacks — thin aliases over scripts/dev (run 'pnpm devctl ...' for --json):"
	@echo ""
	@echo "Database:        db-up db-down db-status db-wait db-logs db-reset db-seed"
	@echo "Observability:   obs-up obs-down obs-status obs-logs obs-reset obs-open"
	@echo "Keycloak:        keycloak-up keycloak-down keycloak-status keycloak-wait keycloak-logs keycloak-reset keycloak-open"
	@echo "SMTP (smtp4dev): pnpm devctl stack smtp up | down | status (or pnpm smtp:up / smtp:down)"
	@echo ""
	@echo "Integration test stack (containerised; Rust-era — see infra/CLAUDE.md):"
	@echo "  itest-up itest-down itest-restart itest-logs itest-status itest-clean itest-reset itest-test itest"
	@echo "  itest-container-build itest-container-run itest-container"
	@echo ""
	@echo "Log inspection:  pnpm devctl logs <service...> [--tail N] [--no-follow]"
	@echo "                 services: db keycloak grafana prometheus loki promtail smtp pgadmin"
	@echo ""
	@echo "Set CONTAINER_RUNTIME=docker to use docker instead of podman."

# Database -------------------------------------------------------------------
db-up:
	$(DEVCTL) stack db up

db-down:
	$(DEVCTL) stack db down

db-status:
	$(DEVCTL) stack db status

db-wait:
	$(DEVCTL) stack db wait

db-logs:
	$(DEVCTL) stack db logs

db-reset:
	$(DEVCTL) stack db reset

db-migrate:
	@echo "Migrations run automatically when @atlas/server boots (apps/server/src/bootstrap.ts)."
	@echo "To force-run, start the server: pnpm --filter @atlas/server dev"

db-seed: export ATLAS_ENV = dev
db-seed: export CONTROL_PLANE_DB_URL := $(CONTROL_PLANE_DB_URL)
db-seed: db-wait
	@echo "=== Seeding Database ==="
	pnpm --filter @atlas/adapter-node seed
	@echo "✓ Seed complete"

# Observability --------------------------------------------------------------
obs-up:
	$(DEVCTL) stack obs up

obs-down:
	$(DEVCTL) stack obs down

obs-status:
	$(DEVCTL) stack obs status

obs-logs:
	$(DEVCTL) stack obs logs

obs-reset:
	$(DEVCTL) stack obs reset

obs-open:
	$(DEVCTL) stack obs status

# Keycloak -------------------------------------------------------------------
keycloak-up:
	$(DEVCTL) stack keycloak up

keycloak-down:
	$(DEVCTL) stack keycloak down

keycloak-status:
	$(DEVCTL) stack keycloak status

keycloak-wait:
	$(DEVCTL) stack keycloak wait

keycloak-logs:
	$(DEVCTL) stack keycloak logs

keycloak-reset:
	$(DEVCTL) stack keycloak reset

keycloak-open:
	$(DEVCTL) stack keycloak status

# Integration Test Stack (containerised; Rust-era — see infra/CLAUDE.md) ------
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
	@pnpm test:integration
	@echo "✓ All tests passed"

itest: itest-up
	@echo "→ Waiting for stack to stabilize (5s)..."
	@sleep 5
	@$(MAKE) itest-test

# Single-container integration test (full stack in one container)
ITEST_CONTAINER_IMAGE = atlas-itest

itest-container-build:
	@echo "=== Building Integration Test Container ==="
	$(CONTAINER_RUNTIME) build -f infra/docker/Dockerfile.itest -t $(ITEST_CONTAINER_IMAGE) .

itest-container-run:
	@echo "=== Running Integration Test Container ==="
	@mkdir -p test-output test-logs
	$(CONTAINER_RUNTIME) run --rm \
		-v $(PWD)/test-output:/test-results \
		-v $(PWD)/test-logs:/test-logs \
		$(ITEST_CONTAINER_IMAGE)

itest-container: itest-container-build itest-container-run
	@echo ""
	@echo "Results: test-output/  Logs: test-logs/"

# Catch-all target for itest-logs arguments
%:
	@:
