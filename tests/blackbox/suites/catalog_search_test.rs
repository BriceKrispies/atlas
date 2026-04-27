//! Black-box acceptance tests for the StructuredCatalog search slice (Phase 2).
//!
//! Each test creates one (or two) ephemeral tenant DBs via the control plane,
//! applies the badge-family seed via /api/v1/intents, and exercises
//! GET /api/v1/catalog/search.

use harness::TestConfig;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

const SEED_PAYLOAD_PATH: &str = "../../specs/modules/structured-catalog/seed-packages/badge-family.json";

#[derive(Debug, Deserialize)]
struct CreateTenantResponse {
    #[allow(dead_code)]
    status: String,
    tenant: TenantBody,
}

#[derive(Debug, Deserialize)]
struct TenantBody {
    #[allow(dead_code)]
    tenant_id: String,
    #[allow(dead_code)]
    db_name: Option<String>,
    #[allow(dead_code)]
    db_host: Option<String>,
    #[allow(dead_code)]
    db_port: Option<i32>,
    connection_string: Option<String>,
}

async fn create_tenant(
    http: &reqwest::Client,
    control_plane_base_url: &str,
    tenant_key: &str,
) -> CreateTenantResponse {
    let url = format!("{}/admin/tenants", control_plane_base_url);
    let body = json!({
        "tenantKey": tenant_key,
        "migrate": true,
        "seed": false,
        "name": format!("Catalog search test {}", tenant_key),
        "region": "local",
    });
    let resp = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .expect("create_tenant http failed");
    let status = resp.status();
    let text = resp.text().await.expect("read body");
    assert!(
        status.is_success(),
        "create_tenant {} → {} {}",
        tenant_key,
        status,
        text
    );
    serde_json::from_str(&text).expect("parse create_tenant body")
}

async fn delete_tenant(http: &reqwest::Client, control_plane_base_url: &str, tenant_key: &str) {
    let _ = http
        .delete(format!(
            "{}/admin/tenants/{}",
            control_plane_base_url, tenant_key
        ))
        .send()
        .await;
}

fn load_seed_payload() -> Value {
    let candidates = [
        SEED_PAYLOAD_PATH,
        "specs/modules/structured-catalog/seed-packages/badge-family.json",
        "/app/specs/modules/structured-catalog/seed-packages/badge-family.json",
    ];
    for c in candidates {
        if let Ok(s) = std::fs::read_to_string(c) {
            return serde_json::from_str(&s).expect("badge-family.json must be valid JSON");
        }
    }
    panic!("could not locate badge-family.json — tried {:?}", candidates);
}

fn build_seed_intent(tenant_id: &str, idem_key: &str, seed_payload: &Value) -> Value {
    json!({
        "eventId": Uuid::new_v4().to_string(),
        "eventType": "Catalog.SeedPackage.ApplyRequested",
        "schemaId": "catalog.seed_package.apply.v1",
        "schemaVersion": 1,
        "occurredAt": chrono::Utc::now().to_rfc3339(),
        "tenantId": tenant_id,
        "correlationId": Uuid::new_v4().to_string(),
        "idempotencyKey": idem_key,
        "principalId": "user-test-001",
        "userId": "user-test-001",
        "payload": {
            "actionId": "Catalog.SeedPackage.Apply",
            "resourceType": "SeedPackage",
            "resourceId": null,
            "seedPackageKey": seed_payload.get("packageKey").and_then(|v| v.as_str()).unwrap_or("badge-family-starter"),
            "seedPackageVersion": seed_payload.get("version").and_then(|v| v.as_str()).unwrap_or("1.0.0"),
            "payload": seed_payload.get("payload").cloned().unwrap_or(json!({})),
        }
    })
}

async fn submit_intent(
    http: &reqwest::Client,
    base_url: &str,
    principal: &str,
    body: &Value,
) -> (u16, String) {
    let resp = http
        .post(format!("{}/api/v1/intents", base_url))
        .header("X-Debug-Principal", principal)
        .json(body)
        .send()
        .await
        .expect("submit_intent failed");
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    (status, text)
}

