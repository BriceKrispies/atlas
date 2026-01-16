use harness::{
    assert_body_contains, assert_status, assert_tenant_id, assert_valid_event_id,
    intent_with_invalid_payload, intent_with_invalid_schema, intent_with_schema_mismatch_payload,
    intent_without_idempotency_key, valid_intent_payload, TestClient,
};

#[tokio::test]
async fn test_submit_valid_intent_returns_202() {
    let client = TestClient::from_env();
    let payload = valid_intent_payload();

    let result = client.submit_intent(payload).await;

    assert!(
        result.is_ok(),
        "Valid intent should be accepted, got error: {:?}",
        result.err()
    );

    let response = result.unwrap();
    assert_valid_event_id(&response);
    assert_tenant_id(&response, "tenant-itest-001");
}

#[tokio::test]
async fn test_submit_intent_without_idempotency_key_returns_400() {
    let client = TestClient::from_env();
    let payload = intent_without_idempotency_key();

    let result = client.submit_intent_raw(payload).await;

    assert!(
        result.is_ok(),
        "Request should complete, got error: {:?}",
        result.err()
    );

    let response = result.unwrap();
    assert_status(&response, 400);
}

/// Test that requests with invalid schema IDs are rejected.
///
/// Expected behavior:
/// - Unknown schema_id returns 400 with UNKNOWN_SCHEMA error code
/// - Invalid schema_version for a known schema returns 400 with UNKNOWN_SCHEMA error code
#[tokio::test]
async fn test_submit_intent_with_invalid_schema_returns_error() {
    let client = TestClient::from_env();
    let payload = intent_with_invalid_schema();

    let result = client.submit_intent_raw(payload).await;

    assert!(
        result.is_ok(),
        "Request should complete, got error: {:?}",
        result.err()
    );

    let response = result.unwrap();
    // Should return 400 for invalid schema
    assert_status(&response, 400);
    // Should contain the UNKNOWN_SCHEMA error code
    assert_body_contains(&response, "UNKNOWN_SCHEMA");
}

/// Test that requests with payload that doesn't conform to the schema are rejected.
///
/// Expected behavior:
/// - Valid schema_id but non-conforming payload returns 400 with SCHEMA_VALIDATION_FAILED code
#[tokio::test]
async fn test_submit_intent_with_schema_mismatch_returns_error() {
    let client = TestClient::from_env();
    let payload = intent_with_schema_mismatch_payload();

    let result = client.submit_intent_raw(payload).await;

    assert!(
        result.is_ok(),
        "Request should complete, got error: {:?}",
        result.err()
    );

    let response = result.unwrap();
    // Should return 400 for payload that doesn't match schema
    assert_status(&response, 400);
    // Should contain the SCHEMA_VALIDATION_FAILED error code
    assert_body_contains(&response, "SCHEMA_VALIDATION_FAILED");
}

#[tokio::test]
async fn test_submit_intent_with_invalid_payload_returns_error() {
    let client = TestClient::from_env();
    let payload = intent_with_invalid_payload();

    let result = client.submit_intent_raw(payload).await;

    assert!(
        result.is_ok(),
        "Request should complete, got error: {:?}",
        result.err()
    );

    let response = result.unwrap();
    // Should return 400 or 422 for invalid payload
    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400 or 422 for invalid payload, got {}",
        response.status
    );
}

#[tokio::test]
async fn test_multiple_valid_intents_succeed() {
    let client = TestClient::from_env();

    // Submit 5 different intents
    for i in 0..5 {
        let mut payload = valid_intent_payload();
        payload.idempotency_key = format!("test-multiple-{}", i);

        let result = client.submit_intent(payload).await;

        assert!(
            result.is_ok(),
            "Intent {} should succeed, got error: {:?}",
            i,
            result.err()
        );
    }
}
