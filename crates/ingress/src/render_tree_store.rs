//! Postgres-backed render tree persistence.
//!
//! Provides durable storage for render trees so they survive process restarts.
//! The in-memory ProjectionStore remains the fast path; this is write-through + fallback.

use serde_json::Value;
use sqlx::PgPool;
use tracing::debug;

/// Persistent render tree store backed by Postgres.
///
/// When `pool` is `None` (in-memory mode / no database), all operations are no-ops.
pub struct RenderTreeStore {
    pool: Option<PgPool>,
}

impl RenderTreeStore {
    pub fn new(pool: Option<PgPool>) -> Self {
        Self { pool }
    }

    /// Upsert a render tree for a (tenant, page) pair.
    ///
    /// On conflict (same tenant_id + page_id), the existing row is updated.
    /// If no pool is configured, this is a silent no-op.
    pub async fn upsert(
        &self,
        tenant_id: &str,
        page_id: &str,
        render_tree_json: &Value,
        plugin_id: Option<&str>,
        plugin_version: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let pool = match &self.pool {
            Some(p) => p,
            None => return Ok(()),
        };

        sqlx::query(
            r#"
            INSERT INTO control_plane.page_render_trees
                (tenant_id, page_id, render_tree_json, plugin_id, plugin_version, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (tenant_id, page_id)
            DO UPDATE SET
                render_tree_json = EXCLUDED.render_tree_json,
                plugin_id        = EXCLUDED.plugin_id,
                plugin_version   = EXCLUDED.plugin_version,
                updated_at       = NOW()
            "#,
        )
        .bind(tenant_id)
        .bind(page_id)
        .bind(render_tree_json)
        .bind(plugin_id)
        .bind(plugin_version)
        .execute(pool)
        .await?;

        debug!(tenant_id = %tenant_id, page_id = %page_id, "Render tree persisted to Postgres");
        Ok(())
    }

    /// Load a render tree from Postgres.
    ///
    /// Returns `None` if no pool is configured or the row doesn't exist.
    pub async fn get(
        &self,
        tenant_id: &str,
        page_id: &str,
    ) -> Result<Option<Value>, sqlx::Error> {
        let pool = match &self.pool {
            Some(p) => p,
            None => return Ok(None),
        };

        let row: Option<(Value,)> = sqlx::query_as(
            r#"
            SELECT render_tree_json
            FROM control_plane.page_render_trees
            WHERE tenant_id = $1 AND page_id = $2
            "#,
        )
        .bind(tenant_id)
        .bind(page_id)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|(json,)| json))
    }

    /// Whether this store has a database connection (for logging/diagnostics).
    pub fn is_connected(&self) -> bool {
        self.pool.is_some()
    }
}