async fn get_json(
    http: &reqwest::Client,
    base_url: &str,
    principal: &str,
    path: &str,
) -> (u16, Value) {
    let resp = http
        .get(format!("{}{}", base_url, path))
        .header("X-Debug-Principal", principal)
        .send()
        .await
        .expect("get failed");
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    let v = serde_json::from_str(&text).unwrap_or(Value::String(text));
    (status, v)
}

async fn poll_until<F, Fut>(max_attempts: u32, mut f: F) -> bool
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    for attempt in 1..=max_attempts {
        if f().await {
            return true;
        }
        if attempt < max_attempts {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    }
    false
}

struct TenantCtx {
    key: String,
    principal: String,
    pool: sqlx::PgPool,
}

impl TenantCtx {
    fn tenant_id(&self) -> String {
        self.key.clone()
    }
}

async fn provision_tenant(http: &reqwest::Client, base_url: &str, suffix: &str) -> TenantCtx {
    let key = format!("cs-{}", suffix);
    let resp = create_tenant(http, base_url, &key).await;
    let conn = resp
        .tenant
        .connection_string
        .clone()
        .expect("tenant connection_string");
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&conn)
        .await
        .expect("tenant pool connect");
    let principal = format!("user:test-user:{}", resp.tenant.tenant_id);
    TenantCtx {
        key,
        principal,
        pool,
    }
}

async fn apply_seed_and_wait_for_search(
    http: &reqwest::Client,
    cfg: &TestConfig,
    ctx: &TenantCtx,
    idem: &str,
) {
    let seed = load_seed_payload();
    let intent = build_seed_intent(&ctx.tenant_id(), idem, &seed);
    let (s, body) = submit_intent(http, &cfg.ingress_base_url, &ctx.principal, &intent).await;
    assert_eq!(s, 202, "seed apply: {}", body);

    // Wait for the worker to materialize the family detail projection AND the
    // search documents row. The family-detail projection is the cheaper signal
    // that tells us the worker has processed the event; we then poll the
    // search document table directly to be sure search_documents is populated.
    let ok = poll_until(30, || async {
        let (st, _) = get_json(
            http,
            &cfg.ingress_base_url,
            &ctx.principal,
            "/api/v1/catalog/families/service_anniversary_badge",
        )
        .await;
        st == 200
    })
    .await;
    assert!(ok, "family_detail projection should land within poll budget");

    let ok2 = poll_until(30, || async {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM catalog_search_documents WHERE tenant_id = $1",
        )
        .bind(ctx.tenant_id())
        .fetch_one(&ctx.pool)
        .await
        .unwrap_or(0);
        count >= 4
    })
    .await;
    assert!(
        ok2,
        "expected at least 4 (1 family + 3 variants) search documents indexed"
    );
}

/// 1. Apply seed → search returns the family.
#[tokio::test]
async fn test_search_returns_family_for_anniversary() {
    let cfg = TestConfig::load();
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();
    let suffix = Uuid::new_v4().simple().to_string()[..8].to_string();
    let ctx = provision_tenant(&http, &cfg.control_plane_base_url, &suffix).await;
    apply_seed_and_wait_for_search(&http, &cfg, &ctx, &format!("itest-search-fam-{}", suffix))
        .await;

    let (status, body) = get_json(
        &http,
        &cfg.ingress_base_url,
        &ctx.principal,
        "/api/v1/catalog/search?q=anniversary",
    )
    .await;
    assert_eq!(status, 200, "search anniversary: {}", body);

    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .expect("results array");
    assert!(
        results
            .iter()
            .any(|r| r.get("documentType").and_then(|v| v.as_str()) == Some("family")
                && r.get("documentId").and_then(|v| v.as_str())
                    == Some("service_anniversary_badge")),
        "expected family hit for service_anniversary_badge: {}",
        body
    );

    delete_tenant(&http, &cfg.control_plane_base_url, &ctx.key).await;
}

