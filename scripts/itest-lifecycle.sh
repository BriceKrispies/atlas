#!/bin/bash
# Integration test stack lifecycle management script
#
# Environment Configuration:
# All environment variables are injected directly by this script.
# No .env files are used - this follows the "strict by default" pattern.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/infra/compose/docker-compose.itest.yml"
BAKE_FILE="$PROJECT_ROOT/infra/compose/docker-bake.itest.hcl"

# Use podman by default, override with CONTAINER_RUNTIME=docker if you must
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-podman}"
COMPOSE_CMD="$CONTAINER_RUNTIME compose"
BUILDX_CMD="$CONTAINER_RUNTIME buildx"

# When running under podman, `podman compose` delegates to an external
# provider (docker-compose or podman-compose). Auto-detect podman-compose
# from common install locations if the env var isn't already set, so
# `make itest` works out of the box on a machine with `pip install --user
# podman-compose`. Override by exporting PODMAN_COMPOSE_PROVIDER yourself.
if [[ "$CONTAINER_RUNTIME" == "podman" && -z "${PODMAN_COMPOSE_PROVIDER:-}" ]]; then
    for candidate in \
        "${APPDATA:-}/Python/Python310/Scripts/podman-compose.exe" \
        "${APPDATA:-}/Python/Python311/Scripts/podman-compose.exe" \
        "${APPDATA:-}/Python/Python312/Scripts/podman-compose.exe" \
        "${HOME:-}/.local/bin/podman-compose" \
        "/usr/local/bin/podman-compose"; do
        if [[ -n "$candidate" && -x "$candidate" ]] || [[ -n "$candidate" && -f "$candidate" ]]; then
            export PODMAN_COMPOSE_PROVIDER="$candidate"
            break
        fi
    done
    if [[ -z "${PODMAN_COMPOSE_PROVIDER:-}" ]] && command -v podman-compose &>/dev/null; then
        export PODMAN_COMPOSE_PROVIDER="$(command -v podman-compose)"
    fi
fi

# Support for compose profiles (e.g., obs for observability stack)
# Can be set via ITEST_PROFILE env var or second argument
PROFILE="${ITEST_PROFILE:-${2:-}}"
PROFILE_FLAG=""
if [[ -n "$PROFILE" ]]; then
    PROFILE_FLAG="--profile $PROFILE"
fi

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# Integration Test Environment Configuration
# These values are hardcoded here - the single source of truth for itest env.
# ============================================================================

# Core mode setting
export ATLAS_ENV="dev"

# Database Configuration
# Host port 15432 (not 5432) so the itest stack doesn't collide with a
# native Postgres install on developer machines. Internal container port
# stays 5432 (see compose mapping ${POSTGRES_PORT}:5432).
export POSTGRES_PORT="${POSTGRES_PORT:-15432}"
export POSTGRES_USER="atlas_platform"
export POSTGRES_PASSWORD="itest_password_change_me"
export POSTGRES_DB="control_plane"
export CONTROL_PLANE_DB_URL="postgres://atlas_platform:itest_password_change_me@postgres:5432/control_plane"

# Application Configuration
export CONTROL_PLANE_ENABLED="true"
export TENANT_ID="tenant-itest-001"
export TEST_TENANT_ID="tenant-itest-001"
export RUST_LOG="info,atlas_platform_ingress=debug,atlas_platform_workers=debug"

# Test auth mode (for blackbox tests)
export TEST_AUTH_ENABLED="true"
export DEBUG_AUTH_ENDPOINT_ENABLED="true"

# Keycloak configuration
export KEYCLOAK_ADMIN="admin"
export KEYCLOAK_ADMIN_PASSWORD="admin"
export KEYCLOAK_PORT="8081"

# Service Ports
export INGRESS_PORT="3000"
export CONTROL_PLANE_PORT="8000"
export WORKERS_METRICS_PORT="9101"

# Observability Configuration
export PROMETHEUS_PORT="9090"
export GRAFANA_PORT="3001"
export LOKI_PORT="3100"

# Ops UI Configuration
export DOZZLE_PORT="8080"
export PGADMIN_PORT="5050"
export PGADMIN_DEFAULT_EMAIL="admin@example.com"
export PGADMIN_DEFAULT_PASSWORD="admin"

# Metrics Configuration
export METRICS_ADDR="0.0.0.0:9100"

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}→${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v $CONTAINER_RUNTIME &> /dev/null; then
        log_error "Container runtime '$CONTAINER_RUNTIME' not found"
        exit 1
    fi

    log_success "Container runtime: $CONTAINER_RUNTIME"
}

check_port_available() {
    local PORT=$1
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        log_warn "Port $PORT is already in use"
        return 1
    fi
    return 0
}

# Run compose with all environment variables already exported
run_compose() {
    $COMPOSE_CMD -f "$COMPOSE_FILE" $PROFILE_FLAG "$@"
}

