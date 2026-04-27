use crate::errors::{CatalogError, CatalogResult};
use atlas_core::types::SearchDocument;
use atlas_platform_runtime::ports::SearchProjectionTarget;
use serde_json::{json, Map, Value};
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use std::sync::Arc;

/// Rebuild search documents (one `family` doc + N `variant` docs per family)
/// for every family currently in the tenant DB.
///
/// Phase 2 chooses the conservative posture: re-derive every family on every
/// `StructuredCatalog.*` event, mirroring `family_detail::rebuild_family_detail`.
/// At badge-slice scale this is trivial; we can narrow the scope to the
/// affected family later if it ever shows up in a profile.
pub async fn rebuild_search_documents(
    pool: &PgPool,
    target: &Arc<dyn SearchProjectionTarget>,
    tenant_id: &str,
) -> CatalogResult<usize> {
    let families = sqlx::query(
        r#"
        SELECT id, key, family_type, name
        FROM catalog_families
        WHERE tenant_id = $1
        "#,
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

    let mut written = 0usize;

    for fam in families {
        let family_id: uuid::Uuid = fam.get("id");
        let family_key: String = fam.get("key");
        let family_type: String = fam.get("family_type");
        let family_name: String = fam.get("name");

        let taxonomy_path: Option<String> = sqlx::query_scalar(
            r#"
            SELECT n.path
            FROM catalog_family_taxonomy_nodes ftn
            JOIN catalog_taxonomy_nodes n ON n.id = ftn.taxonomy_node_id
            WHERE ftn.family_id = $1
            ORDER BY n.path
            LIMIT 1
            "#,
        )
        .bind(family_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

        let variants = sqlx::query(
            r#"
            SELECT id, key, name
            FROM catalog_variants
            WHERE family_id = $1
            ORDER BY key
            "#,
        )
        .bind(family_id)
        .fetch_all(pool)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

        // Delete previous family + variant rows so dropped variants don't linger.
        target
            .delete_by_document(tenant_id, "family", &family_key)
            .await
            .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;
        for v in &variants {
            let variant_key: String = v.get("key");
            target
                .delete_by_document(tenant_id, "variant", &variant_key)
                .await
                .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;
        }

        // Family doc.
        let mut family_fields: HashMap<String, Value> = HashMap::new();
        family_fields.insert("title".to_string(), Value::String(family_name.clone()));
        family_fields.insert("summary".to_string(), Value::String(String::new()));
        family_fields.insert("body_text".to_string(), Value::String(String::new()));
        if let Some(t) = &taxonomy_path {
            family_fields.insert("taxonomy_path".to_string(), Value::String(t.clone()));
        }
        family_fields.insert("family_key".to_string(), Value::String(family_key.clone()));
        family_fields.insert(
            "family_id".to_string(),
            Value::String(family_id.to_string()),
        );
        family_fields.insert(
            "family_type".to_string(),
            Value::String(family_type.clone()),
        );
        family_fields.insert("_sort".to_string(), json!({ "sortOrder": 0 }));

        let family_doc = SearchDocument {
            document_id: family_key.clone(),
            document_type: "family".to_string(),
            tenant_id: tenant_id.to_string(),
            fields: family_fields,
            permission_attributes: None,
        };
        target
            .index(&family_doc)
            .await
            .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;
        written += 1;

        for (idx, v) in variants.iter().enumerate() {
            let variant_id: uuid::Uuid = v.get("id");
            let variant_key: String = v.get("key");
            let variant_name: String = v.get("name");

            let attr_rows = sqlx::query(
                r#"
                SELECT a.key AS attr_key, vav.display_value
                FROM catalog_variant_attribute_values vav
                JOIN catalog_attribute_definitions a ON a.id = vav.attribute_id
                WHERE vav.variant_id = $1
                "#,
            )
            .bind(variant_id)
            .fetch_all(pool)
            .await
            .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

            let mut attrs_map = Map::new();
            let mut body_parts: Vec<String> = Vec::new();
            for r in &attr_rows {
                let attr_key: String = r.get("attr_key");
                let display: Option<String> = r.get("display_value");
                if let Some(d) = &display {
                    body_parts.push(d.clone());
                    attrs_map.insert(attr_key.clone(), Value::String(d.clone()));
                } else {
                    attrs_map.insert(attr_key.clone(), Value::Null);
                }
            }

            let mut variant_fields: HashMap<String, Value> = HashMap::new();
            variant_fields.insert("title".to_string(), Value::String(variant_name.clone()));
            variant_fields.insert(
                "summary".to_string(),
                Value::String(format!("{} - {}", family_name, variant_key)),
            );
            variant_fields.insert(
                "body_text".to_string(),
                Value::String(body_parts.join(" ")),
            );
            if let Some(t) = &taxonomy_path {
                variant_fields.insert("taxonomy_path".to_string(), Value::String(t.clone()));
            }
            variant_fields.insert("family_key".to_string(), Value::String(family_key.clone()));
            variant_fields.insert(
                "family_id".to_string(),
                Value::String(family_id.to_string()),
            );
            variant_fields.insert(
                "family_type".to_string(),
                Value::String(family_type.clone()),
            );
            variant_fields.insert("variant_key".to_string(), Value::String(variant_key.clone()));
            variant_fields.insert(
                "variant_id".to_string(),
                Value::String(variant_id.to_string()),
            );
            variant_fields.insert("attributes".to_string(), Value::Object(attrs_map));
            variant_fields.insert("_sort".to_string(), json!({ "sortOrder": (idx + 1) as i64 }));

            let variant_doc = SearchDocument {
                document_id: variant_key,
                document_type: "variant".to_string(),
                tenant_id: tenant_id.to_string(),
                fields: variant_fields,
                permission_attributes: None,
            };
            target
                .index(&variant_doc)
                .await
                .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;
            written += 1;
        }
    }

    Ok(written)
}