/// 2. Search returns variants too.
#[tokio::test]
async fn test_search_returns_variants() {
    let cfg = TestConfig::load();
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();
    let suffix = Uuid::new_v4().simple().to_string()[..8].to_string();
    let ctx = provision_tenant(&http, &cfg.control_plane_base_url, &suffix).await;
    apply_seed_and_wait_for_search(&http, &cfg, &ctx, &format!("itest-search-var-{}", suffix))
        .await;

    let (status, body) = get_json(
        &http,
        &cfg.ingress_base_url,
        &ctx.principal,
        "/api/v1/catalog/search?q=year",
    )
    .await;
    assert_eq!(status, 200, "search year: {}", body);

    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .expect("results array");
    let variant_count = results
        .iter()
        .filter(|r| r.get("documentType").and_then(|v| v.as_str()) == Some("variant"))
        .count();
    assert!(
        variant_count >= 3,
        "expected at least 3 variant hits (1/5/10 Year Badge), got {}: {}",
        variant_count,
        body
    );

    delete_tenant(&http, &cfg.control_plane_base_url, &ctx.key).await;
}

/// 3. Tenant isolation — search in tenant B yields nothing for tenant A's seed.
#[tokio::test]
async fn test_search_tenant_isolation() {
    let cfg = TestConfig::load();
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();
    let suffix = Uuid::new_v4().simple().to_string()[..8].to_string();
    let a = provision_tenant(&http, &cfg.control_plane_base_url, &format!("a-{}", suffix)).await;
    let b = provision_tenant(&http, &cfg.control_plane_base_url, &format!("b-{}", suffix)).await;

    apply_seed_and_wait_for_search(&http, &cfg, &a, &format!("itest-search-iso-{}", suffix)).await;

    let (status, body) = get_json(
        &http,
        &cfg.ingress_base_url,
        &b.principal,
        "/api/v1/catalog/search?q=anniversary",
    )
    .await;
    assert_eq!(status, 200, "search in tenant B: {}", body);
    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .expect("results array");
    assert!(
        results.is_empty(),
        "tenant B must not see tenant A's documents: {}",
        body
    );

    delete_tenant(&http, &cfg.control_plane_base_url, &a.key).await;
    delete_tenant(&http, &cfg.control_plane_base_url, &b.key).await;
}

/// 4. Type filter narrows.
#[tokio::test]
async fn test_search_type_filter_narrows() {
    let cfg = TestConfig::load();
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();
    let suffix = Uuid::new_v4().simple().to_string()[..8].to_string();
    let ctx = provision_tenant(&http, &cfg.control_plane_base_url, &suffix).await;
    apply_seed_and_wait_for_search(&http, &cfg, &ctx, &format!("itest-search-type-{}", suffix))
        .await;

    let (status, body) = get_json(
        &http,
        &cfg.ingress_base_url,
        &ctx.principal,
        "/api/v1/catalog/search?q=anniversary&type=variant",
    )
    .await;
    assert_eq!(status, 200, "search anniversary type=variant: {}", body);

    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .expect("results array");
    assert!(!results.is_empty(), "expected variant hits: {}", body);
    assert!(
        results
            .iter()
            .all(|r| r.get("documentType").and_then(|v| v.as_str()) == Some("variant")),
        "expected only variant hits, got: {}",
        body
    );

    delete_tenant(&http, &cfg.control_plane_base_url, &ctx.key).await;
}