itest_up() {
    if [[ -n "$PROFILE" ]]; then
        log_info "Starting Atlas Platform integration test stack (with $PROFILE profile)..."
    else
        log_info "Starting Atlas Platform integration test stack..."
    fi
    log_info "Environment: ATLAS_ENV=$ATLAS_ENV, TENANT_ID=$TENANT_ID"

    check_prerequisites

    if [[ -n "$PROFILE" ]]; then
        log_success "Observability profile enabled"
    fi

    # Check critical ports
    log_info "Checking port availability..."
    check_port_available 3000 || log_warn "Ingress port 3000 may conflict"
    check_port_available 8080 || log_warn "Dozzle port 8080 may conflict"

    # Build images. Docker Buildx supports `bake` for parallel builds, but
    # podman doesn't have an equivalent — fall back to sequential `build`
    # calls when running under podman. Image tags here must match what the
    # compose file references.
    log_info "Building application images..."
    echo "═══════════════════════════════════════════════════════════"

    pushd "$PROJECT_ROOT" > /dev/null

    if [[ "$CONTAINER_RUNTIME" == "docker" ]]; then
        BUILDX_BAKE_ENTITLEMENTS_FS=0 $BUILDX_CMD bake -f "$BAKE_FILE" --progress=plain --load
    else
        # Podman: build each image in turn. Tags + dockerfiles must stay
        # in sync with infra/compose/docker-bake.itest.hcl.
        $CONTAINER_RUNTIME build \
            -f apps/control-plane/Dockerfile \
            -t atlas-platform-control-plane:itest .
        $CONTAINER_RUNTIME build \
            -f infra/docker/Dockerfile.ingress \
            --build-arg CARGO_FEATURES=test-auth \
            -t atlas-platform-ingress:itest .
        $CONTAINER_RUNTIME build \
            -f infra/docker/Dockerfile.workers \
            -t atlas-platform-workers:itest .
    fi

    popd > /dev/null

    echo "═══════════════════════════════════════════════════════════"
    log_success "Image build completed"


    # Start stack using pre-built images (env vars are already exported)
    log_info "Starting containers..."
    run_compose up -d

    # Wait for critical services
    log_info "Waiting for services to become healthy..."
    sleep 5

    print_summary
}

itest_down() {
    log_info "Stopping integration test stack..."
    run_compose down
    log_success "All containers stopped"
    echo ""
    echo "NOTE: Volumes preserved. Use 'make itest-clean' to remove data."
}

itest_clean() {
    log_info "Removing volumes..."
    run_compose down -v
    log_success "All volumes removed"
}

itest_status() {
    log_info "Container status:"
    run_compose ps
}

itest_logs() {
    run_compose logs -f "${@}"
}

print_summary() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    if [[ -n "$PROFILE" ]]; then
        echo "  Atlas Platform Integration Test Stack is READY"
        echo "     (Full Observability Enabled)"
    else
        echo "  Atlas Platform Integration Test Stack is READY"
    fi
    echo "═══════════════════════════════════════════════════════════"
    echo ""
    echo "Environment:"
    echo "  ATLAS_ENV=$ATLAS_ENV (dev mode - relaxed config)"
    echo "  TENANT_ID=$TENANT_ID"
    echo ""
    echo "Application Services:"
    echo "  Ingress (test target):  http://localhost:3000"
    echo "  Control Plane:          http://localhost:8000"
    echo "  Workers Metrics:        http://localhost:9101/metrics"
    echo ""
    echo "Ops UI:"
    echo "  Logs (Dozzle):          http://localhost:8080"

    # Show observability services only when obs profile is active
    if [[ "$PROFILE" == "obs" ]]; then
        echo "  Database (pgAdmin):     http://localhost:5050"
        echo "  Metrics (Grafana):      http://localhost:3001"
        echo ""
        echo "Observability Stack:"
        echo "  Prometheus:             http://localhost:9090"
        echo "  Loki:                   http://localhost:3100"
    fi

    echo ""
    echo "Quick Commands:"
    if [[ -n "$PROFILE" ]]; then
        echo "  View logs:              ITEST_PROFILE=$PROFILE make itest-logs"
        echo "  Run tests:              make itest-test"
        echo "  Default mode:           make itest-up"
        echo "  Restart:                ITEST_PROFILE=$PROFILE make itest-restart"
        echo "  Stop:                   ITEST_PROFILE=$PROFILE make itest-down"
    else
        echo "  View logs:              make itest-logs"
        echo "  Run tests:              make itest-test"
        echo "  Full observability:     ITEST_PROFILE=obs make itest-up"
        echo "  Restart:                make itest-restart"
        echo "  Stop:                   make itest-down"
        echo "  Clean reset:            make itest-reset"
    fi
    echo ""
    echo "═══════════════════════════════════════════════════════════"
}

# Main command dispatcher
case "${1:-}" in
    up)
        itest_up
        ;;
    down)
        itest_down
        ;;
    clean)
        itest_clean
        ;;
    status)
        itest_status
        ;;
    logs)
        shift
        itest_logs "$@"
        ;;
    summary)
        print_summary
        ;;
    *)
        echo "Usage: $0 {up|down|clean|status|logs|summary}"
        exit 1
        ;;
esac
