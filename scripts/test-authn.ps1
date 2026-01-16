# Test script for ingress authentication (PowerShell)
#
# Usage:
#   .\scripts\test-authn.ps1                    # Run all tests
#   .\scripts\test-authn.ps1 -Test authenticated
#   .\scripts\test-authn.ps1 -Test unauthenticated
#
# Prerequisites:
#   - Ingress running with test-auth feature:
#     $env:TEST_AUTH_ENABLED="true"; cargo run -p atlas-platform-ingress --features test-auth

param(
    [ValidateSet("all", "health", "authenticated", "unauthenticated", "service", "tenant")]
    [string]$Test = "all",
    [string]$BaseUrl = "http://localhost:3000"
)

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$uniqueId = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

# Valid EventEnvelope payload with actionId and resourceType for authorization
$payload = @{
    eventId = "evt-$uniqueId"
    eventType = "ContentPages.PageCreateRequested"
    schemaId = "ui.contentpages.page.create.v1"
    schemaVersion = 1
    occurredAt = $timestamp
    tenantId = "custom-tenant"
    correlationId = "corr-$uniqueId"
    idempotencyKey = "idem-$uniqueId"
    payload = @{
        actionId = "ContentPages.Page.Create"
        resourceType = "Page"
        resourceId = $null
        pageId = "page-$uniqueId"
        title = "Test Page"
    }
} | ConvertTo-Json -Depth 10

Write-Host "=== Ingress Authentication Test ===" -ForegroundColor Cyan
Write-Host "Base URL: $BaseUrl"
Write-Host ""

function Test-Health {
    Write-Host "--- Health Check (no auth required) ---" -ForegroundColor Yellow
    try {
        $response = Invoke-RestMethod -Uri "$BaseUrl/" -Method Get
        $response | ConvertTo-Json -Depth 10
    } catch {
        Write-Host "Error: $_" -ForegroundColor Red
    }
    Write-Host ""
}

function Test-Authenticated {
    Write-Host "--- Authenticated Request (X-Debug-Principal header) ---" -ForegroundColor Yellow
    Write-Host "Principal: user:test-user-123:custom-tenant"
    Write-Host ""

    try {
        $headers = @{
            "Content-Type" = "application/json"
            # Include tenant in principal to match payload's tenantId
            "X-Debug-Principal" = "user:test-user-123:custom-tenant"
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/intents" -Method Post -Headers $headers -Body $payload -UseBasicParsing

        Write-Host "HTTP Status: $($response.StatusCode)" -ForegroundColor Green
        Write-Host "Response:"
        $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
        Write-Host ""
        Write-Host "SUCCESS: Request authenticated and accepted" -ForegroundColor Green
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTP Status: $statusCode" -ForegroundColor $(if ($statusCode -eq 401) { "Yellow" } else { "Red" })

        if ($statusCode -eq 401) {
            Write-Host "Got 401 - Is TEST_AUTH_ENABLED=true set?" -ForegroundColor Yellow
        } else {
            Write-Host "Error: $_" -ForegroundColor Red
        }
    }
    Write-Host ""
}

function Test-Unauthenticated {
    Write-Host "--- Unauthenticated Request (no header) ---" -ForegroundColor Yellow
    Write-Host ""

    try {
        $headers = @{
            "Content-Type" = "application/json"
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/intents" -Method Post -Headers $headers -Body $payload -UseBasicParsing

        Write-Host "HTTP Status: $($response.StatusCode)" -ForegroundColor Red
        Write-Host "UNEXPECTED: Expected 401, got $($response.StatusCode)" -ForegroundColor Red
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTP Status: $statusCode"

        if ($statusCode -eq 401) {
            Write-Host "SUCCESS: Unauthenticated request correctly rejected" -ForegroundColor Green
        } else {
            Write-Host "UNEXPECTED: Expected 401, got $statusCode" -ForegroundColor Red
        }
    }
    Write-Host ""
}

function Test-ServicePrincipal {
    Write-Host "--- Service Principal (X-Debug-Principal: service:batch-worker:custom-tenant) ---" -ForegroundColor Yellow
    Write-Host ""

    try {
        $headers = @{
            "Content-Type" = "application/json"
            # Include tenant to match payload's tenantId
            "X-Debug-Principal" = "service:batch-worker:custom-tenant"
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/intents" -Method Post -Headers $headers -Body $payload -UseBasicParsing

        Write-Host "HTTP Status: $($response.StatusCode)" -ForegroundColor Green
        Write-Host "Response:"
        $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTP Status: $statusCode" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Red
    }
    Write-Host ""
}

function Test-CustomTenant {
    Write-Host "--- Custom Tenant (X-Debug-Principal: user:admin:custom-tenant) ---" -ForegroundColor Yellow
    Write-Host ""

    try {
        $headers = @{
            "Content-Type" = "application/json"
            "X-Debug-Principal" = "user:admin:custom-tenant"
        }
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/v1/intents" -Method Post -Headers $headers -Body $payload -UseBasicParsing

        Write-Host "HTTP Status: $($response.StatusCode)" -ForegroundColor Green
        Write-Host "Response:"
        $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "HTTP Status: $statusCode" -ForegroundColor Red
        Write-Host "Error: $_" -ForegroundColor Red
    }
    Write-Host ""
}

# Run tests based on parameter
switch ($Test) {
    "health" { Test-Health }
    "authenticated" { Test-Authenticated }
    "unauthenticated" { Test-Unauthenticated }
    "service" { Test-ServicePrincipal }
    "tenant" { Test-CustomTenant }
    "all" {
        Test-Health
        Test-Authenticated
        Test-Unauthenticated
        Test-ServicePrincipal
        Test-CustomTenant
    }
}

Write-Host "=== Test Complete ===" -ForegroundColor Cyan
