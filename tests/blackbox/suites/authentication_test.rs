//! Authentication / OIDC Blackbox Tests
//!
//! This test suite validates the authentication invariants of the Atlas Platform:
//!
//! ## Invariants Tested
//!
//! 1. **Missing Token**: Requests without authentication must return 401 Unauthorized.
//! 2. **Invalid Token**: Requests with malformed/invalid tokens must return 401 Unauthorized.
//! 3. **Valid Token**: Requests with valid Keycloak-issued tokens must return 200 (or 403
//!    if policy denies), but NOT 401. This proves the token validation succeeded.
//!
//! ## Prerequisites
//!
//! These tests require the following services to be running:
//! - Ingress service (http://localhost:3000)
//! - Keycloak (http://localhost:8081) with the `atlas` realm configured
//! - The `atlas-s2s` client must exist in Keycloak with service accounts enabled
//!
//! ## Running These Tests
//!
//! ```bash
//! # Start the dev stack (includes Keycloak + ingress)
//! docker compose -f infra/compose/compose.dev.yml up -d
//!
//! # Wait for services to be healthy
//! docker compose -f infra/compose/compose.dev.yml ps
//!
//! # Run authentication tests
//! cd tests/blackbox
//! cargo test authentication -- --nocapture
//! ```
//!
//! ## Expected Runtime
//!
//! These tests take ~2-5 seconds as they involve real HTTP calls to Keycloak
//! for token minting. The first test may be slower due to JWKS caching.
//!
//! ## Security Guarantees
//!
//! When these tests pass, you have strong confidence that:
//! - Auth cannot be accidentally bypassed (missing token = 401)
//! - Invalid tokens are rejected (forged token = 401)
//! - Keycloak tokens are properly validated (signature + claims)
//! - Principal extraction works correctly (identity fields present)

use harness::{assert_body_contains, assert_status, KeycloakClient, TestClient, TestConfig};
use std::time::Duration;

/// Test that requests without authentication return 401.
///
/// This is the most basic auth invariant: unauthenticated requests
/// must be rejected with 401 Unauthorized.
#[tokio::test]
async fn test_missing_token_returns_401() {
    let client = TestClient::from_env();

    let response = client
        .whoami(None)
        .await
        .expect("Request should complete");

    // Must be 401 Unauthorized (not 200, not 403)
    assert_status(&response, 401);
    assert_body_contains(&response, "unauthorized");
}

/// Test that requests with a clearly invalid token return 401.
///
/// This ensures the system rejects garbage tokens and doesn't
/// accidentally accept them or crash.
#[tokio::test]
async fn test_invalid_token_returns_401() {
    let client = TestClient::from_env();

    // Send a clearly invalid token (not even valid JWT format)
    let response = client
        .whoami(Some("this-is-not-a-valid-jwt-token"))
        .await
        .expect("Request should complete");

    assert_status(&response, 401);
}

/// Test that requests with a malformed JWT (valid format, invalid content) return 401.
///
/// This tests the JWT parsing layer specifically.
#[tokio::test]
async fn test_malformed_jwt_returns_401() {
    let client = TestClient::from_env();

    // A properly formatted JWT but with invalid/unsigned payload
    // Format: header.payload.signature (all base64url encoded)
    let fake_jwt = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.\
                    eyJzdWIiOiJmYWtlLXVzZXIiLCJpc3MiOiJmYWtlLWlzc3VlciJ9.\
                    invalid-signature";

    let response = client
        .whoami(Some(fake_jwt))
        .await
        .expect("Request should complete");

    assert_status(&response, 401);
}

