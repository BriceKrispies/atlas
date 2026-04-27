use anyhow::Context;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::env;

#[derive(Deserialize)]
pub struct CreateTenantRequest {
    #[serde(rename = "tenantKey")]
    pub tenant_key: String,
    #[serde(default = "default_true")]
    pub migrate: bool,
    #[serde(default = "default_true")]
    pub seed: bool,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub region: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize)]
pub struct TenantResponse {
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub region: Option<String>,
    pub db_name: Option<String>,
    pub db_host: Option<String>,
    pub db_port: Option<i32>,
    pub connection_string: Option<String>,
}

#[derive(Serialize)]
pub struct CreateTenantResponse {
    pub status: String,
    pub tenant: TenantResponse,
}

pub async fn create_tenant(
    State(pool): State<PgPool>,
    Json(req): Json<CreateTenantRequest>,
) -> Result<Json<CreateTenantResponse>, StatusCode> {
    let tenant_id = req.tenant_key.clone();
    let name = req
        .name
        .clone()
        .unwrap_or_else(|| format!("Tenant {}", tenant_id));
    let region = req.region.clone().unwrap_or_else(|| "local".to_string());

    let db_host = env::var("DEV_DB_HOST").unwrap_or_else(|_| "localhost".to_string());
    let db_port: i32 = env::var("DEV_DB_PORT")
        .unwrap_or_else(|_| "5432".to_string())
        .parse()
        .unwrap_or(5432);
    let db_name = format!("tenant_{}", tenant_id.replace("-", "_"));
    let db_user = env::var("POSTGRES_USER").unwrap_or_else(|_| "atlas_platform".to_string());
    let db_password =
        env::var("POSTGRES_PASSWORD").unwrap_or_else(|_| "local_dev_password".to_string());

    match create_tenant_internal(
        &pool,
        &tenant_id,
        &name,
        &region,
        &db_host,
        db_port,
        &db_name,
        &db_user,
        &db_password,
        req.migrate,
        req.seed,
    )
    .await
    {
        Ok(tenant) => Ok(Json(CreateTenantResponse {
            status: "created".to_string(),
            tenant,
        })),
        Err(e) => {
            tracing::error!("Failed to create tenant: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn get_tenant(
    State(pool): State<PgPool>,
    Path(tenant_key): Path<String>,
) -> Result<Json<TenantResponse>, StatusCode> {
    match fetch_tenant(&pool, &tenant_key).await {
        Ok(Some(tenant)) => Ok(Json(tenant)),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to fetch tenant: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn delete_tenant(
    State(pool): State<PgPool>,
    Path(tenant_key): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let is_dev = env::var("ENVIRONMENT")
        .unwrap_or_else(|_| "dev".to_string())
        .to_lowercase()
        == "dev";

    if !is_dev {
        tracing::error!("Tenant deletion is only allowed in dev environment");
        return Err(StatusCode::FORBIDDEN);
    }

    match delete_tenant_internal(&pool, &tenant_key).await {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => {
            tracing::error!("Failed to delete tenant: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn create_tenant_internal(
    pool: &PgPool,
    tenant_id: &str,
    name: &str,
    region: &str,
    db_host: &str,
    db_port: i32,
    db_name: &str,
    db_user: &str,
    db_password: &str,
    migrate: bool,
    seed: bool,
) -> anyhow::Result<TenantResponse> {
    let existing = sqlx::query_as::<_, (String,)>(
        "SELECT tenant_id FROM control_plane.tenants WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;

    if existing.is_some() {
        tracing::info!("Tenant {} already exists, skipping creation", tenant_id);
        return fetch_tenant(pool, tenant_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Tenant not found after check"));
    }

    tracing::info!("Creating tenant database: {}", db_name);
    create_database(db_host, db_port, db_user, db_password, db_name).await?;

    sqlx::query(
        "INSERT INTO control_plane.tenants
         (tenant_id, name, status, region, db_host, db_port, db_name, db_user, db_password)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(tenant_id)
    .bind(name)
    .bind("active")
    .bind(region)
    .bind(db_host)
    .bind(db_port)
    .bind(db_name)
    .bind(db_user)
    .bind(db_password)
    .execute(pool)
    .await?;

    if migrate {
        tracing::info!("Running migrations for tenant database: {}", db_name);
        run_tenant_migrations(db_host, db_port, db_user, db_password, db_name).await?;
    }

    if seed {
        tracing::info!("Seeding tenant database: {}", db_name);
        seed_tenant_database(db_host, db_port, db_user, db_password, db_name).await?;
    }

    fetch_tenant(pool, tenant_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Tenant not found after creation"))
}

async fn fetch_tenant(pool: &PgPool, tenant_id: &str) -> anyhow::Result<Option<TenantResponse>> {
    let row = sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>, Option<String>, Option<i32>)>(
        "SELECT tenant_id, name, status, region, db_name, db_host, db_port
         FROM control_plane.tenants
         WHERE tenant_id = $1"
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(
        |(tenant_id, name, status, region, db_name, db_host, db_port)| {
            let connection_string = if let (Some(ref host), Some(port), Some(ref db)) =
                (&db_host, db_port, &db_name)
            {
                let user =
                    env::var("POSTGRES_USER").unwrap_or_else(|_| "atlas_platform".to_string());
                let password = env::var("POSTGRES_PASSWORD")
                    .unwrap_or_else(|_| "local_dev_password".to_string());
                Some(format!(
                    "postgres://{}:{}@{}:{}/{}",
                    user, password, host, port, db
                ))
            } else {
                None
            };

            TenantResponse {
                tenant_id,
                name,
                status,
                region,
                db_name,
                db_host,
                db_port,
                connection_string,
            }
        },
    ))
}

async fn delete_tenant_internal(pool: &PgPool, tenant_id: &str) -> anyhow::Result<()> {
    let tenant = fetch_tenant(pool, tenant_id).await?;

    if let Some(tenant) = tenant {
        if let (Some(db_name), Some(db_host), Some(db_port)) =
            (tenant.db_name, tenant.db_host, tenant.db_port)
        {
            let db_user =
                env::var("POSTGRES_USER").unwrap_or_else(|_| "atlas_platform".to_string());
            let db_password = env::var("POSTGRES_PASSWORD")
                .unwrap_or_else(|_| "local_dev_password".to_string());

            tracing::info!("Dropping tenant database: {}", db_name);
            drop_database(&db_host, db_port, &db_user, &db_password, &db_name).await?;
        }

        sqlx::query("DELETE FROM control_plane.tenants WHERE tenant_id = $1")
            .bind(tenant_id)
            .execute(pool)
            .await?;
    }

    Ok(())
}

async fn create_database(
    host: &str,
    port: i32,
    user: &str,
    password: &str,
    db_name: &str,
) -> anyhow::Result<()> {
    let admin_url = format!("postgres://{}:{}@{}:{}/postgres", user, password, host, port);
    let admin_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&admin_url)
        .await?;

    let query = format!("CREATE DATABASE \"{}\"", db_name);
    sqlx::query(&query).execute(&admin_pool).await.ok();

    admin_pool.close().await;

    Ok(())
}

async fn drop_database(
    host: &str,
    port: i32,
    user: &str,
    password: &str,
    db_name: &str,
) -> anyhow::Result<()> {
    let admin_url = format!("postgres://{}:{}@{}:{}/postgres", user, password, host, port);
    let admin_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&admin_url)
        .await?;

    sqlx::query(&format!(
        "SELECT pg_terminate_backend(pg_stat_activity.pid)
         FROM pg_stat_activity
         WHERE pg_stat_activity.datname = '{}'
         AND pid <> pg_backend_pid()",
        db_name
    ))
    .execute(&admin_pool)
    .await?;

    let query = format!("DROP DATABASE IF EXISTS \"{}\"", db_name);
    sqlx::query(&query).execute(&admin_pool).await?;

    admin_pool.close().await;

    Ok(())
}

/// Bring the freshly-created tenant database up to the current schema by
/// running every migration under `crates/tenant_db/migrations/`.
///
/// Connects directly to the per-tenant DB (we have its credentials in scope
/// since we just created the row) and delegates the actual migration loop
/// to `atlas_platform_tenant_db::run_tenant_migrations`. Idempotent.
async fn run_tenant_migrations(
    host: &str,
    port: i32,
    user: &str,
    password: &str,
    db_name: &str,
) -> anyhow::Result<()> {
    let conn_str = format!(
        "postgres://{}:{}@{}:{}/{}",
        user, password, host, port, db_name
    );

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&conn_str)
        .await
        .with_context(|| format!("Failed to connect to tenant DB {}", db_name))?;

    atlas_platform_tenant_db::run_tenant_migrations(&pool)
        .await
        .with_context(|| format!("Failed to run tenant migrations against {}", db_name))?;

    pool.close().await;
    Ok(())
}

/// Seed the tenant database with default rows.
///
/// Currently a no-op: seeding is deferred to Chunk C, which lands the
/// catalog schema and its associated default rows. Kept as a function so
/// the call site in `create_tenant_internal` doesn't need to change when
/// real seeding arrives.
async fn seed_tenant_database(
    _host: &str,
    _port: i32,
    _user: &str,
    _password: &str,
    _db_name: &str,
) -> anyhow::Result<()> {
    tracing::info!("Tenant seeding is a no-op in Chunk A; real seeding lands in Chunk C");
    Ok(())
}
