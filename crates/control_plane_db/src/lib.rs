//! Control Plane Database - Migrations and schema management

use anyhow::{Context, Result};
use atlas_config::require_env;
use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::Row;
use std::env;
use std::fs;
use std::path::PathBuf;

pub mod models;

pub use models::*;

/// Get database connection pool from environment.
///
/// Requires `CONTROL_PLANE_DB_URL` to be set. In strict mode (default),
/// this will fail with a clear error if not set.
pub async fn get_pool() -> Result<PgPool> {
    let database_url = require_env("CONTROL_PLANE_DB_URL").map_err(|e| {
        anyhow::anyhow!(
            "CONTROL_PLANE_DB_URL is required for database connection. {}",
            e
        )
    })?;

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .context("Failed to connect to database")?;

    Ok(pool)
}

/// Run all pending migrations
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    // Create control_plane schema if it doesn't exist
    sqlx::query("CREATE SCHEMA IF NOT EXISTS control_plane")
        .execute(pool)
        .await
        .context("Failed to create control_plane schema")?;

    // Create migrations table if it doesn't exist
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS control_plane._migrations (
            id SERIAL PRIMARY KEY,
            filename TEXT NOT NULL UNIQUE,
            executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await
    .context("Failed to create migrations table")?;

    // Find migration files
    let migrations_dir = find_migrations_dir()?;
    let mut migrations = list_migration_files(&migrations_dir)?;
    migrations.sort();

    // Get already executed migrations
    let executed: Vec<String> = sqlx::query("SELECT filename FROM control_plane._migrations")
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|row| row.get("filename"))
        .collect();

    // Execute pending migrations
    for migration_file in migrations {
        let filename = migration_file
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();

        if executed.contains(&filename) {
            tracing::info!("Skipping already executed migration: {}", filename);
            continue;
        }

        tracing::info!("Executing migration: {}", filename);
        let sql = fs::read_to_string(&migration_file)
            .with_context(|| format!("Failed to read migration file: {:?}", migration_file))?;

        // Execute migration in a transaction
        let mut tx = pool.begin().await?;

        for statement in sql.split(';').filter(|s| !s.trim().is_empty()) {
            sqlx::query(statement)
                .execute(&mut *tx)
                .await
                .with_context(|| {
                    format!("Failed to execute migration statement in {}", filename)
                })?;
        }

        // Record migration as executed
        sqlx::query("INSERT INTO control_plane._migrations (filename) VALUES ($1)")
            .bind(&filename)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        tracing::info!("Successfully executed migration: {}", filename);
    }

    Ok(())
}

fn find_migrations_dir() -> Result<PathBuf> {
    // Try relative to cargo manifest dir first
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let path = PathBuf::from(manifest_dir).join("migrations");
        if path.exists() {
            return Ok(path);
        }
    }

    // Try relative to current dir
    let path = PathBuf::from("crates/control_plane_db/migrations");
    if path.exists() {
        return Ok(path);
    }

    // Try relative to workspace root
    let path = PathBuf::from("migrations");
    if path.exists() {
        return Ok(path);
    }

    anyhow::bail!("Could not find migrations directory")
}

fn list_migration_files(dir: &PathBuf) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("sql") {
            files.push(path);
        }
    }

    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_migrations_dir() {
        // This test ensures migrations directory can be found
        let result = find_migrations_dir();
        assert!(result.is_ok(), "Should find migrations directory");
    }
}
