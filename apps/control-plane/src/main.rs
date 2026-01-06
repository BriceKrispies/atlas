mod handlers;

use anyhow::Result;
use atlas_platform_control_plane_db::get_pool;
use axum::{
    routing::{delete, get, post},
    Router,
};
use std::env;
use std::net::SocketAddr;
use tower_http::trace::TraceLayer;

#[tokio::main]
async fn main() -> Result<()> {
    atlas_core::init_observability();

    let port = env::var("PORT")
        .unwrap_or_else(|_| "8000".to_string())
        .parse::<u16>()?;

    let pool = get_pool().await?;

    let app = Router::new()
        .route("/healthz", get(handlers::health_check))
        .route("/readyz", get(handlers::health_check))
        .route("/admin/seed", post(handlers::seed_control_plane))
        .route("/admin/tenants", post(handlers::create_tenant))
        .route("/admin/tenants/:tenant_key", get(handlers::get_tenant))
        .route(
            "/admin/tenants/:tenant_key",
            delete(handlers::delete_tenant),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(pool);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Control plane API listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
