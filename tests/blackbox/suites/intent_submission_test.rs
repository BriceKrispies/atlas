use harness::{
    assert_status, assert_tenant_id, assert_valid_event_id, intent_with_invalid_payload,
    intent_with_invalid_schema, intent_without_idempotency_key, valid_intent_payload, TestClient,
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
    // Should return 400 or 422 for invalid schema
    assert!(
        response.status == 400 || response.status == 422,
        "Expected 400 or 422 for invalid schema, got {}",
        response.status
    );
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
