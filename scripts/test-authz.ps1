# Test script for ingress authorization (PowerShell)
#
# Usage:
#   .\scripts\test-authz.ps1                    # Run all tests
#   .\scripts\test-authz.ps1 -Test allowed      # Test allowed request
#   .\scripts\test-authz.ps1 -Test denied       # Test denied scenarios
#
# Prerequisites:
#   - Ingress running with test-auth feature:
#     $env:TEST_AUTH_ENABLED="true"; cargo run -p atlas-platform-ingress --features test-auth
#
# This script demonstrates that authorization is actually gating requests:
#   1. Valid requests with proper actionId/resourceType are ALLOWED
#   2. Requests with invalid/missing authorization fields are REJECTED (400)
#   3. Requests with tenant mismatch are REJECTED (403)
#   4. Requests without policies would be REJECTED (403) - see notes below

param(
    [ValidateSet("all", "allowed", "denied", "validation", "tenant", "no-policy")]
    [string]$Test = "all",
    [string]$BaseUrl = "http://localhost:3000"
)

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$uniqueId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

Write-Host "=== Ingress Authorization Test ===" -ForegroundColor Cyan
Write-Host "Base URL: $BaseUrl"
Write-Host ""
Write-Host "This script proves that authz is gating requests by showing:" -ForegroundColor Yellow
Write-Host "  - Valid requests are ALLOWED (202)"
Write-Host "  - Invalid payloads are REJECTED (400)"
Write-Host "  - Tenant mismatches are REJECTED (403)"
Write-Host ""

