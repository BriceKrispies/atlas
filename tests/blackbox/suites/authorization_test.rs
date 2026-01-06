use harness::{
    assert_status, intent_for_unauthorized_action, valid_intent_payload, TestClient,
};

#[tokio::test]
async fn test_authorized_action_succeeds() {
    let client = TestClient::from_env();
    let payload = valid_intent_payload();

    let result = client.submit_intent(payload).await;

    assert!(
        result.is_ok(),
        "Authorized action should succeed, got error: {:?}",
        result.err()
    );
}

#[tokio::test]
async fn test_unauthorized_action_returns_403() {
    let client = TestClient::from_env();
    let payload = intent_for_unauthorized_action();

    let result = client.submit_intent_raw(payload).await;

    assert!(
        result.is_ok(),
        "Request should complete, got error: {:?}",
        result.err()
    );

    let response = result.unwrap();

    // Should return 403 Forbidden for unauthorized action
    assert_status(&response, 403);
}

#[tokio::test]
async fn test_policy_evaluation_metrics_recorded() {
    let client = TestClient::from_env();

    // Get initial metrics
    let metrics_before = client
        .get_metrics()
        .await
        .expect("Failed to fetch metrics");

    let initial_evaluations = metrics_before
        .metrics
        .get("policy_evaluations_total")
        .map(|samples| samples.iter().map(|s| s.value).sum::<f64>())
        .unwrap_or(0.0);

    // Submit an intent (will trigger policy evaluation)
    let payload = valid_intent_payload();
    let _ = client.submit_intent(payload).await;

    // Get metrics after submission
    let metrics_after = client
        .get_metrics()
        .await
        .expect("Failed to fetch metrics");

    let final_evaluations = metrics_after
        .metrics
        .get("policy_evaluations_total")
        .map(|samples| samples.iter().map(|s| s.value).sum::<f64>())
        .unwrap_or(0.0);

    // Policy evaluations should have increased
    assert!(
        final_evaluations > initial_evaluations,
        "Policy evaluations counter should increase after intent submission"
    );
}
