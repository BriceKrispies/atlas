use harness::{valid_intent_payload, TestClient};
use std::collections::HashMap;

#[tokio::test]
async fn test_http_requests_total_metric_increments() {
    let client = TestClient::from_env();

    // Get initial metrics
    let metrics_before = client
        .get_metrics()
        .await
        .expect("Failed to fetch metrics");

    let initial_count = metrics_before
        .metrics
        .get("http_requests_total")
        .map(|samples| samples.iter().map(|s| s.value).sum::<f64>())
        .unwrap_or(0.0);

    // Make a request
    let _ = client.health_check().await;

    // Get metrics after request
    let metrics_after = client
        .get_metrics()
        .await
        .expect("Failed to fetch metrics");

    let final_count = metrics_after
        .metrics
        .get("http_requests_total")
        .map(|samples| samples.iter().map(|s| s.value).sum::<f64>())
        .unwrap_or(0.0);

    // Count should have increased
    assert!(
        final_count > initial_count,
        "http_requests_total should increment after request"
    );
}

#[tokio::test]
async fn test_events_appended_total_metric_increments() {
    let client = TestClient::from_env();

    // Get initial metrics
    let metrics_before = client
        .get_metrics()
        .await
        .expect("Failed to fetch metrics");

    let initial_count = metrics_before
        .metrics
        .get("events_appended_total")
        .map(|samples| samples.iter().map(|s| s.value).sum::<f64>())
        .unwrap_or(0.0);

    // Submit an intent
    let payload = valid_intent_payload();
    let _ = client.submit_intent(payload).await;

    // Get metrics after submission
    let metrics_after = client
        .get_metrics()
        .await
        .expect("Failed to fetch metrics");

    let final_count = metrics_after
        .metrics
        .get("events_appended_total")
        .map(|samples| samples.iter().map(|s| s.value).sum::<f64>())
        .unwrap_or(0.0);

    // Count should have increased
    assert!(
        final_count > initial_count,
        "events_appended_total should increment after intent submission"
    );
}

#[tokio::test]
async fn test_http_request_duration_histogram_recorded() {
    let client = TestClient::from_env();

    // Make a request
    let _ = client.health_check().await;

    // Get metrics
    let metrics = client
        .get_metrics()
        .await
        .expect("Failed to fetch metrics");

    // Check for histogram buckets
    let has_duration_metrics = metrics
        .metrics
        .keys()
        .any(|k| k.starts_with("http_request_duration_seconds"));

    assert!(
        has_duration_metrics,
        "Should have http_request_duration_seconds metrics"
    );
}

#[tokio::test]
async fn test_metrics_include_labels() {
    let client = TestClient::from_env();

    // Submit an intent
    let payload = valid_intent_payload();
    let _ = client.submit_intent(payload).await;

    // Get metrics
    let metrics = client
        .get_metrics()
        .await
        .expect("Failed to fetch metrics");

    // Check http_requests_total has route label
    if let Some(samples) = metrics.metrics.get("http_requests_total") {
        let has_route_label = samples.iter().any(|sample| sample.labels.contains_key("route"));

        assert!(
            has_route_label,
            "http_requests_total should include route label"
        );
    }

    // Check events_appended_total has tenant_id label
    if let Some(samples) = metrics.metrics.get("events_appended_total") {
        let has_tenant_label = samples
            .iter()
            .any(|sample| sample.labels.contains_key("tenant_id"));

        assert!(
            has_tenant_label,
            "events_appended_total should include tenant_id label"
        );
    }
}

#[tokio::test]
async fn test_metrics_tenant_id_filtering() {
    let client = TestClient::from_env();

    // Submit an intent
    let payload = valid_intent_payload();
    let _ = client.submit_intent(payload).await;

    // Get metrics
    let metrics = client
        .get_metrics()
        .await
        .expect("Failed to fetch metrics");

    // Find events_appended_total for our test tenant
    if let Some(samples) = metrics.metrics.get("events_appended_total") {
        let test_tenant_label = HashMap::from([("tenant_id".to_string(), "tenant-itest-001".to_string())]);

        let matching_samples: Vec<_> = samples
            .iter()
            .filter(|s| s.labels.get("tenant_id") == Some(&"tenant-itest-001".to_string()))
            .collect();

        assert!(
            !matching_samples.is_empty(),
            "Should have events_appended_total metrics for tenant-itest-001"
        );
    }
}
