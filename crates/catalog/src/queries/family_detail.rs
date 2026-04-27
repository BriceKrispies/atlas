use crate::errors::{CatalogError, CatalogResult};
use serde_json::Value;
use sqlx::{PgPool, Row};

pub async fn query_family_detail(
    pool: &PgPool,
    tenant_id: &str,
    family_key: &str,
) -> CatalogResult<Option<Value>> {
    let row = sqlx::query(
        r#"
        SELECT payload
        FROM catalog_family_detail_projection
        WHERE tenant_id = $1 AND family_key = $2
        "#,
    )
    .bind(tenant_id)
    .bind(family_key)
    .fetch_optional(pool)
    .await
    .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

    Ok(row.map(|r| r.get::<Value, _>("payload")))
}
