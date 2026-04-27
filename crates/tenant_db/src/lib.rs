//! Per-tenant database schema management.
//!
//! Each Atlas tenant has its own physical Postgres database (see migration
//! `crates/control_plane_db/migrations/20250101000003_add_tenant_db_info.sql`
//! for the per-tenant connection columns on `control_plane.tenants`).
//!
//! This crate owns the migration runner that brings a freshly-created
//! tenant database up to the current schema. The migrations themselves
//! live under `crates/tenant_db/migrations/` (Chunk A intentionally ships
//! with that directory empty — the catalog schema lands in Chunk C).
//!
//! # Naming convention
//!
//! Migrations are named `YYYYMMDDHHMMSS_description.sql` and applied in
//! lexicographic order. Tracked in a `_migrations` table in the public
//! schema of each tenant database.

use anyhow::{Context, Result};
use sqlx::postgres::PgPool;
use sqlx::Row;
use std::env;
use std::fs;
use std::path::PathBuf;

/// Run all pending tenant migrations against the supplied pool.
///
/// The pool MUST be connected to a per-tenant database (not the control
/// plane database). Idempotent: already-applied migrations are skipped.
pub async fn run_tenant_migrations(pool: &PgPool) -> Result<()> {
    // Tenant migrations live in the public schema — no schema-creation step
    // is needed (Postgres provides `public` by default).

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS public._migrations (
            id SERIAL PRIMARY KEY,
            filename TEXT NOT NULL UNIQUE,
            executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await
    .context("Failed to create tenant _migrations table")?;

    let migrations_dir = match find_migrations_dir() {
        Ok(dir) => dir,
        Err(e) => {
            // Empty / missing migrations directory is a valid state for
            // Chunk A (the catalog schema lands later). Log and return.
            tracing::warn!(
                "No tenant migrations directory found ({}). Skipping tenant migrations.",
                e
            );
            return Ok(());
        }
    };

    let mut migrations = list_migration_files(&migrations_dir)?;
    migrations.sort();

    if migrations.is_empty() {
        tracing::info!("No tenant migrations to apply (directory is empty)");
        return Ok(());
    }

    let executed: Vec<String> = sqlx::query("SELECT filename FROM public._migrations")
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|row| row.get("filename"))
        .collect();

    for migration_file in migrations {
        let filename = migration_file
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();

        if executed.contains(&filename) {
            tracing::info!("Skipping already executed tenant migration: {}", filename);
            continue;
        }

        tracing::info!("Executing tenant migration: {}", filename);
        let sql = fs::read_to_string(&migration_file).with_context(|| {
            format!("Failed to read tenant migration file: {:?}", migration_file)
        })?;

        let mut tx = pool.begin().await?;

        for statement in sql.split(';').filter(|s| !s.trim().is_empty()) {
            sqlx::query(statement)
                .execute(&mut *tx)
                .await
                .with_context(|| {
                    format!("Failed to execute tenant migration statement in {}", filename)
                })?;
        }

        sqlx::query("INSERT INTO public._migrations (filename) VALUES ($1)")
            .bind(&filename)
            .execute(&mut *tx)
            .await?;

        tx.commit().await?;

        tracing::info!("Successfully executed tenant migration: {}", filename);
    }

    Ok(())
}

fn find_migrations_dir() -> Result<PathBuf> {
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let path = PathBuf::from(manifest_dir).join("migrations");
        if path.exists() {
            return Ok(path);
        }
    }

    let path = PathBuf::from("crates/tenant_db/migrations");
    if path.exists() {
        return Ok(path);
    }

    let path = PathBuf::from("migrations");
    if path.exists() {
        return Ok(path);
    }

    anyhow::bail!("Could not find tenant migrations directory")
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
