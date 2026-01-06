#!/bin/bash
# Shared healthcheck utility script for Atlas Platform services

set -e

# Parse command-line arguments
URL="${1:-http://localhost:3000/}"
MAX_RETRIES="${2:-30}"
RETRY_INTERVAL="${3:-1}"

echo "Checking health of $URL (max retries: $MAX_RETRIES, interval: ${RETRY_INTERVAL}s)"

for i in $(seq 1 $MAX_RETRIES); do
    if curl -f -s "$URL" > /dev/null 2>&1; then
        echo "✓ Service is healthy at $URL"
        exit 0
    fi

    echo "Attempt $i/$MAX_RETRIES: Service not ready yet..."
    sleep $RETRY_INTERVAL
done

echo "✗ Service failed to become healthy after $MAX_RETRIES attempts"
exit 1
