#!/usr/bin/env bash
# Database Lifecycle Management Script
# Manages the Control Plane Postgres database container with health checks

set -e

# Configuration
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-podman}"
CONTAINER_NAME="atlas-platform-control-plane-db"
COMPOSE_DIR="infra/compose"
COMPOSE_FILE="compose.control-plane.yml"
MAX_WAIT_ATTEMPTS=30
WAIT_INTERVAL=1

# Database connection settings
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5433}"
DB_USER="${DB_USER:-atlas_platform}"
DB_NAME="${DB_NAME:-control_plane}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
info() {
    echo -e "${GREEN}ℹ${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check if container is running
is_running() {
    if $CONTAINER_RUNTIME ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
        return 0
    else
        return 1
    fi
}

# Check if postgres is ready to accept connections
is_healthy() {
    if $CONTAINER_RUNTIME exec "$CONTAINER_NAME" pg_isready -h localhost -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Wait for database to be ready
wait_for_db() {
    info "Waiting for Postgres to accept connections..."
    local attempt=1

    while [ $attempt -le $MAX_WAIT_ATTEMPTS ]; do
        if is_healthy; then
            success "Postgres is ready (attempt $attempt/$MAX_WAIT_ATTEMPTS)"
            return 0
        fi

        echo "  Waiting for Postgres... (attempt $attempt/$MAX_WAIT_ATTEMPTS)"
        sleep $WAIT_INTERVAL
        attempt=$((attempt + 1))
    done

    error "Postgres failed to become ready after $MAX_WAIT_ATTEMPTS attempts"
    return 1
}

# Start the database
start() {
    info "Starting Postgres container using $CONTAINER_RUNTIME..."

    if is_running; then
        warn "Container is already running"
        if is_healthy; then
            success "Database is healthy and ready"
            return 0
        else
            warn "Container is running but database is not healthy"
            wait_for_db
            return $?
        fi
    fi

    cd "$COMPOSE_DIR"
    ${CONTAINER_RUNTIME}-compose -f "$COMPOSE_FILE" up -d
    cd - > /dev/null

    wait_for_db
}

# Stop the database
stop() {
    info "Stopping Postgres container..."

    if ! is_running; then
        warn "Container is not running"
        return 0
    fi

    cd "$COMPOSE_DIR"
    ${CONTAINER_RUNTIME}-compose -f "$COMPOSE_FILE" down
    cd - > /dev/null

    success "Container stopped"
}

# Show status
status() {
    echo "=== Database Container Status ==="
    echo "Container runtime: $CONTAINER_RUNTIME"
    echo "Container name: $CONTAINER_NAME"
    echo ""

    if is_running; then
        success "Container is running"
        echo ""
        $CONTAINER_RUNTIME ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        echo ""

        if is_healthy; then
            success "Database is healthy and accepting connections"
        else
            warn "Database is not yet ready to accept connections"
        fi
    else
        error "Container is not running"
        return 1
    fi
}

# Show logs
logs() {
    if ! is_running; then
        error "Container is not running"
        return 1
    fi

    info "Showing logs for $CONTAINER_NAME..."
    $CONTAINER_RUNTIME logs "$@" "$CONTAINER_NAME"
}

# Restart the database
restart() {
    info "Restarting database..."
    stop
    sleep 2
    start
}

# Show usage
usage() {
    cat << EOF
Database Lifecycle Management

Usage: $0 <command> [options]

Commands:
    start       Start the database container and wait for readiness
    stop        Stop the database container
    restart     Restart the database container
    status      Show container status and health
    wait        Wait for database to be ready (use after manual start)
    logs        Show container logs (pass -f to follow)

Environment Variables:
    CONTAINER_RUNTIME    Container runtime to use (default: podman)
    DB_HOST             Database host (default: localhost)
    DB_PORT             Database port (default: 5433)
    DB_USER             Database user (default: rusty_cms)
    DB_NAME             Database name (default: control_plane)

Examples:
    $0 start                    # Start database with podman
    $0 status                   # Check status
    $0 logs -f                  # Follow logs
    CONTAINER_RUNTIME=docker $0 start  # Use docker instead

EOF
}

# Main command handler
case "${1:-}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    wait)
        wait_for_db
        ;;
    logs)
        shift
        logs "$@"
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        error "Unknown command: ${1:-}"
        echo ""
        usage
        exit 1
        ;;
esac
