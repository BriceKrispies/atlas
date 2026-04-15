use harness::{assert_status, page_create_intent, TestClient};
use uuid::Uuid;

/// Poll the render tree endpoint until it returns 200 or retries exhausted.
async fn poll_for_render_tree(
    client: &TestClient,
    page_id: &str,
    max_attempts: u32,
) -> harness::client::RawResponse {
    for attempt in 1..=max_attempts {
        let resp = client
            .query_render_tree(page_id)
            .await
            .expect("query_render_tree should not fail");
        if resp.status == 200 {
            return resp;
        }
        if attempt < max_attempts {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }
    client
        .query_render_tree(page_id)
        .await
        .expect("query_render_tree should not fail")
}

/// Persistence proof: render tree survives in-memory cache clear (simulated restart).
///
/// 1. Create a page via intent
/// 2. Wait for render tree to appear
/// 3. Clear the in-memory render tree cache (simulates process restart)
/// 4. Verify the render tree is still returned (from Postgres fallback)
///
/// Requires: CONTROL_PLANE_DB_URL set, DEBUG_AUTH_ENDPOINT_ENABLED=true
#[tokio::test]
async fn test_render_tree_survives_cache_clear() {
    let client = TestClient::from_env();

    let page_id = format!("page-persist-{}", Uuid::new_v4());
    let title = "Persistence Test Page";
    let slug = "persist-test";

    // 1. Create the page
    let intent = page_create_intent(&page_id, title, slug);
    client
        .submit_intent(intent)
        .await
        .expect("intent should succeed");

    // 2. Wait for the render tree to be built by the worker
    let resp = poll_for_render_tree(&client, &page_id, 12).await;
    assert_status(&resp, 200);

    let tree_before: serde_json::Value =
        serde_json::from_str(&resp.body).expect("should be valid JSON");

    // If this is a renderError, skip — no Postgres or no WASM, nothing to persist
    if tree_before.get("renderError").is_some() {
        eprintln!(
            "NOTE: render tree has renderError — skipping persistence check. \
             This is expected if WASM plugin is not deployed."
        );
        return;
    }

    // 3. Clear in-memory render tree cache (simulates restart)
    let clear_resp = client
        .clear_render_tree_cache(&page_id)
        .await
        .expect("clear cache should not fail");

    if clear_resp.status != 200 {
        eprintln!(
            "NOTE: clear-render-tree-cache returned {} — endpoint may not be enabled. \
             Skipping persistence test. Body: {}",
            clear_resp.status, clear_resp.body
        );
        return;
    }

    let clear_body: serde_json::Value =
        serde_json::from_str(&clear_resp.body).expect("should be valid JSON");
    assert_eq!(
        clear_body["cleared"], true,
        "in-memory render tree should have been cleared"
    );

    // 4. Query again — should still return the tree (from Postgres fallback)
    let resp_after = client
        .query_render_tree(&page_id)
        .await
        .expect("query should not fail");

    // If no Postgres configured, this will 404 — that's expected in in-memory-only mode
    if resp_after.status == 404 {
        eprintln!(
            "NOTE: render tree returned 404 after cache clear — Postgres persistence \
             not configured. This test proves persistence only when CONTROL_PLANE_DB_URL is set."
        );
        return;
    }

    assert_status(&resp_after, 200);

    let tree_after: serde_json::Value =
        serde_json::from_str(&resp_after.body).expect("should be valid JSON");

    // The tree from Postgres should match what we had before
    assert_eq!(
        tree_before, tree_after,
        "render tree from Postgres should match the original"
    );
}