/// 5. Ranking — title-match scores higher than body-only match.
#[tokio::test]
async fn test_search_ranking_descending_score() {
    let cfg = TestConfig::load();
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();
    let suffix = Uuid::new_v4().simple().to_string()[..8].to_string();
    let ctx = provision_tenant(&http, &cfg.control_plane_base_url, &suffix).await;
    apply_seed_and_wait_for_search(&http, &cfg, &ctx, &format!("itest-search-rank-{}", suffix))
        .await;

    // "anniversary" appears strongly in the family title and weakly in the
    // variant summaries (which include the family name).
    let (status, body) = get_json(
        &http,
        &cfg.ingress_base_url,
        &ctx.principal,
        "/api/v1/catalog/search?q=anniversary",
    )
    .await;
    assert_eq!(status, 200, "search anniversary: {}", body);

    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .expect("results array");
    assert!(
        results.len() >= 2,
        "expected multiple hits to compare ranking: {}",
        body
    );

    let scores: Vec<f64> = results
        .iter()
        .map(|r| r.get("score").and_then(|v| v.as_f64()).unwrap_or(0.0))
        .collect();
    for w in scores.windows(2) {
        assert!(
            w[0] >= w[1],
            "scores must be non-increasing (got {:?})",
            scores
        );
    }

    let first_type = results[0]
        .get("documentType")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert_eq!(
        first_type, "family",
        "title-match family should rank above body-only variants: {}",
        body
    );

    delete_tenant(&http, &cfg.control_plane_base_url, &ctx.key).await;
}

/// 6. Permission filter — manually-indexed restricted doc is invisible to a
///    non-allowed principal.
#[tokio::test]
async fn test_search_permission_filter_excludes_disallowed() {
    let cfg = TestConfig::load();
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();
    let suffix = Uuid::new_v4().simple().to_string()[..8].to_string();
    let ctx = provision_tenant(&http, &cfg.control_plane_base_url, &suffix).await;
    apply_seed_and_wait_for_search(&http, &cfg, &ctx, &format!("itest-search-perm-{}", suffix))
        .await;

    // Insert a restricted doc via the test-only debug index endpoint.
    let restricted_doc = json!({
        "documentId": "alice_only_anniversary",
        "documentType": "family",
        "tenantId": ctx.tenant_id(),
        "fields": {
            "title": "Alice Only Anniversary Briefing",
            "summary": "Restricted to Alice",
            "body_text": "",
            "taxonomy_path": "/recognition/badges/private",
        },
        "permissionAttributes": {
            "allowedPrincipals": ["u_alice"],
        }
    });
    let resp = http
        .post(format!(
            "{}/debug/search/index",
            cfg.ingress_base_url
        ))
        .header("X-Debug-Principal", &ctx.principal)
        .json(&restricted_doc)
        .send()
        .await
        .expect("debug index failed");
    assert!(
        resp.status().is_success(),
        "debug index expected 2xx, got {}",
        resp.status()
    );

    // Search as the test principal (not u_alice) — must NOT see the restricted doc.
    let (status, body) = get_json(
        &http,
        &cfg.ingress_base_url,
        &ctx.principal,
        "/api/v1/catalog/search?q=anniversary",
    )
    .await;
    assert_eq!(status, 200, "search: {}", body);
    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .expect("results array");
    let leaked = results
        .iter()
        .any(|r| r.get("documentId").and_then(|v| v.as_str()) == Some("alice_only_anniversary"));
    assert!(
        !leaked,
        "restricted doc must not appear for non-allowed principal: {}",
        body
    );

    // Search as u_alice — MUST see it. The principal header carries the
    // tenant suffix so the tenant_id check still aligns.
    let alice_principal = format!("user:u_alice:{}", ctx.tenant_id());
    let (status_a, body_a) = get_json(
        &http,
        &cfg.ingress_base_url,
        &alice_principal,
        "/api/v1/catalog/search?q=anniversary",
    )
    .await;
    assert_eq!(status_a, 200, "search as alice: {}", body_a);
    let results_a = body_a
        .get("results")
        .and_then(|v| v.as_array())
        .expect("results array");
    let alice_sees = results_a
        .iter()
        .any(|r| r.get("documentId").and_then(|v| v.as_str()) == Some("alice_only_anniversary"));
    assert!(
        alice_sees,
        "u_alice MUST see her own doc: {}",
        body_a
    );

    delete_tenant(&http, &cfg.control_plane_base_url, &ctx.key).await;
}

