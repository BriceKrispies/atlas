use harness::TestClient;

#[tokio::test]
async fn test_health_endpoint_returns_200() {
    let client = TestClient::from_env();

    let result = client.health_check().await;

    assert!(
        result.is_ok(),
        "Health check should succeed, got error: {:?}",
        result.err()
    );
}

/// Liveness endpoint should return 200 OK without any authentication.
/// This is the Kubernetes liveness probe endpoint.
#[tokio::test]
async fn test_liveness_endpoint_returns_200_without_auth() {
    let client = TestClient::from_env();

    let result = client.liveness_check().await;

    assert!(
        result.is_ok(),
        "Liveness check should succeed, got error: {:?}",
        result.err()
    );

    let response = result.unwrap();
    assert_eq!(
        response.status, 200,
        "Liveness endpoint should return 200 OK, got {}",
        response.status
    );

    // Verify the response body contains the expected status
    let body: serde_json::Value =
        serde_json::from_str(&response.body).expect("Response should be valid JSON");
    assert_eq!(
        body.get("status").and_then(|v| v.as_str()),
        Some("ok"),
        "Liveness response should have status: ok"
    );
}

/// Readiness endpoint should return 200 OK when all dependencies are available.
/// In the normal test harness environment, all dependencies should be ready.
#[tokio::test]
async fn test_readiness_endpoint_returns_200_when_ready() {
    let client = TestClient::from_env();

    let result = client.readiness_check().await;

    assert!(
        result.is_ok(),
        "Readiness check should succeed, got error: {:?}",
        result.err()
    );

    let response = result.unwrap();
    assert_eq!(
        response.status, 200,
        "Readiness endpoint should return 200 OK when dependencies are ready, got {}",
        response.status
    );

    // Verify the response body contains the expected status and checks
    let body: serde_json::Value =
        serde_json::from_str(&response.body).expect("Response should be valid JSON");
    assert_eq!(
        body.get("status").and_then(|v| v.as_str()),
        Some("ok"),
        "Readiness response should have status: ok"
    );

    // Verify checks are included
    let checks = body.get("checks").expect("Response should include checks");
    assert!(
        checks.get("schema_registry").is_some(),
        "Checks should include schema_registry"
    );
    assert!(
        checks.get("policies").is_some(),
        "Checks should include policies"
    );

    // Verify each check is ok
    let schema_check = checks.get("schema_registry").unwrap();
    assert_eq!(
        schema_check.get("status").and_then(|v| v.as_str()),
        Some("ok"),
        "Schema registry check should be ok"
    );

    let policy_check = checks.get("policies").unwrap();
    assert_eq!(
        policy_check.get("status").and_then(|v| v.as_str()),
        Some("ok"),
        "Policies check should be ok"
    );
}

/// Readiness endpoint does not require authentication.
#[tokio::test]
async fn test_readiness_endpoint_accessible_without_auth() {
    let client = TestClient::from_env();

    // Just verify we can call the endpoint - this tests that no auth middleware blocks it
    let result = client.readiness_check().await;

    assert!(
        result.is_ok(),
        "Readiness endpoint should be accessible without auth, got error: {:?}",
        result.err()
    );

    let response = result.unwrap();
    // Should get either 200 (ready) or 503 (not ready), but NOT 401/403 (auth errors)
    assert!(
        response.status == 200 || response.status == 503,
        "Readiness endpoint should return 200 or 503, not an auth error. Got {}",
        response.status
    );
}

#[tokio::test]
async fn test_metrics_endpoint_available() {
    let client = TestClient::from_env();

    let result = client.get_metrics().await;

    assert!(
        result.is_ok(),
        "Metrics endpoint should be available, got error: {:?}",
        result.err()
    );

    let metrics = result.unwrap();
    assert!(
        !metrics.raw.is_empty(),
        "Metrics response should not be empty"
    );
}

#[tokio::test]
async fn test_metrics_contain_expected_counters() {
    let client = TestClient::from_env();

    let metrics = client
        .get_metrics()
        .await
        .expect("Failed to fetch metrics");

    // Check for expected metric names
    assert!(
        metrics.metrics.contains_key("http_requests_total"),
        "Metrics should include http_requests_total counter"
    );

    assert!(
        metrics.metrics.contains_key("events_appended_total"),
        "Metrics should include events_appended_total counter"
    );

    assert!(
        metrics.metrics.contains_key("policy_evaluations_total"),
        "Metrics should include policy_evaluations_total counter"
    );
}
