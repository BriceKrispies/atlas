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
