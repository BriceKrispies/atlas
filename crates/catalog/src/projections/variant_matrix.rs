use crate::errors::{CatalogError, CatalogResult};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::collections::BTreeMap;

pub async fn rebuild_variant_matrix(
    pool: &PgPool,
    tenant_id: &str,
) -> CatalogResult<Vec<(String, Value)>> {
    let families = sqlx::query("SELECT id, key FROM catalog_families WHERE tenant_id = $1")
        .bind(tenant_id)
        .fetch_all(pool)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

    let mut results = Vec::new();

    for fam in families {
        let family_id: uuid::Uuid = fam.get("id");
        let family_key: String = fam.get("key");

        let variants = sqlx::query(
            r#"
            SELECT id, key, name, revision_number
            FROM catalog_variants
            WHERE family_id = $1
            ORDER BY key
            "#,
        )
        .bind(family_id)
        .fetch_all(pool)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

        let mut variant_rows: Vec<Value> = Vec::new();
        let mut facet_buckets: BTreeMap<String, BTreeMap<String, u32>> = BTreeMap::new();

        for v in variants {
            let variant_id: uuid::Uuid = v.get("id");
            let variant_key: String = v.get("key");
            let variant_name: String = v.get("name");
            let revision: i32 = v.get("revision_number");

            let values = sqlx::query(
                r#"
                SELECT a.key AS attr_key, vav.raw_value, vav.normalized_value, vav.display_value
                FROM catalog_variant_attribute_values vav
                JOIN catalog_attribute_definitions a ON a.id = vav.attribute_id
                WHERE vav.variant_id = $1
                "#,
            )
            .bind(variant_id)
            .fetch_all(pool)
            .await
            .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

            let mut value_map = serde_json::Map::new();
            for r in &values {
                let attr_key: String = r.get("attr_key");
                let raw: Value = r.get("raw_value");
                let normalized: Option<Value> = r.get("normalized_value");
                let display: Option<String> = r.get("display_value");

                value_map.insert(
                    attr_key.clone(),
                    json!({
                        "raw": raw.clone(),
                        "normalized": normalized
                            .as_ref()
                            .and_then(|n| n.get("normalized").cloned())
                            .unwrap_or(raw.clone()),
                        "display": display,
                    }),
                );

                let facet_key = if let Some(s) = raw.as_str() {
                    Some(s.to_string())
                } else if raw.is_number() {
                    Some(raw.to_string())
                } else if let Some(b) = raw.as_bool() {
                    Some(b.to_string())
                } else {
                    None
                };
                if let Some(fk) = facet_key {
                    *facet_buckets
                        .entry(attr_key)
                        .or_default()
                        .entry(fk)
                        .or_insert(0) += 1;
                }
            }

            variant_rows.push(json!({
                "variantId": variant_id.to_string(),
                "variantKey": variant_key,
                "name": variant_name,
                "revision": revision,
                "values": value_map,
            }));
        }

        let mut facets_json = serde_json::Map::new();
        for (attr, buckets) in facet_buckets {
            let arr: Vec<Value> = buckets
                .into_iter()
                .map(|(k, c)| json!({ "value": k, "count": c }))
                .collect();
            facets_json.insert(attr, Value::Array(arr));
        }

        let payload = json!({
            "familyId": family_id.to_string(),
            "familyKey": family_key.clone(),
            "rows": variant_rows,
            "facets": facets_json,
        });

        sqlx::query(
            r#"
            INSERT INTO catalog_variant_matrix_projection
                (tenant_id, family_key, family_id, payload, filter_facets_json, updated_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            ON CONFLICT (tenant_id, family_key) DO UPDATE SET
                family_id = EXCLUDED.family_id,
                payload = EXCLUDED.payload,
                filter_facets_json = EXCLUDED.filter_facets_json,
                updated_at = NOW()
            "#,
        )
        .bind(tenant_id)
        .bind(&family_key)
        .bind(family_id)
        .bind(&payload)
        .bind(&payload.get("facets").cloned().unwrap_or(Value::Null))
        .execute(pool)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

        results.push((family_key, payload));
    }

    Ok(results)
}
