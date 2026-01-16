#!/bin/bash
# Quick log inspection helper for Atlas Platform containers
#
# Usage:
#   ./scripts/logs.sh                    - Follow all itest container logs
#   ./scripts/logs.sh ingress            - Follow ingress logs only
#   ./scripts/logs.sh workers            - Follow workers logs only
#   ./scripts/logs.sh postgres           - Follow postgres logs only
#   ./scripts/logs.sh control-plane      - Follow control-plane logs only
#   ./scripts/logs.sh ingress workers    - Follow multiple services
#   ./scripts/logs.sh --tail 100 ingress - Show last 100 lines then follow

set -e

CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"

# Color output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

show_help() {
    echo "Atlas Platform Log Inspector"
    echo ""
    echo "Usage: $0 [OPTIONS] [SERVICE...]"
    echo ""
    echo "Services:"
    echo "  ingress         - Ingress API gateway logs"
    echo "  workers         - Background workers logs"
    echo "  postgres        - Database logs"
    echo "  control-plane   - Control plane API logs"
    echo "  dozzle          - Log viewer UI logs"
    echo "  (no service)    - All itest containers"
    echo ""
    echo "Options:"
    echo "  --tail N        - Show last N lines before following (default: 50)"
    echo "  --no-follow     - Don't follow logs, just dump and exit"
    echo "  -h, --help      - Show this help"
    echo ""
    echo "Examples:"
    echo "  $0                           # All logs"
    echo "  $0 ingress                   # Just ingress"
    echo "  $0 ingress workers           # Ingress + workers"
    echo "  $0 --tail 200 postgres       # Last 200 postgres lines"
    echo "  $0 --no-follow ingress       # Dump ingress logs and exit"
    echo ""
    echo "Tip: Use Dozzle web UI for richer log viewing:"
    echo "     http://localhost:8080"
}

# Parse arguments
TAIL_LINES=50
FOLLOW=true
SERVICES=()

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        --tail)
            TAIL_LINES="$2"
            shift 2
            ;;
        --no-follow)
            FOLLOW=false
            shift
            ;;
        *)
            SERVICES+=("$1")
            shift
            ;;
    esac
done

# Map service names to container names
map_to_container() {
    case "$1" in
        ingress)
            echo "atlas-itest-ingress"
            ;;
        workers)
            echo "atlas-itest-workers"
            ;;
        postgres|db)
            echo "atlas-itest-db"
            ;;
        control-plane|cp)
            echo "atlas-itest-control-plane"
            ;;
        dozzle)
            echo "atlas-itest-dozzle"
            ;;
        *)
            echo "$1"
            ;;
    esac
}

# Build container filter
if [ ${#SERVICES[@]} -eq 0 ]; then
    # No services specified - show all atlas-itest containers
    echo -e "${BLUE}→${NC} Following all Atlas Platform integration test containers..."
    FILTER="--filter name=atlas-itest-"
else
    # Map services to container names
    CONTAINERS=()
    for service in "${SERVICES[@]}"; do
        CONTAINERS+=("$(map_to_container "$service")")
    done

    echo -e "${BLUE}→${NC} Following: ${CONTAINERS[*]}"
    FILTER=""
fi

# Build docker logs command
LOGS_CMD="$CONTAINER_RUNTIME logs"

if [ "$FOLLOW" = true ]; then
    LOGS_CMD="$LOGS_CMD -f"
fi

LOGS_CMD="$LOGS_CMD --tail $TAIL_LINES"

# Execute
if [ -n "$FILTER" ]; then
    # Get all matching containers
    MATCHING=$($CONTAINER_RUNTIME ps --format "{{.Names}}" $FILTER)

    if [ -z "$MATCHING" ]; then
        echo "No running containers found matching: $FILTER"
        exit 1
    fi

    # Follow logs for all matching containers
    echo -e "${GREEN}✓${NC} Found containers:"
    echo "$MATCHING" | sed 's/^/  - /'
    echo ""

    # Use docker compose logs if available for better formatting
    if command -v docker-compose &> /dev/null || command -v docker &> /dev/null; then
        cd "$(dirname "$0")/../infra/compose"
        if [ -f docker-compose.itest.yml ]; then
            exec $CONTAINER_RUNTIME compose -f docker-compose.itest.yml logs $([[ "$FOLLOW" = true ]] && echo "-f") --tail "$TAIL_LINES"
        fi
    fi

    # Fallback: use docker logs on each container
    for container in $MATCHING; do
        $LOGS_CMD "$container" &
    done
    wait
else
    # Follow specific containers
    for container in "${CONTAINERS[@]}"; do
        # Check if container exists
        if ! $CONTAINER_RUNTIME ps --format "{{.Names}}" | grep -q "^${container}$"; then
            echo "Warning: Container '$container' not found or not running"
            continue
        fi

        if [ ${#CONTAINERS[@]} -eq 1 ]; then
            # Single container - just follow it directly
            exec $LOGS_CMD "$container"
        else
            # Multiple containers - background them
            $LOGS_CMD "$container" &
        fi
    done

    if [ ${#CONTAINERS[@]} -gt 1 ]; then
        wait
    fi
fi