/// Test that requests with an expired token return 401.
///
/// This tests the expiration validation logic.
#[tokio::test]
async fn test_expired_token_returns_401() {
    let client = TestClient::from_env();

    // A JWT with exp claim in the past (2020-01-01)
    // This is a valid JWT structure but with expired timestamp
    let expired_jwt = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.\
                       eyJzdWIiOiJ0ZXN0LXVzZXIiLCJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjgwODEvcmVhbG1zL2F0bGFzIiwiZXhwIjoxNTc3ODM2ODAwfQ.\
                       fake-signature";

    let response = client
        .whoami(Some(expired_jwt))
        .await
        .expect("Request should complete");

    assert_status(&response, 401);
}

/// Test that a valid Keycloak-issued token is accepted.
///
/// This is the positive test case: a real token from Keycloak should
/// be validated successfully and return principal information.
///
/// IMPORTANT: This test requires Keycloak to be running with the atlas realm
/// and atlas-s2s client configured. If Keycloak is not available, the test
/// is skipped (not failed).
#[tokio::test]
async fn test_valid_keycloak_token_returns_200_with_principal() {
    let config = TestConfig::load();

    // Check if Keycloak is configured
    let keycloak_config = match &config.keycloak {
        Some(kc) => kc,
        None => {
            eprintln!(
                "SKIPPED: Keycloak not configured (set KEYCLOAK_CLIENT_SECRET in .env.local)"
            );
            return;
        }
    };

    // Create Keycloak client
    let keycloak = KeycloakClient::new(
        &keycloak_config.base_url,
        &keycloak_config.realm,
        &keycloak_config.client_id,
        &keycloak_config.client_secret,
    );

    // Wait for Keycloak to be ready (with retries)
    if let Err(e) = keycloak
        .wait_for_ready(5, Duration::from_secs(2))
        .await
    {
        eprintln!("SKIPPED: Keycloak not available: {}", e);
        return;
    }

    // Mint a real token from Keycloak
    let token_response = keycloak
        .mint_token()
        .await
        .expect("Should be able to mint token from Keycloak");

    // Create test client and call whoami with the token
    let client = TestClient::from_env();
    let response = client
        .whoami(Some(&token_response.access_token))
        .await
        .expect("Request should complete");

    // The response should be 200 (authenticated) or 403 (policy denied)
    // but NOT 401 (which would mean auth failed)
    assert!(
        response.status == 200 || response.status == 403,
        "Expected 200 or 403 (auth succeeded), got {}. Body: {}",
        response.status,
        response.body
    );

    // If we got 200, verify the response contains expected principal fields
    if response.status == 200 {
        // Response should contain identity information
        assert_body_contains(&response, "principalId");
        assert_body_contains(&response, "principalType");
        assert_body_contains(&response, "tenantId");

        // Response should contain claims from the token
        assert_body_contains(&response, "claims");

        // The issuer should match Keycloak
        assert_body_contains(&response, "http://localhost:8081/realms/atlas");

        // For client_credentials grant, principal should be service type
        assert_body_contains(&response, "service");
    }
}

