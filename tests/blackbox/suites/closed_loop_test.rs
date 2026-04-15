use harness::{
    assert_body_contains, assert_header, assert_status, page_create_intent,
    intent_with_unknown_action, TestClient,
};
use uuid::Uuid;

/// Helper: poll the query endpoint until the page appears or retries exhausted.
async fn poll_for_page(client: &TestClient, page_id: &str, max_attempts: u32) -> harness::client::RawResponse {
    for attempt in 1..=max_attempts {
        let resp = client.query_page(page_id).await.expect("query_page should not fail");
        if resp.status == 200 {
            return resp;
        }
        if attempt < max_attempts {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }
    // Return the last response (likely 404)
    client.query_page(page_id).await.expect("query_page should not fail")
}

/// End-to-end: submit a page create intent, wait for the worker to build
/// the projection, and verify the query endpoint returns it.
#[tokio::test]
async fn test_page_create_builds_projection_and_query_returns_it() {
    let client = TestClient::from_env();

    let page_id = format!("page-e2e-{}", Uuid::new_v4());
    let title = "E2E Test Page";
    let slug = "e2e-test-page";

    let intent = page_create_intent(&page_id, title, slug);
    let submit_result = client.submit_intent(intent).await;
    assert!(
        submit_result.is_ok(),
        "Intent submission should succeed: {:?}",
        submit_result.err()
    );

    // Poll for the projection to be built (worker runs every 2s)
    let resp = poll_for_page(&client, &page_id, 10).await;
    assert_status(&resp, 200);

    // Verify payload
    let body: serde_json::Value =
        serde_json::from_str(&resp.body).expect("response should be valid JSON");
    assert_eq!(body["pageId"].as_str().unwrap(), page_id);
    assert_eq!(body["title"].as_str().unwrap(), title);
    assert_eq!(body["slug"].as_str().unwrap(), slug);

    // First fetch should be a cache miss
    assert_header(&resp, "x-cache", "MISS");
}

/// Verify cache semantics: first query is MISS, second is HIT,
/// after re-creating the page the cache is invalidated.
#[tokio::test]
async fn test_page_query_is_cached_and_invalidated() {
    let client = TestClient::from_env();

    let page_id = format!("page-cache-{}", Uuid::new_v4());
    let intent = page_create_intent(&page_id, "Cache Test v1", "cache-v1");
    client
        .submit_intent(intent)
        .await
        .expect("first intent should succeed");

    // Wait for projection
    let resp1 = poll_for_page(&client, &page_id, 10).await;
    assert_status(&resp1, 200);
    assert_header(&resp1, "x-cache", "MISS");

    // Second fetch should be cached
    let resp2 = client.query_page(&page_id).await.expect("query should work");
    assert_status(&resp2, 200);
    assert_header(&resp2, "x-cache", "HIT");

    // Submit a new intent for the SAME pageId but different title/slug
    // (different idempotency key so it's a new event)
    let intent2 = page_create_intent(&page_id, "Cache Test v2", "cache-v2");
    client
        .submit_intent(intent2)
        .await
        .expect("second intent should succeed");

    // Wait for worker to process and invalidate cache
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    // Should be a cache miss now with updated data
    let resp3 = client.query_page(&page_id).await.expect("query should work");
    assert_status(&resp3, 200);
    assert_header(&resp3, "x-cache", "MISS");

    let body: serde_json::Value =
        serde_json::from_str(&resp3.body).expect("should be valid JSON");
    assert_eq!(body["title"].as_str().unwrap(), "Cache Test v2");
    assert_eq!(body["slug"].as_str().unwrap(), "cache-v2");
}

/// Unknown action IDs should be rejected with 400 UNKNOWN_ACTION.
#[tokio::test]
async fn test_unknown_action_is_rejected() {
    let client = TestClient::from_env();

    let intent = intent_with_unknown_action();
    let resp = client
        .submit_intent_raw(intent)
        .await
        .expect("request should complete");

    assert_status(&resp, 400);
    assert_body_contains(&resp, "UNKNOWN_ACTION");
}

/// Tenant isolation: a page created under one tenant is invisible to another.
#[tokio::test]
async fn test_tenant_isolation_on_page_query() {
    let client = TestClient::from_env();

    let page_id = format!("page-iso-{}", Uuid::new_v4());
    let intent = page_create_intent(&page_id, "Isolation Test", "isolation");
    client
        .submit_intent(intent)
        .await
        .expect("intent should succeed");

    // Wait for projection
    let resp = poll_for_page(&client, &page_id, 10).await;
    assert_status(&resp, 200);

    // Query as a different tenant — should get 404
    let resp_other = client
        .query_page_as_tenant(&page_id, "user:other-user:tenant-itest-002")
        .await
        .expect("cross-tenant query should complete");
    assert_status(&resp_other, 404);
}
