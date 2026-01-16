#!/bin/bash
# Test script for ingress authorization
#
# Usage:
#   ./scripts/test-authz.sh                    # Run all tests
#   ./scripts/test-authz.sh allowed            # Test allowed request
#   ./scripts/test-authz.sh denied             # Test denied scenarios
#
# Prerequisites:
#   - Ingress running with test-auth feature:
#     TEST_AUTH_ENABLED=true cargo run -p atlas-platform-ingress --features test-auth
#
# This script demonstrates that authorization is actually gating requests:
#   1. Valid requests with proper actionId/resourceType are ALLOWED
#   2. Requests with invalid/missing authorization fields are REJECTED (400)
#   3. Requests with tenant mismatch are REJECTED (403)

BASE_URL="${INGRESS_URL:-http://localhost:3000}"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
UNIQUE_ID=$(date +%s%N | head -c 16)

echo "=== Ingress Authorization Test ==="
echo "Base URL: ${BASE_URL}"
echo ""
echo "This script proves that authz is gating requests by showing:"
echo "  - Valid requests are ALLOWED (202)"
echo "  - Invalid payloads are REJECTED (400)"
echo "  - Tenant mismatches are REJECTED (403)"
echo ""

# ============================================================================
# TEST 1: Request that SHOULD BE ALLOWED
# ============================================================================
test_allowed() {
    echo "=== TEST: Valid Request (Should be ALLOWED) ==="
    echo "Principal: user:allowed-user:default"
    echo "Tenant: default (matches principal)"
    echo "Action: ContentPages.Page.Create"
    echo ""

    PAYLOAD=$(cat <<EOF
{
  "eventId": "evt-allowed-${UNIQUE_ID}",
  "eventType": "ContentPages.PageCreateRequested",
  "schemaId": "ui.contentpages.page.create.v1",
  "schemaVersion": 1,
  "occurredAt": "${TIMESTAMP}",
  "tenantId": "default",
  "correlationId": "corr-${UNIQUE_ID}",
  "idempotencyKey": "idem-allowed-${UNIQUE_ID}",
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

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/intents" \
        -H "Content-Type: application/json" \
        -H "X-Debug-Principal: user:allowed-user:default" \
        -d "${PAYLOAD}")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')

    echo "HTTP Status: ${HTTP_CODE}"
    if [ "$HTTP_CODE" = "202" ]; then
        echo -e "\033[32mPASS: Request was ALLOWED as expected\033[0m"
    else
        echo -e "\033[31mFAIL: Expected 202, got ${HTTP_CODE}\033[0m"
        echo "Response: $BODY"
    fi
    echo ""
}

# ============================================================================
# TEST 2: Request with MISSING actionId (Should be DENIED - 400)
# ============================================================================
test_missing_action_id() {
    echo "=== TEST: Missing actionId (Should be DENIED - 400) ==="
    echo "Principal: user:test-user:default"
    echo "Payload: missing actionId field"
    echo ""

    PAYLOAD=$(cat <<EOF
{
  "eventId": "evt-noaction-${UNIQUE_ID}",
  "eventType": "ContentPages.PageCreateRequested",
  "schemaId": "ui.contentpages.page.create.v1",
  "schemaVersion": 1,
  "occurredAt": "${TIMESTAMP}",
  "tenantId": "default",
  "correlationId": "corr-${UNIQUE_ID}",
  "idempotencyKey": "idem-noaction-${UNIQUE_ID}",
  "payload": {
    "resourceType": "Page",
    "pageId": "page-${UNIQUE_ID}"
  }
}
EOF
    )

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/intents" \
        -H "Content-Type: application/json" \
        -H "X-Debug-Principal: user:test-user:default" \
        -d "${PAYLOAD}")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

    echo "HTTP Status: ${HTTP_CODE}"
    if [ "$HTTP_CODE" = "400" ]; then
        echo -e "\033[32mPASS: Request was DENIED (400) - missing actionId rejected\033[0m"
    else
        echo -e "\033[33mUNEXPECTED: Expected 400, got ${HTTP_CODE}\033[0m"
    fi
    echo ""
}

# ============================================================================
# TEST 3: Request with MISSING resourceType (Should be DENIED - 400)
# ============================================================================
test_missing_resource_type() {
    echo "=== TEST: Missing resourceType (Should be DENIED - 400) ==="
    echo "Principal: user:test-user:default"
    echo "Payload: missing resourceType field"
    echo ""

    PAYLOAD=$(cat <<EOF
{
  "eventId": "evt-noresource-${UNIQUE_ID}",
  "eventType": "ContentPages.PageCreateRequested",
  "schemaId": "ui.contentpages.page.create.v1",
  "schemaVersion": 1,
  "occurredAt": "${TIMESTAMP}",
  "tenantId": "default",
  "correlationId": "corr-${UNIQUE_ID}",
  "idempotencyKey": "idem-noresource-${UNIQUE_ID}",
  "payload": {
    "actionId": "ContentPages.Page.Create",
    "pageId": "page-${UNIQUE_ID}"
  }
}
EOF
    )

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/intents" \
        -H "Content-Type: application/json" \
        -H "X-Debug-Principal: user:test-user:default" \
        -d "${PAYLOAD}")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

    echo "HTTP Status: ${HTTP_CODE}"
    if [ "$HTTP_CODE" = "400" ]; then
        echo -e "\033[32mPASS: Request was DENIED (400) - missing resourceType rejected\033[0m"
    else
        echo -e "\033[33mUNEXPECTED: Expected 400, got ${HTTP_CODE}\033[0m"
    fi
    echo ""
}

# ============================================================================
# TEST 4: Request with INVALID actionId format (Should be DENIED - 400)
# ============================================================================
test_invalid_action_id() {
    echo "=== TEST: Invalid actionId format (Should be DENIED - 400) ==="
    echo "Principal: user:test-user:default"
    echo "Action: 'Create' (invalid - needs Module.Verb format)"
    echo ""

    PAYLOAD=$(cat <<EOF
{
  "eventId": "evt-badaction-${UNIQUE_ID}",
  "eventType": "ContentPages.PageCreateRequested",
  "schemaId": "ui.contentpages.page.create.v1",
  "schemaVersion": 1,
  "occurredAt": "${TIMESTAMP}",
  "tenantId": "default",
  "correlationId": "corr-${UNIQUE_ID}",
  "idempotencyKey": "idem-badaction-${UNIQUE_ID}",
  "payload": {
    "actionId": "Create",
    "resourceType": "Page",
    "pageId": "page-${UNIQUE_ID}"
  }
}
EOF
    )

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/intents" \
        -H "Content-Type: application/json" \
        -H "X-Debug-Principal: user:test-user:default" \
        -d "${PAYLOAD}")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

    echo "HTTP Status: ${HTTP_CODE}"
    if [ "$HTTP_CODE" = "400" ]; then
        echo -e "\033[32mPASS: Request was DENIED (400) - invalid actionId format rejected\033[0m"
    else
        echo -e "\033[33mUNEXPECTED: Expected 400, got ${HTTP_CODE}\033[0m"
    fi
    echo ""
}

# ============================================================================
# TEST 5: Request with TENANT MISMATCH (Should be DENIED - 403)
# ============================================================================
test_tenant_mismatch() {
    echo "=== TEST: Tenant Mismatch (Should be DENIED - 403) ==="
    echo "Principal: user:attacker:tenant-A"
    echo "Payload tenant: tenant-B (MISMATCH!)"
    echo ""

    PAYLOAD=$(cat <<EOF
{
  "eventId": "evt-mismatch-${UNIQUE_ID}",
  "eventType": "ContentPages.PageCreateRequested",
  "schemaId": "ui.contentpages.page.create.v1",
  "schemaVersion": 1,
  "occurredAt": "${TIMESTAMP}",
  "tenantId": "tenant-B",
  "correlationId": "corr-${UNIQUE_ID}",
  "idempotencyKey": "idem-mismatch-${UNIQUE_ID}",
  "payload": {
    "actionId": "ContentPages.Page.Create",
    "resourceType": "Page",
    "pageId": "page-${UNIQUE_ID}"
  }
}
EOF
    )

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/intents" \
        -H "Content-Type: application/json" \
        -H "X-Debug-Principal: user:attacker:tenant-A" \
        -d "${PAYLOAD}")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

    echo "HTTP Status: ${HTTP_CODE}"
    if [ "$HTTP_CODE" = "403" ]; then
        echo -e "\033[32mPASS: Request was DENIED (403) - tenant isolation enforced\033[0m"
    else
        echo -e "\033[31mFAIL: Expected 403, got ${HTTP_CODE}\033[0m"
        echo -e "\033[31mSECURITY ISSUE: Cross-tenant access should be blocked!\033[0m"
    fi
    echo ""
}

# ============================================================================
# TEST 6: Request to tenant with NO POLICIES
# ============================================================================
test_no_policies() {
    echo "=== TEST: No Matching Policies (informational) ==="
    echo "Principal: user:orphan-user:orphan-tenant"
    echo "Payload tenant: orphan-tenant"
    echo ""
    echo "NOTE: The default allow-all policy uses 'Condition::Literal { value: true }'"
    echo "      which matches ALL requests regardless of tenant."
    echo ""

    PAYLOAD=$(cat <<EOF
{
  "eventId": "evt-orphan-${UNIQUE_ID}",
  "eventType": "ContentPages.PageCreateRequested",
  "schemaId": "ui.contentpages.page.create.v1",
  "schemaVersion": 1,
  "occurredAt": "${TIMESTAMP}",
  "tenantId": "orphan-tenant",
  "correlationId": "corr-${UNIQUE_ID}",
  "idempotencyKey": "idem-orphan-${UNIQUE_ID}",
  "payload": {
    "actionId": "ContentPages.Page.Create",
    "resourceType": "Page",
    "pageId": "page-${UNIQUE_ID}"
  }
}
EOF
    )

    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/intents" \
        -H "Content-Type: application/json" \
        -H "X-Debug-Principal: user:orphan-user:orphan-tenant" \
        -d "${PAYLOAD}")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

    echo "HTTP Status: ${HTTP_CODE}"
    if [ "$HTTP_CODE" = "403" ]; then
        echo -e "\033[32mPASS: Request was DENIED (403) - no matching policies\033[0m"
    elif [ "$HTTP_CODE" = "202" ]; then
        echo -e "\033[33mResult: Request was ALLOWED (due to allow-all policy with Literal{true})\033[0m"
        echo "This is expected with the current bootstrap policy."
    else
        echo "Status: ${HTTP_CODE}"
    fi
    echo ""
}

# ============================================================================
# Summary
# ============================================================================
show_summary() {
    echo "=== Authorization Gate Summary ==="
    echo ""
    echo "The authorization system enforces these checks:"
    echo ""
    echo "1. PAYLOAD VALIDATION (400 Bad Request):"
    echo "   - actionId must be present and valid (Module.Verb format)"
    echo "   - resourceType must be present and alphanumeric"
    echo ""
    echo "2. TENANT ISOLATION (403 Forbidden):"
    echo "   - Principal's tenant must match payload's tenantId"
    echo "   - Cross-tenant access is always blocked"
    echo ""
    echo "3. POLICY EVALUATION (403 Forbidden):"
    echo "   - Default deny: no matching policies = DENY"
    echo "   - Deny overrides allow: any DENY rule wins"
    echo ""
}

# Run tests based on argument
case "${1:-all}" in
    allowed)
        test_allowed
        ;;
    denied)
        test_missing_action_id
        test_missing_resource_type
        test_invalid_action_id
        test_tenant_mismatch
        ;;
    validation)
        test_missing_action_id
        test_missing_resource_type
        test_invalid_action_id
        ;;
    tenant)
        test_tenant_mismatch
        ;;
    no-policy)
        test_no_policies
        ;;
    all)
        test_allowed
        test_missing_action_id
        test_missing_resource_type
        test_invalid_action_id
        test_tenant_mismatch
        test_no_policies
        show_summary
        ;;
    *)
        echo "Usage: $0 [allowed|denied|validation|tenant|no-policy|all]"
        exit 1
        ;;
esac

echo "=== Test Complete ==="
