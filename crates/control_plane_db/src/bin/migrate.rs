//! Migration runner binary

use anyhow::Result;
use atlas_platform_control_plane_db::{get_pool, run_migrations};

#[tokio::main]
async fn main() -> Result<()> {
    atlas_core::init_logging();

    tracing::info!("Starting database migrations...");

    let pool = get_pool().await?;
    run_migrations(&pool).await?;

    tracing::info!("Migrations completed successfully");

    Ok(())
}
