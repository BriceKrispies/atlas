//! Black-box test: per-tenant DB isolation.
//!
//! Proves that two tenants created via the control plane API end up with
//! physically separate Postgres databases. We do this by:
//!   1. Creating two tenants (`acme` and `globex`) via POST /admin/tenants.
//!      The control plane (post-Chunk-A) actually runs tenant migrations
//!      against each new DB, so we know they are reachable.
//!   2. Connecting directly to each tenant DB with the credentials returned
//!      in the control plane response.
//!   3. Creating an `_isolation_probe` table on tenant A only and inserting
//!      a row.
//!   4. Verifying the row is visible on tenant A's pool, and that the
//!      `_isolation_probe` table does NOT exist on tenant B's pool.
//!
//! This is the runtime-SQL approach (no test-fixture migration in the
//! `tenant_db` crate) — preferred per the Chunk A plan.

use harness::TestConfig;
use serde::Deserialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::Row;
use uuid::Uuid;

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
    db_name: Option<String>,
    db_host: Option<String>,
    db_port: Option<i32>,
    /// Full connection string assembled by the control plane.
    /// In dev this includes the dev credentials; in strict mode, this
    /// would normally be omitted but the test stack runs in dev mode.
    connection_string: Option<String>,
}

async fn create_tenant(
    http: &reqwest::Client,
    control_plane_base_url: &str,
    tenant_key: &str,
) -> CreateTenantResponse {
    let url = format!("{}/admin/tenants", control_plane_base_url);
    let body = serde_json::json!({
        "tenantKey": tenant_key,
        "migrate": true,
        "seed": false,
        "name": format!("Tenant {}", tenant_key),
        "region": "local",
    });

    let resp = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .expect("create_tenant request should not fail");

    let status = resp.status();
    let text = resp
        .text()
        .await
        .expect("create_tenant body should be readable");

    assert!(
        status.is_success(),
        "create_tenant for {} failed with {}: {}",
        tenant_key,
        status,
        text
    );

    serde_json::from_str(&text).unwrap_or_else(|e| {
        panic!(
            "create_tenant for {} returned non-JSON body: {} (err: {})",
            tenant_key, text, e
        )
    })
}

/// Verify that two tenants created via the control plane have isolated
/// physical databases.
#[tokio::test]
async fn test_two_tenants_have_isolated_databases() {
    let config = TestConfig::load();
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("http client");

    // Use unique suffixes so reruns against a long-lived stack don't collide.
    let suffix = Uuid::new_v4().simple().to_string();
    let acme_key = format!("acme-{}", &suffix[..8]);
    let globex_key = format!("globex-{}", &suffix[..8]);

    // 1. Create both tenants. With Chunk A wired, the create endpoint actually
    //    runs migrations against each per-tenant DB (was a NOP before).
    let acme = create_tenant(&http, &config.control_plane_base_url, &acme_key).await;
    let globex = create_tenant(&http, &config.control_plane_base_url, &globex_key).await;

    let acme_conn = acme
        .tenant
        .connection_string
        .clone()
        .expect("acme should have connection_string");
    let globex_conn = globex
        .tenant
        .connection_string
        .clone()
        .expect("globex should have connection_string");

    assert_ne!(
        acme.tenant.db_name, globex.tenant.db_name,
        "acme and globex must have distinct db_name"
    );
    assert_eq!(
        acme.tenant.db_host, globex.tenant.db_host,
        "test stack expects both tenants on the same host"
    );
    assert_eq!(
        acme.tenant.db_port, globex.tenant.db_port,
        "test stack expects both tenants on the same port"
    );

    // 2. Connect directly to each tenant DB.
    let acme_pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&acme_conn)
        .await
        .expect("acme pool connect");
    let globex_pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&globex_conn)
        .await
        .expect("globex pool connect");

    // 3. Create the probe table on acme only and insert one row.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _isolation_probe (id TEXT PRIMARY KEY)",
    )
    .execute(&acme_pool)
    .await
    .expect("create probe on acme");

    let marker = format!("marker-{}", &suffix[..8]);
    sqlx::query("INSERT INTO _isolation_probe (id) VALUES ($1)")
        .bind(&marker)
        .execute(&acme_pool)
        .await
        .expect("insert probe row on acme");

    // 4a. Row visible on acme.
    let row = sqlx::query("SELECT id FROM _isolation_probe WHERE id = $1")
        .bind(&marker)
        .fetch_one(&acme_pool)
        .await
        .expect("probe row should be visible on acme");
    let id: String = row.get("id");
    assert_eq!(id, marker, "acme should see its own marker row");

    // 4b. The _isolation_probe table itself must not exist on globex.
    //     (Stronger than "row absent" — proves these are different DBs, not
    //     the same DB filtered by some predicate.)
    let exists_row = sqlx::query(
        "SELECT EXISTS (
             SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = '_isolation_probe'
         ) AS present",
    )
    .fetch_one(&globex_pool)
    .await
    .expect("globex existence check");
    let exists: bool = exists_row.get("present");
    assert!(
        !exists,
        "globex must NOT see acme's _isolation_probe table — \
         tenant DBs are not isolated"
    );

    // Sanity: globex should have a fresh `_migrations` table from the
    //         tenant migration run (even with zero migrations applied,
    //         the bookkeeping table is created).
    let migrations_present_row = sqlx::query(
        "SELECT EXISTS (
             SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = '_migrations'
         ) AS present",
    )
    .fetch_one(&globex_pool)
    .await
    .expect("globex _migrations check");
    let migrations_present: bool = migrations_present_row.get("present");
    assert!(
        migrations_present,
        "globex should have a public._migrations table created by run_tenant_migrations"
    );

    // Clean up the probe table so reruns are clean.
    let _ = sqlx::query("DROP TABLE IF EXISTS _isolation_probe")
        .execute(&acme_pool)
        .await;

    acme_pool.close().await;
    globex_pool.close().await;

    // Best-effort tenant cleanup (dev-only DELETE endpoint). Don't fail
    // the test if cleanup fails — it's purely housekeeping.
    let _ = http
        .delete(format!(
            "{}/admin/tenants/{}",
            config.control_plane_base_url, acme_key
        ))
        .send()
        .await;
    let _ = http
        .delete(format!(
            "{}/admin/tenants/{}",
            config.control_plane_base_url, globex_key
        ))
        .send()
        .await;
}
