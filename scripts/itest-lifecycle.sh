#!/bin/bash
# Integration test stack lifecycle management script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/infra/compose/docker-compose.itest.yml"
BAKE_FILE="$PROJECT_ROOT/infra/compose/docker-bake.itest.hcl"
ENV_FILE="$PROJECT_ROOT/infra/compose/.env.itest"

# Use docker by default, override with CONTAINER_RUNTIME env var
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"
COMPOSE_CMD="$CONTAINER_RUNTIME compose"
BUILDX_CMD="$CONTAINER_RUNTIME buildx"

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

itest_up() {
    if [[ -n "$PROFILE" ]]; then
        log_info "Starting Atlas Platform integration test stack (with $PROFILE profile)..."
    else
        log_info "Starting Atlas Platform integration test stack..."
    fi

    check_prerequisites

    if [[ -n "$PROFILE" ]]; then
        log_success "Observability profile enabled"
    fi

    # Check critical ports
    log_info "Checking port availability..."
    check_port_available 3000 || log_warn "Ingress port 3000 may conflict"
    check_port_available 8080 || log_warn "Dozzle port 8080 may conflict"

    # Build images using buildx bake for parallel builds and better caching
    log_info "Building application images (parallel via buildx bake)..."
    echo "═══════════════════════════════════════════════════════════"

    # Change to project root for correct build context
    pushd "$PROJECT_ROOT" > /dev/null

    # Use buildx bake for faster parallel builds with progress output
    # --progress=plain shows full build output including cargo progress
    # BUILDX_BAKE_ENTITLEMENTS_FS=0 disables filesystem permission prompts on Windows
    BUILDX_BAKE_ENTITLEMENTS_FS=0 $BUILDX_CMD bake -f "$BAKE_FILE" --progress=plain --load

    popd > /dev/null

    echo "═══════════════════════════════════════════════════════════"
    log_success "Image build completed"


    # Start stack using pre-built images
    log_info "Starting containers..."
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE_FLAG up -d

    # Wait for critical services
    log_info "Waiting for services to become healthy..."
    sleep 5

    print_summary
}

itest_down() {
    log_info "Stopping integration test stack..."
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE_FLAG down
    log_success "All containers stopped"
    echo ""
    echo "NOTE: Volumes preserved. Use 'make itest-clean' to remove data."
}

itest_clean() {
    log_info "Removing volumes..."
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE_FLAG down -v
    log_success "All volumes removed"
}

itest_status() {
    log_info "Container status:"
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE_FLAG ps
}

itest_logs() {
    $COMPOSE_CMD -f "$COMPOSE_FILE" --env-file "$ENV_FILE" $PROFILE_FLAG logs -f "${@}"
}

print_summary() {
    echo ""
    echo "═══════════════════════════════════════════════════════════"
    if [[ -n "$PROFILE" ]]; then
        echo "🚀 Atlas Platform Integration Test Stack is READY"
        echo "     (Full Observability Enabled)"
    else
        echo "🚀 Atlas Platform Integration Test Stack is READY"
    fi
    echo "═══════════════════════════════════════════════════════════"
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
