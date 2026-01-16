#!/bin/bash
# Test script for ingress authentication
#
# Usage:
#   ./scripts/test-authn.sh                    # Run all tests
#   ./scripts/test-authn.sh authenticated      # Test authenticated request
#   ./scripts/test-authn.sh unauthenticated    # Test unauthenticated request
#
# Prerequisites:
#   - Ingress running with test-auth feature:
#     TEST_AUTH_ENABLED=true cargo run -p atlas-platform-ingress --features test-auth

BASE_URL="${INGRESS_URL:-http://localhost:3000}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
UNIQUE_ID=$(date +%s%N | head -c 16)

# Valid EventEnvelope payload with actionId and resourceType for authorization
PAYLOAD=$(cat <<EOF
{
  "eventId": "evt-${UNIQUE_ID}",
  "eventType": "ContentPages.PageCreateRequested",
  "schemaId": "ui.contentpages.page.create.v1",
  "schemaVersion": 1,
  "occurredAt": "${TIMESTAMP}",
  "tenantId": "test-tenant",
  "correlationId": "corr-${UNIQUE_ID}",
  "idempotencyKey": "idem-${UNIQUE_ID}",
  "payload": {
    "actionId": "ContentPages.Page.Create",
    "resourceType": "Page",
    "resourceId": null,
    "pageId": "page-${UNIQUE_ID}",
    "title": "Test Page"
  }
}
EOF
)

echo "=== Ingress Authentication Test ==="
echo "Base URL: ${BASE_URL}"
echo ""

test_health() {
    echo "--- Health Check (no auth required) ---"
    curl -s "${BASE_URL}/" | jq .
    echo ""
}

test_authenticated() {
    echo "--- Authenticated Request (X-Debug-Principal header) ---"
    echo "Principal: user:test-user-123:test-tenant"
    echo ""

    # Include tenant in principal to match payload's tenantId
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/intents" \
        -H "Content-Type: application/json" \
        -H "X-Debug-Principal: user:test-user-123:test-tenant" \
        -d "${PAYLOAD}")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    echo "HTTP Status: ${HTTP_CODE}"
    echo "Response:"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
    echo ""

    if [ "$HTTP_CODE" = "202" ]; then
        echo "SUCCESS: Request authenticated and accepted"
    elif [ "$HTTP_CODE" = "401" ]; then
        echo "FAILED: Got 401 - Is TEST_AUTH_ENABLED=true set?"
    else
        echo "UNEXPECTED: Got HTTP ${HTTP_CODE}"
    fi
    echo ""
}

test_unauthenticated() {
    echo "--- Unauthenticated Request (no header) ---"
    echo ""

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/intents" \
        -H "Content-Type: application/json" \
        -d "${PAYLOAD}")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    echo "HTTP Status: ${HTTP_CODE}"
    echo "Response:"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
    echo ""

    if [ "$HTTP_CODE" = "401" ]; then
        echo "SUCCESS: Unauthenticated request correctly rejected"
    else
        echo "UNEXPECTED: Expected 401, got HTTP ${HTTP_CODE}"
    fi
    echo ""
}

test_service_principal() {
    echo "--- Service Principal (X-Debug-Principal: service:batch-worker:test-tenant) ---"
    echo ""

    # Include tenant to match payload's tenantId
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/intents" \
        -H "Content-Type: application/json" \
        -H "X-Debug-Principal: service:batch-worker:test-tenant" \
        -d "${PAYLOAD}")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    echo "HTTP Status: ${HTTP_CODE}"
    echo "Response:"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
    echo ""
}

test_custom_tenant() {
    echo "--- Custom Tenant (X-Debug-Principal: user:admin:custom-tenant) ---"
    echo ""

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/intents" \
        -H "Content-Type: application/json" \
        -H "X-Debug-Principal: user:admin:custom-tenant" \
        -d "${PAYLOAD}")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    echo "HTTP Status: ${HTTP_CODE}"
    echo "Response:"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
    echo ""
}

# Run tests based on argument
case "${1:-all}" in
    health)
        test_health
        ;;
    authenticated|auth)
        test_authenticated
        ;;
    unauthenticated|unauth)
        test_unauthenticated
        ;;
    service)
        test_service_principal
        ;;
    tenant)
        test_custom_tenant
        ;;
    all)
        test_health
        test_authenticated
        test_unauthenticated
        test_service_principal
        test_custom_tenant
        ;;
    *)
        echo "Usage: $0 [health|authenticated|unauthenticated|service|tenant|all]"
        exit 1
        ;;
esac
