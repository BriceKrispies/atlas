use harness::{
    assert_same_event, assert_valid_event_id, intent_with_idempotency_key,
    unique_idempotency_key, TestClient,
};

#[tokio::test]
async fn test_duplicate_idempotency_key_returns_same_event() {
    let client = TestClient::from_env();
    let idempotency_key = unique_idempotency_key("test-duplicate");
    let payload = intent_with_idempotency_key(idempotency_key.clone());

    // First submission
    let response1 = client
        .submit_intent(payload.clone())
        .await
        .expect("First submission should succeed");

    // Second submission with same idempotency key
    let response2 = client
        .submit_intent(payload)
        .await
        .expect("Second submission should succeed");

    // Both should return the same event ID (Invariant I3)
    assert_same_event(&response1, &response2);
}

#[tokio::test]
async fn test_different_idempotency_keys_create_different_events() {
    let client = TestClient::from_env();

    let payload1 = intent_with_idempotency_key(unique_idempotency_key("test-diff-1"));
    let payload2 = intent_with_idempotency_key(unique_idempotency_key("test-diff-2"));

    let response1 = client
        .submit_intent(payload1)
        .await
        .expect("First submission should succeed");

    let response2 = client
        .submit_intent(payload2)
        .await
        .expect("Second submission should succeed");

    // Different idempotency keys should create different events
    assert_ne!(
        response1.event_id, response2.event_id,
        "Different idempotency keys should create different events"
    );
}

#[tokio::test]
async fn test_idempotency_across_multiple_retries() {
    let client = TestClient::from_env();
    let idempotency_key = unique_idempotency_key("test-retries");
    let payload = intent_with_idempotency_key(idempotency_key.clone());

    // Submit the same request 10 times
    let mut event_ids = Vec::new();

    for i in 0..10 {
        let response = client
            .submit_intent(payload.clone())
            .await
            .expect(&format!("Submission {} should succeed", i));

        assert_valid_event_id(&response);
        event_ids.push(response.event_id);
    }

    // All event IDs should be identical
    let first_event_id = &event_ids[0];
    for (i, event_id) in event_ids.iter().enumerate() {
        assert_eq!(
            event_id, first_event_id,
            "Event ID at index {} should match first event ID",
            i
        );
    }
}

#[tokio::test]
async fn test_idempotency_with_different_payload_same_key() {
    let client = TestClient::from_env();
    let idempotency_key = unique_idempotency_key("test-same-key-diff-payload");

    let mut payload1 = intent_with_idempotency_key(idempotency_key.clone());
    let mut payload2 = intent_with_idempotency_key(idempotency_key.clone());

    // Modify the payload content (must still include required authz fields
    // AND every schema-required property; the page.create.v1 schema
    // requires actionId, resourceType, pageId, title, slug).
    payload2.payload = serde_json::json!({
        "actionId": "ContentPages.Page.Create",
        "resourceType": "Page",
        "resourceId": null,
        "pageId": "different-page",
        "title": "Different Title",
        "slug": "different-page",
        "content": "Different content",
        "authorId": "different-author",
        "status": "published"
    });

    // First submission
    let response1 = client
        .submit_intent(payload1)
        .await
        .expect("First submission should succeed");

    // Second submission with same idempotency key but different payload
    let response2 = client
        .submit_intent(payload2)
        .await
        .expect("Second submission should succeed");

    // Should return the same event ID (idempotency key wins)
    assert_same_event(&response1, &response2);
}
