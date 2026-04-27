use crate::errors::{CatalogError, CatalogResult};
use serde_json::Value;
use sqlx::{PgPool, Row};

pub async fn query_taxonomy_nodes(
    pool: &PgPool,
    tenant_id: &str,
    tree_key: &str,
) -> CatalogResult<Option<Value>> {
    let row = sqlx::query(
        r#"
        SELECT payload
        FROM catalog_taxonomy_navigation_projection
        WHERE tenant_id = $1 AND tree_key = $2
        "#,
    )
    .bind(tenant_id)
    .bind(tree_key)
    .fetch_optional(pool)
    .await
    .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

    Ok(row.map(|r| r.get::<Value, _>("payload")))
}
