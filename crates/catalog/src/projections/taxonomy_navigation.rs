use crate::errors::{CatalogError, CatalogResult};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

pub async fn rebuild_taxonomy_navigation(
    pool: &PgPool,
    tenant_id: &str,
) -> CatalogResult<Vec<(String, Value)>> {
    let trees = sqlx::query(
        "SELECT id, key, name, purpose FROM catalog_taxonomy_trees WHERE tenant_id = $1",
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

    let mut results = Vec::new();
    for tree in trees {
        let tree_id: uuid::Uuid = tree.get("id");
        let tree_key: String = tree.get("key");
        let tree_name: String = tree.get("name");
        let tree_purpose: String = tree.get("purpose");

        let nodes = sqlx::query(
            r#"
            SELECT id, key, path, name, parent_id
            FROM catalog_taxonomy_nodes
            WHERE tree_id = $1
            ORDER BY path
            "#,
        )
        .bind(tree_id)
        .fetch_all(pool)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

        let mut node_array: Vec<Value> = Vec::new();
        for node in nodes {
            let node_id: uuid::Uuid = node.get("id");
            let node_key: String = node.get("key");
            let node_path: String = node.get("path");
            let node_name: String = node.get("name");
            let parent_id: Option<uuid::Uuid> = node.get("parent_id");

            let families = sqlx::query(
                r#"
                SELECT f.key, f.name, f.canonical_slug, f.id
                FROM catalog_families f
                JOIN catalog_family_taxonomy_nodes ftn ON ftn.family_id = f.id
                WHERE ftn.taxonomy_node_id = $1
                ORDER BY f.name
                "#,
            )
            .bind(node_id)
            .fetch_all(pool)
            .await
            .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

            let family_list: Vec<Value> = families
                .iter()
                .map(|r| {
                    let fid: uuid::Uuid = r.get("id");
                    json!({
                        "familyId": fid.to_string(),
                        "familyKey": r.get::<String, _>("key"),
                        "name": r.get::<String, _>("name"),
                        "canonicalSlug": r.get::<String, _>("canonical_slug"),
                    })
                })
                .collect();

            node_array.push(json!({
                "nodeId": node_id.to_string(),
                "key": node_key,
                "path": node_path,
                "name": node_name,
                "parentId": parent_id.map(|p| p.to_string()),
                "families": family_list
            }));
        }

        let payload = json!({
            "treeId": tree_id.to_string(),
            "treeKey": tree_key.clone(),
            "name": tree_name,
            "purpose": tree_purpose,
            "nodes": node_array
        });

        sqlx::query(
            r#"
            INSERT INTO catalog_taxonomy_navigation_projection (tenant_id, tree_key, payload, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (tenant_id, tree_key) DO UPDATE SET
                payload = EXCLUDED.payload,
                updated_at = NOW()
            "#,
        )
        .bind(tenant_id)
        .bind(&tree_key)
        .bind(&payload)
        .execute(pool)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

        results.push((tree_key, payload));
    }

    Ok(results)
}