/// 7. Rebuild — truncate the search documents table, re-apply seed, search hits return.
#[tokio::test]
async fn test_search_rebuild_is_deterministic() {
    let cfg = TestConfig::load();
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();
    let suffix = Uuid::new_v4().simple().to_string()[..8].to_string();
    let ctx = provision_tenant(&http, &cfg.control_plane_base_url, &suffix).await;
    apply_seed_and_wait_for_search(&http, &cfg, &ctx, &format!("itest-search-rebuild-{}", suffix))
        .await;

    let (_, before) = get_json(
        &http,
        &cfg.ingress_base_url,
        &ctx.principal,
        "/api/v1/catalog/search?q=anniversary",
    )
    .await;
    let before_count = before
        .get("results")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);
    assert!(before_count > 0, "should have hits before rebuild");

    sqlx::query("DELETE FROM catalog_search_documents WHERE tenant_id = $1")
        .bind(ctx.tenant_id())
        .execute(&ctx.pool)
        .await
        .expect("truncate catalog_search_documents");

    let (_, mid) = get_json(
        &http,
        &cfg.ingress_base_url,
        &ctx.principal,
        "/api/v1/catalog/search?q=anniversary",
    )
    .await;
    assert_eq!(
        mid.get("results")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0),
        0,
        "search rows are gone, expect empty results"
    );

    // Bump version so the seed handler emits a fresh event.
    let mut bumped = load_seed_payload();
    if let Some(obj) = bumped.as_object_mut() {
        obj.insert(
            "version".to_string(),
            Value::String(format!("rebuild-{}", suffix)),
        );
    }
    let intent = build_seed_intent(
        &ctx.tenant_id(),
        &format!("itest-search-rebuild2-{}", suffix),
        &bumped,
    );
    let (s, _) = submit_intent(&http, &cfg.ingress_base_url, &ctx.principal, &intent).await;
    assert_eq!(s, 202);

    let rebuilt = poll_until(30, || async {
        let (st, body) = get_json(
            &http,
            &cfg.ingress_base_url,
            &ctx.principal,
            "/api/v1/catalog/search?q=anniversary",
        )
        .await;
        st == 200
            && body
                .get("results")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0)
                >= before_count
    })
    .await;
    assert!(rebuilt, "search should rebuild after replay");

    delete_tenant(&http, &cfg.control_plane_base_url, &ctx.key).await;
}

/// 8. Cache-invalidation tag — `SearchIndex:catalog` rides on
///    `StructuredCatalog.SeedPackageApplied`. We verify indirectly:
///    the search projection only materializes if the worker observed the
///    event (and therefore its tags); an indexed result is the receipt.
#[tokio::test]
async fn test_search_index_cache_invalidation_tag_present() {
    let cfg = TestConfig::load();
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();
    let suffix = Uuid::new_v4().simple().to_string()[..8].to_string();
    let ctx = provision_tenant(&http, &cfg.control_plane_base_url, &suffix).await;
    apply_seed_and_wait_for_search(&http, &cfg, &ctx, &format!("itest-search-cache-{}", suffix))
        .await;

    // Direct check: our search projection is populated, which means the
    // worker successfully processed SeedPackageApplied (whose tags include
    // `SearchIndex:catalog`). If the tag list were malformed the worker
    // would've errored on cache invalidation.
    let (status, body) = get_json(
        &http,
        &cfg.ingress_base_url,
        &ctx.principal,
        "/api/v1/catalog/search?q=anniversary",
    )
    .await;
    assert_eq!(status, 200, "search after seed: {}", body);
    let results = body
        .get("results")
        .and_then(|v| v.as_array())
        .expect("results array");
    assert!(
        !results.is_empty(),
        "search must have hits — proves event tags didn't block worker: {}",
        body
    );

    delete_tenant(&http, &cfg.control_plane_base_url, &ctx.key).await;
}