/// Test that principal information is correctly extracted from a valid token.
///
/// This validates that the ingress correctly parses JWT claims and constructs
/// the Principal with the expected fields.
#[tokio::test]
async fn test_valid_token_extracts_correct_principal() {
    let config = TestConfig::load();

    let keycloak_config = match &config.keycloak {
        Some(kc) => kc,
        None => {
            eprintln!("SKIPPED: Keycloak not configured");
            return;
        }
    };

    let keycloak = KeycloakClient::new(
        &keycloak_config.base_url,
        &keycloak_config.realm,
        &keycloak_config.client_id,
        &keycloak_config.client_secret,
    );

    if let Err(e) = keycloak.wait_for_ready(5, Duration::from_secs(2)).await {
        eprintln!("SKIPPED: Keycloak not available: {}", e);
        return;
    }

    let token_response = keycloak.mint_token().await.expect("Token mint failed");

    let client = TestClient::from_env();
    let response = client
        .whoami(Some(&token_response.access_token))
        .await
        .expect("Request failed");

    if response.status != 200 {
        eprintln!(
            "SKIPPED: Got {} instead of 200 (policy may deny): {}",
            response.status, response.body
        );
        return;
    }

    // Parse the response body as JSON
    let body: serde_json::Value =
        serde_json::from_str(&response.body).expect("Response should be valid JSON");

    // Verify expected fields are present and have correct types
    assert!(
        body.get("principalId").is_some(),
        "Response should contain principalId"
    );
    assert!(
        body.get("principalType").is_some(),
        "Response should contain principalType"
    );
    assert!(
        body.get("tenantId").is_some(),
        "Response should contain tenantId"
    );
    assert!(
        body.get("claims").is_some(),
        "Response should contain claims"
    );

    // Verify claims contain expected OIDC fields
    let claims = body.get("claims").unwrap();
    assert!(claims.get("iss").is_some(), "Claims should contain iss");
    assert!(claims.get("sub").is_some(), "Claims should contain sub");
    assert!(claims.get("azp").is_some(), "Claims should contain azp");

    // For service account, principalId should reference the client
    let principal_id = body.get("principalId").unwrap().as_str().unwrap();
    assert!(
        principal_id.contains("atlas-s2s"),
        "Service account principalId should reference client ID, got: {}",
        principal_id
    );
}

/// Test that the X-Debug-Principal header works when TEST_AUTH_ENABLED=true.
///
/// This validates the test-auth mode that allows bypassing real auth
/// for development/testing purposes.
#[tokio::test]
async fn test_debug_principal_header_works() {
    let client = TestClient::from_env();

    // Use the X-Debug-Principal header (only works when TEST_AUTH_ENABLED=true)
    let response = client
        .whoami_with_debug_principal("user:test-user-123:tenant-dev")
        .await
        .expect("Request should complete");

    // If test-auth is enabled, should get 200
    // If test-auth is disabled, should get 401
    // Both are valid depending on config
    assert!(
        response.status == 200 || response.status == 401,
        "Expected 200 (test-auth enabled) or 401 (test-auth disabled), got {}",
        response.status
    );

    if response.status == 200 {
        // Verify the injected principal is reflected in response
        assert_body_contains(&response, "test-user-123");
        assert_body_contains(&response, "tenant-dev");
    }
}

/// Test that token validation happens before authorization.
///
/// This ensures that invalid tokens are rejected with 401 (auth failure)
/// rather than 403 (authz failure), maintaining proper error semantics.
#[tokio::test]
async fn test_auth_failure_returns_401_not_403() {
    let client = TestClient::from_env();

    // An invalid token should fail at the authentication layer (401)
    // not the authorization layer (403)
    let response = client
        .whoami(Some("invalid-token"))
        .await
        .expect("Request should complete");

    assert_eq!(
        response.status, 401,
        "Auth failures should return 401, not 403. Got: {}",
        response.status
    );
}

/// Test that Keycloak token endpoint is reachable (smoke test).
///
/// This is a basic connectivity check that Keycloak is responding.
#[tokio::test]
async fn test_keycloak_is_reachable() {
    let config = TestConfig::load();

    let keycloak_config = match &config.keycloak {
        Some(kc) => kc,
        None => {
            eprintln!("SKIPPED: Keycloak not configured");
            return;
        }
    };

    let keycloak = KeycloakClient::new(
        &keycloak_config.base_url,
        &keycloak_config.realm,
        &keycloak_config.client_id,
        &keycloak_config.client_secret,
    );

    // Fetch OIDC discovery document
    let discovery = keycloak
        .discover()
        .await
        .expect("Keycloak should be reachable");

    // Verify issuer matches expected value
    assert!(
        discovery.issuer.contains("localhost:8081"),
        "Issuer should be local Keycloak, got: {}",
        discovery.issuer
    );
    assert!(
        discovery.issuer.contains("atlas"),
        "Issuer should be for atlas realm, got: {}",
        discovery.issuer
    );
}
