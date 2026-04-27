use crate::errors::{CatalogError, CatalogResult};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

pub async fn rebuild_family_detail(
    pool: &PgPool,
    tenant_id: &str,
) -> CatalogResult<Vec<(String, Value)>> {
    let families = sqlx::query(
        r#"
        SELECT id, key, family_type, name, canonical_slug, current_revision_number, published_revision_number
        FROM catalog_families WHERE tenant_id = $1
        "#,
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await
    .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

    let mut results = Vec::new();

    for fam in families {
        let family_id: uuid::Uuid = fam.get("id");
        let family_key: String = fam.get("key");
        let family_type: String = fam.get("family_type");
        let name: String = fam.get("name");
        let slug: String = fam.get("canonical_slug");
        let current_rev: i32 = fam.get("current_revision_number");
        let published_rev: Option<i32> = fam.get("published_revision_number");

        let attrs = sqlx::query(
            r#"
            SELECT a.key AS attr_key, a.data_type, fa.role, fa.required, fa.filterable,
                   fa.sortable, fa.is_variant_axis, fa.display_order
            FROM catalog_family_attributes fa
            JOIN catalog_attribute_definitions a ON a.id = fa.attribute_id
            WHERE fa.family_id = $1
            ORDER BY fa.display_order
            "#,
        )
        .bind(family_id)
        .fetch_all(pool)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

        let attr_list: Vec<Value> = attrs
            .iter()
            .map(|r| {
                json!({
                    "attributeKey": r.get::<String, _>("attr_key"),
                    "dataType": r.get::<String, _>("data_type"),
                    "role": r.get::<String, _>("role"),
                    "required": r.get::<bool, _>("required"),
                    "filterable": r.get::<bool, _>("filterable"),
                    "sortable": r.get::<bool, _>("sortable"),
                    "isVariantAxis": r.get::<bool, _>("is_variant_axis"),
                    "displayOrder": r.get::<i32, _>("display_order"),
                })
            })
            .collect();

        let display_policies = sqlx::query(
            r#"
            SELECT dp.surface, a.key AS attr_key, dp.role, dp.display_order
            FROM catalog_family_display_policies dp
            JOIN catalog_attribute_definitions a ON a.id = dp.attribute_id
            WHERE dp.family_id = $1
            ORDER BY dp.surface, dp.display_order
            "#,
        )
        .bind(family_id)
        .fetch_all(pool)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

        let dp_list: Vec<Value> = display_policies
            .iter()
            .map(|r| {
                json!({
                    "surface": r.get::<String, _>("surface"),
                    "attributeKey": r.get::<String, _>("attr_key"),
                    "role": r.get::<String, _>("role"),
                    "order": r.get::<i32, _>("display_order"),
                })
            })
            .collect();

        let assets = sqlx::query(
            r#"
            SELECT a.asset_key, a.media_type, a.uri, aa.role, aa.display_order
            FROM catalog_asset_attachments aa
            JOIN catalog_assets a ON a.id = aa.asset_id
            WHERE aa.family_id = $1
            ORDER BY aa.display_order
            "#,
        )
        .bind(family_id)
        .fetch_all(pool)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

        let asset_list: Vec<Value> = assets
            .iter()
            .map(|r| {
                json!({
                    "assetKey": r.get::<String, _>("asset_key"),
                    "mediaType": r.get::<Option<String>, _>("media_type"),
                    "uri": r.get::<Option<String>, _>("uri"),
                    "role": r.get::<String, _>("role"),
                    "order": r.get::<i32, _>("display_order"),
                })
            })
            .collect();

        let payload = json!({
            "familyId": family_id.to_string(),
            "familyKey": family_key.clone(),
            "type": family_type,
            "name": name,
            "canonicalSlug": slug,
            "currentRevision": current_rev,
            "publishedRevision": published_rev,
            "attributes": attr_list,
            "displayPolicies": dp_list,
            "assets": asset_list,
        });

        sqlx::query(
            r#"
            INSERT INTO catalog_family_detail_projection (tenant_id, family_key, family_id, payload, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (tenant_id, family_key) DO UPDATE SET
                family_id = EXCLUDED.family_id,
                payload = EXCLUDED.payload,
                updated_at = NOW()
            "#,
        )
        .bind(tenant_id)
        .bind(&family_key)
        .bind(family_id)
        .bind(&payload)
        .execute(pool)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

        results.push((family_key, payload));
    }

    Ok(results)
}
