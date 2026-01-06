#!/bin/bash
# Wait for Docker/Podman container to report healthy status

set -e

CONTAINER_NAME="${1}"
MAX_WAIT="${2:-60}"
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-docker}"

if [ -z "$CONTAINER_NAME" ]; then
    echo "Usage: $0 <container_name> [max_wait_seconds]"
    exit 1
fi

echo "Waiting for container '$CONTAINER_NAME' to become healthy (max ${MAX_WAIT}s)..."

START_TIME=$(date +%s)

while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))

    if [ $ELAPSED -gt $MAX_WAIT ]; then
        echo "✗ Timeout: Container did not become healthy after ${MAX_WAIT}s"
        $CONTAINER_RUNTIME logs "$CONTAINER_NAME" --tail 50
        exit 1
    fi

    HEALTH_STATUS=$($CONTAINER_RUNTIME inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "unknown")

    case "$HEALTH_STATUS" in
        "healthy")
            echo "✓ Container '$CONTAINER_NAME' is healthy"
            exit 0
            ;;
        "unhealthy")
            echo "✗ Container '$CONTAINER_NAME' is unhealthy"
            $CONTAINER_RUNTIME logs "$CONTAINER_NAME" --tail 50
            exit 1
            ;;
        "starting"|"unknown")
            echo "  Still waiting... (${ELAPSED}s elapsed, status: $HEALTH_STATUS)"
            sleep 2
            ;;
        *)
            echo "  Unexpected health status: $HEALTH_STATUS"
            sleep 2
            ;;
    esac
done