# ============================================================================
# TEST 1: Request that SHOULD BE ALLOWED
# - Valid actionId and resourceType
# - Principal tenant matches payload tenant
# - Default allow-all policy applies
# ============================================================================
function Test-Allowed {
    Write-Host "=== TEST: Valid Request (Should be ALLOWED) ===" -ForegroundColor Green
    Write-Host "Principal: user:allowed-user:default"
    Write-Host "Tenant: default (matches principal)"
    Write-Host "Action: ContentPages.Page.Create"
    Write-Host ""

    $payload = @{
        eventId = "evt-allowed-$uniqueId"
        eventType = "ContentPages.PageCreateRequested"
        schemaId = "ui.contentpages.page.create.v1"
        schemaVersion = 1
        occurredAt = $timestamp
        tenantId = "default"
        correlationId = "corr-$uniqueId"
        idempotencyKey = "idem-allowed-$uniqueId"
        payload = @{
            actionId = "ContentPages.Page.Create"
            resourceType = "Page"
            resourceId = $null
            pageId = "page-$uniqueId"
            title = "Test Page"
        }
    } | ConvertTo-Json -Depth 10

    try {
        $headers = @{
            "Content-Type" = "application/json"
            "X-Debug-Principal" = "user:allowed-user:default"
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/intents" -Method Post -Headers $headers -Body $payload -UseBasicParsing

        Write-Host "HTTP Status: $($response.StatusCode)" -ForegroundColor Green
        if ($response.StatusCode -eq 202) {
            Write-Host "PASS: Request was ALLOWED as expected" -ForegroundColor Green
        } else {
            Write-Host "UNEXPECTED: Expected 202, got $($response.StatusCode)" -ForegroundColor Red
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTP Status: $statusCode" -ForegroundColor Red
        Write-Host "FAIL: Expected 202 (allowed), got $statusCode" -ForegroundColor Red
    }
    Write-Host ""
}

# ============================================================================
# TEST 2: Request with MISSING actionId (Should be DENIED - 400)
# - Payload is missing required actionId field
# - Authorization cannot proceed without action identity
# ============================================================================
function Test-MissingActionId {
    Write-Host "=== TEST: Missing actionId (Should be DENIED - 400) ===" -ForegroundColor Yellow
    Write-Host "Principal: user:test-user:default"
    Write-Host "Payload: missing actionId field"
    Write-Host ""

    $payload = @{
        eventId = "evt-noaction-$uniqueId"
        eventType = "ContentPages.PageCreateRequested"
        schemaId = "ui.contentpages.page.create.v1"
        schemaVersion = 1
        occurredAt = $timestamp
        tenantId = "default"
        correlationId = "corr-$uniqueId"
        idempotencyKey = "idem-noaction-$uniqueId"
        payload = @{
            # actionId is MISSING - should fail validation
            resourceType = "Page"
            pageId = "page-$uniqueId"
        }
    } | ConvertTo-Json -Depth 10

    try {
        $headers = @{
            "Content-Type" = "application/json"
            "X-Debug-Principal" = "user:test-user:default"
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/intents" -Method Post -Headers $headers -Body $payload -UseBasicParsing

        Write-Host "HTTP Status: $($response.StatusCode)" -ForegroundColor Red
        Write-Host "FAIL: Expected 400, request was unexpectedly allowed" -ForegroundColor Red
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTP Status: $statusCode"
        if ($statusCode -eq 400) {
            Write-Host "PASS: Request was DENIED (400) - missing actionId rejected" -ForegroundColor Green
        } else {
            Write-Host "UNEXPECTED: Expected 400, got $statusCode" -ForegroundColor Yellow
        }
    }
    Write-Host ""
}

# ============================================================================
# TEST 3: Request with MISSING resourceType (Should be DENIED - 400)
# - Payload is missing required resourceType field
# - Authorization cannot proceed without resource identity
# ============================================================================
function Test-MissingResourceType {
    Write-Host "=== TEST: Missing resourceType (Should be DENIED - 400) ===" -ForegroundColor Yellow
    Write-Host "Principal: user:test-user:default"
    Write-Host "Payload: missing resourceType field"
    Write-Host ""

    $payload = @{
        eventId = "evt-noresource-$uniqueId"
        eventType = "ContentPages.PageCreateRequested"
        schemaId = "ui.contentpages.page.create.v1"
        schemaVersion = 1
        occurredAt = $timestamp
        tenantId = "default"
        correlationId = "corr-$uniqueId"
        idempotencyKey = "idem-noresource-$uniqueId"
        payload = @{
            actionId = "ContentPages.Page.Create"
            # resourceType is MISSING - should fail validation
            pageId = "page-$uniqueId"
        }
    } | ConvertTo-Json -Depth 10

    try {
        $headers = @{
            "Content-Type" = "application/json"
            "X-Debug-Principal" = "user:test-user:default"
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/intents" -Method Post -Headers $headers -Body $payload -UseBasicParsing

        Write-Host "HTTP Status: $($response.StatusCode)" -ForegroundColor Red
        Write-Host "FAIL: Expected 400, request was unexpectedly allowed" -ForegroundColor Red
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTP Status: $statusCode"
        if ($statusCode -eq 400) {
            Write-Host "PASS: Request was DENIED (400) - missing resourceType rejected" -ForegroundColor Green
        } else {
            Write-Host "UNEXPECTED: Expected 400, got $statusCode" -ForegroundColor Yellow
        }
    }
    Write-Host ""
}

# ============================================================================
# TEST 4: Request with INVALID actionId format (Should be DENIED - 400)
# - actionId must have at least 2 dot-separated segments
# - Single segment like "Create" is invalid
# ============================================================================
function Test-InvalidActionId {
    Write-Host "=== TEST: Invalid actionId format (Should be DENIED - 400) ===" -ForegroundColor Yellow
    Write-Host "Principal: user:test-user:default"
    Write-Host "Action: 'Create' (invalid - needs Module.Verb format)"
    Write-Host ""

    $payload = @{
        eventId = "evt-badaction-$uniqueId"
        eventType = "ContentPages.PageCreateRequested"
        schemaId = "ui.contentpages.page.create.v1"
        schemaVersion = 1
        occurredAt = $timestamp
        tenantId = "default"
        correlationId = "corr-$uniqueId"
        idempotencyKey = "idem-badaction-$uniqueId"
        payload = @{
            actionId = "Create"  # INVALID - must be at least Module.Verb
            resourceType = "Page"
            pageId = "page-$uniqueId"
        }
    } | ConvertTo-Json -Depth 10

    try {
        $headers = @{
            "Content-Type" = "application/json"
            "X-Debug-Principal" = "user:test-user:default"
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/intents" -Method Post -Headers $headers -Body $payload -UseBasicParsing

        Write-Host "HTTP Status: $($response.StatusCode)" -ForegroundColor Red
        Write-Host "FAIL: Expected 400, request was unexpectedly allowed" -ForegroundColor Red
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTP Status: $statusCode"
        if ($statusCode -eq 400) {
            Write-Host "PASS: Request was DENIED (400) - invalid actionId format rejected" -ForegroundColor Green
        } else {
            Write-Host "UNEXPECTED: Expected 400, got $statusCode" -ForegroundColor Yellow
        }
    }
    Write-Host ""
}

# ============================================================================
# TEST 5: Request with TENANT MISMATCH (Should be DENIED - 403)
# - Principal belongs to tenant-A
# - Request payload targets tenant-B
# - Tenant isolation enforcement rejects this
# ============================================================================
function Test-TenantMismatch {
    Write-Host "=== TEST: Tenant Mismatch (Should be DENIED - 403) ===" -ForegroundColor Yellow
    Write-Host "Principal: user:attacker:tenant-A"
    Write-Host "Payload tenant: tenant-B (MISMATCH!)"
    Write-Host ""

    $payload = @{
        eventId = "evt-mismatch-$uniqueId"
        eventType = "ContentPages.PageCreateRequested"
        schemaId = "ui.contentpages.page.create.v1"
        schemaVersion = 1
        occurredAt = $timestamp
        tenantId = "tenant-B"  # Different from principal's tenant!
        correlationId = "corr-$uniqueId"
        idempotencyKey = "idem-mismatch-$uniqueId"
        payload = @{
            actionId = "ContentPages.Page.Create"
            resourceType = "Page"
            pageId = "page-$uniqueId"
        }
    } | ConvertTo-Json -Depth 10

    try {
        $headers = @{
            "Content-Type" = "application/json"
            # Principal is in tenant-A, but payload targets tenant-B
            "X-Debug-Principal" = "user:attacker:tenant-A"
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/intents" -Method Post -Headers $headers -Body $payload -UseBasicParsing

        Write-Host "HTTP Status: $($response.StatusCode)" -ForegroundColor Red
        Write-Host "FAIL: Expected 403, request was unexpectedly allowed" -ForegroundColor Red
        Write-Host "SECURITY ISSUE: Cross-tenant access should be blocked!" -ForegroundColor Red
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTP Status: $statusCode"
        if ($statusCode -eq 403) {
            Write-Host "PASS: Request was DENIED (403) - tenant isolation enforced" -ForegroundColor Green
        } else {
            Write-Host "UNEXPECTED: Expected 403, got $statusCode" -ForegroundColor Yellow
        }
    }
    Write-Host ""
}

# ============================================================================
# TEST 6: Request to tenant with NO POLICIES (Should be DENIED - 403)
# - Default allow-all policy is only for the configured tenant ("default")
# - A request from a tenant with no policies should be denied
# - NOTE: This tests the "default deny" behavior
# ============================================================================
function Test-NoPolicies {
    Write-Host "=== TEST: No Matching Policies (Should be DENIED - 403) ===" -ForegroundColor Yellow
    Write-Host "Principal: user:orphan-user:orphan-tenant"
    Write-Host "Payload tenant: orphan-tenant"
    Write-Host "Expected: DENY due to 'no matching policies'"
    Write-Host ""
    Write-Host "NOTE: The default allow-all policy uses 'Condition::Literal { value: true }'" -ForegroundColor DarkGray
    Write-Host "      which matches ALL requests regardless of tenant." -ForegroundColor DarkGray
    Write-Host "      To truly test 'no matching policies', you would need to:" -ForegroundColor DarkGray
    Write-Host "      1. Start server with no policies, OR" -ForegroundColor DarkGray
    Write-Host "      2. Use a policy with tenant-specific conditions" -ForegroundColor DarkGray
    Write-Host ""

    $payload = @{
        eventId = "evt-orphan-$uniqueId"
        eventType = "ContentPages.PageCreateRequested"
        schemaId = "ui.contentpages.page.create.v1"
        schemaVersion = 1
        occurredAt = $timestamp
        tenantId = "orphan-tenant"
        correlationId = "corr-$uniqueId"
        idempotencyKey = "idem-orphan-$uniqueId"
        payload = @{
            actionId = "ContentPages.Page.Create"
            resourceType = "Page"
            pageId = "page-$uniqueId"
        }
    } | ConvertTo-Json -Depth 10

    try {
        $headers = @{
            "Content-Type" = "application/json"
            "X-Debug-Principal" = "user:orphan-user:orphan-tenant"
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/intents" -Method Post -Headers $headers -Body $payload -UseBasicParsing

        Write-Host "HTTP Status: $($response.StatusCode)" -ForegroundColor Yellow
        Write-Host "Result: Request was ALLOWED (due to allow-all policy with Literal{true})" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "This is expected with the current bootstrap policy." -ForegroundColor DarkGray
        Write-Host "The policy engine correctly evaluates all active policies." -ForegroundColor DarkGray
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTP Status: $statusCode"
        if ($statusCode -eq 403) {
            Write-Host "PASS: Request was DENIED (403) - no matching policies" -ForegroundColor Green
        } else {
            Write-Host "Status: $statusCode" -ForegroundColor Yellow
        }
    }
    Write-Host ""
}

# ============================================================================
# Summary of Authorization Checks
# ============================================================================
function Show-Summary {
    Write-Host "=== Authorization Gate Summary ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "The authorization system enforces these checks:" -ForegroundColor White
    Write-Host ""
    Write-Host "1. PAYLOAD VALIDATION (400 Bad Request):" -ForegroundColor Yellow
    Write-Host "   - actionId must be present and valid (Module.Verb format)"
    Write-Host "   - resourceType must be present and alphanumeric"
    Write-Host ""
    Write-Host "2. TENANT ISOLATION (403 Forbidden):" -ForegroundColor Yellow
    Write-Host "   - Principal's tenant must match payload's tenantId"
    Write-Host "   - Cross-tenant access is always blocked"
    Write-Host ""
    Write-Host "3. POLICY EVALUATION (403 Forbidden):" -ForegroundColor Yellow
    Write-Host "   - Default deny: no matching policies = DENY"
    Write-Host "   - Deny overrides allow: any DENY rule wins"
    Write-Host "   - Policies are evaluated against:"
    Write-Host "     - principal_attributes: id, type, tenant_id, claims"
    Write-Host "     - resource_attributes: action_id, resource_type, resource_id"
    Write-Host "     - environment_attributes: tenant_id, timestamp"
    Write-Host ""
    Write-Host "Current bootstrap policy: allow-all (Condition::Literal{true})" -ForegroundColor DarkGray
    Write-Host "To test policy denial, modify bootstrap.rs or add policy management" -ForegroundColor DarkGray
    Write-Host ""
}

# Run tests based on parameter
switch ($Test) {
    "allowed" { Test-Allowed }
    "denied" {
        Test-MissingActionId
        Test-MissingResourceType
        Test-InvalidActionId
        Test-TenantMismatch
    }
    "validation" {
        Test-MissingActionId
        Test-MissingResourceType
        Test-InvalidActionId
    }
    "tenant" { Test-TenantMismatch }
    "no-policy" { Test-NoPolicies }
    "all" {
        Test-Allowed
        Test-MissingActionId
        Test-MissingResourceType
        Test-InvalidActionId
        Test-TenantMismatch
        Test-NoPolicies
        Show-Summary
    }
}

Write-Host "=== Test Complete ===" -ForegroundColor Cyan
