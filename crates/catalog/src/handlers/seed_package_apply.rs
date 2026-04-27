use crate::domain::*;
use crate::errors::{CatalogError, CatalogResult};
use atlas_core::types::EventEnvelope;
use atlas_platform_runtime::ports::{EventStore, TenantDbProvider};
use chrono::Utc;
use serde_json::json;
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct SeedPackageApplyCommand {
    pub tenant_id: String,
    pub correlation_id: String,
    pub principal_id: Option<String>,
    pub seed_package_key: String,
    pub seed_package_version: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct SeedPackageApplyResult {
    pub event_id: String,
    pub summary: SeedSummary,
    pub family_ids: Vec<Uuid>,
    pub taxonomy_tree_keys: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct SeedSummary {
    pub taxonomy_tree_count: usize,
    pub taxonomy_node_count: usize,
    pub family_count: usize,
    pub variant_count: usize,
    pub attribute_definition_count: usize,
    pub asset_count: usize,
}

pub async fn handle_seed_package_apply(
    cmd: SeedPackageApplyCommand,
    event_store: Arc<dyn EventStore>,
    tenant_db: Arc<dyn TenantDbProvider>,
) -> CatalogResult<SeedPackageApplyResult> {
    let payload: SeedPackagePayload = serde_json::from_value(
        cmd.payload
            .get("payload")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
    )
    .map_err(|e| CatalogError::InvalidSeedPayload(format!("payload parse failed: {}", e)))?;

    let pool = tenant_db
        .get_pool(&cmd.tenant_id)
        .await
        .map_err(|e| CatalogError::TenantDbUnavailable(e.to_string()))?;

    let (summary, family_ids, taxonomy_tree_keys) =
        upsert_seed_payload(&pool, &cmd.tenant_id, &payload).await?;

    let event_id = Uuid::new_v4().to_string();
    let idempotency_key = format!(
        "catalog.seed.{}.{}.{}",
        cmd.tenant_id, cmd.seed_package_key, cmd.seed_package_version
    );

    let mut tags = vec![format!("Tenant:{}", cmd.tenant_id)];
    for tk in &taxonomy_tree_keys {
        tags.push(format!("TaxonomyTree:{}", tk));
    }
    for fid in &family_ids {
        tags.push(format!("Family:{}", fid));
    }

    let envelope = EventEnvelope {
        event_id: event_id.clone(),
        event_type: "StructuredCatalog.SeedPackageApplied".to_string(),
        schema_id: "catalog.seed_package_applied.v1".to_string(),
        schema_version: 1,
        occurred_at: Utc::now(),
        tenant_id: cmd.tenant_id.clone(),
        correlation_id: cmd.correlation_id.clone(),
        idempotency_key,
        causation_id: None,
        principal_id: cmd.principal_id.clone(),
        user_id: cmd.principal_id.clone(),
        cache_invalidation_tags: Some(tags),
        payload: json!({
            "seedPackageKey": cmd.seed_package_key,
            "seedPackageVersion": cmd.seed_package_version,
            "appliedAt": Utc::now().to_rfc3339(),
            "summary": {
                "taxonomyTreeCount": summary.taxonomy_tree_count,
                "taxonomyNodeCount": summary.taxonomy_node_count,
                "familyCount": summary.family_count,
                "variantCount": summary.variant_count,
                "attributeDefinitionCount": summary.attribute_definition_count,
                "assetCount": summary.asset_count
            }
        }),
    };

    let stored_event_id = event_store
        .append(&envelope)
        .await
        .map_err(|e| CatalogError::EventAppendFailed(e.to_string()))?;

    Ok(SeedPackageApplyResult {
        event_id: stored_event_id,
        summary,
        family_ids,
        taxonomy_tree_keys,
    })
}

async fn upsert_seed_payload(
    pool: &PgPool,
    tenant_id: &str,
    payload: &SeedPackagePayload,
) -> CatalogResult<(SeedSummary, Vec<Uuid>, Vec<String>)> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

    let mut taxonomy_node_count = 0usize;
    let mut variant_count = 0usize;
    let mut family_ids = Vec::new();
    let mut tree_keys = Vec::new();

    let mut node_id_by_key: HashMap<String, Uuid> = HashMap::new();
    let mut unit_dim_id_by_key: HashMap<String, Uuid> = HashMap::new();
    let mut attr_id_by_key: HashMap<String, Uuid> = HashMap::new();

    for tree in &payload.taxonomy_trees {
        tree_keys.push(tree.key.clone());

        let tree_id: Uuid = sqlx::query(
            r#"
            INSERT INTO catalog_taxonomy_trees (tenant_id, key, name, purpose)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name, purpose = EXCLUDED.purpose
            RETURNING id
            "#,
        )
        .bind(tenant_id)
        .bind(&tree.key)
        .bind(&tree.name)
        .bind(&tree.purpose)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| CatalogError::StorageFailed(format!("taxonomy_tree upsert: {}", e)))?
        .get("id");

        for node in &tree.nodes {
            taxonomy_node_count += 1;
            let parent_id = match &node.parent {
                Some(parent_key) => node_id_by_key.get(parent_key).copied(),
                None => None,
            };

            let node_id: Uuid = sqlx::query(
                r#"
                INSERT INTO catalog_taxonomy_nodes (tenant_id, tree_id, parent_id, key, path, name)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (tree_id, key) DO UPDATE SET
                    parent_id = EXCLUDED.parent_id,
                    path = EXCLUDED.path,
                    name = EXCLUDED.name
                RETURNING id
                "#,
            )
            .bind(tenant_id)
            .bind(tree_id)
            .bind(parent_id)
            .bind(&node.key)
            .bind(&node.path)
            .bind(&node.name)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| CatalogError::StorageFailed(format!("taxonomy_node upsert: {}", e)))?
            .get("id");

            node_id_by_key.insert(node.key.clone(), node_id);
        }
    }

    for dim in &payload.unit_dimensions {
        let id: Uuid = sqlx::query(
            r#"
            INSERT INTO catalog_unit_dimensions (tenant_id, key, base_unit)
            VALUES ($1, $2, $3)
            ON CONFLICT (tenant_id, key) DO UPDATE SET base_unit = EXCLUDED.base_unit
            RETURNING id
            "#,
        )
        .bind(tenant_id)
        .bind(&dim.key)
        .bind(&dim.base_unit)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| CatalogError::StorageFailed(format!("unit_dimension upsert: {}", e)))?
        .get("id");
        unit_dim_id_by_key.insert(dim.key.clone(), id);
    }

    for unit in &payload.units {
        let dim_id = unit_dim_id_by_key.get(&unit.dimension).copied().ok_or_else(|| {
            CatalogError::InvalidSeedPayload(format!("unknown unit dimension: {}", unit.dimension))
        })?;
        sqlx::query(
            r#"
            INSERT INTO catalog_units (tenant_id, dimension_id, key, name, symbol, to_base_multiplier)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (tenant_id, key) DO UPDATE SET
                dimension_id = EXCLUDED.dimension_id,
                name = EXCLUDED.name,
                symbol = EXCLUDED.symbol,
                to_base_multiplier = EXCLUDED.to_base_multiplier
            "#,
        )
        .bind(tenant_id)
        .bind(dim_id)
        .bind(&unit.key)
        .bind(&unit.name)
        .bind(&unit.symbol)
        .bind(unit.to_base_multiplier)
        .execute(&mut *tx)
        .await
        .map_err(|e| CatalogError::StorageFailed(format!("unit upsert: {}", e)))?;
    }

    for attr in &payload.attribute_definitions {
        let unit_dim_id = match &attr.unit_dimension {
            Some(k) => unit_dim_id_by_key.get(k).copied(),
            None => None,
        };
        let attr_id: Uuid = sqlx::query(
            r#"
            INSERT INTO catalog_attribute_definitions
                (tenant_id, key, data_type, unit_dimension_id, filterable_default, sortable_default)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (tenant_id, key) DO UPDATE SET
                data_type = EXCLUDED.data_type,
                unit_dimension_id = EXCLUDED.unit_dimension_id,
                filterable_default = EXCLUDED.filterable_default,
                sortable_default = EXCLUDED.sortable_default
            RETURNING id
            "#,
        )
        .bind(tenant_id)
        .bind(&attr.key)
        .bind(&attr.data_type)
        .bind(unit_dim_id)
        .bind(attr.filterable_default)
        .bind(attr.sortable_default)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| CatalogError::StorageFailed(format!("attribute_definition upsert: {}", e)))?
        .get("id");
        attr_id_by_key.insert(attr.key.clone(), attr_id);

        for opt in &attr.options {
            sqlx::query(
                r#"
                INSERT INTO catalog_attribute_options (tenant_id, attribute_id, key, label)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (attribute_id, key) DO UPDATE SET label = EXCLUDED.label
                "#,
            )
            .bind(tenant_id)
            .bind(attr_id)
            .bind(&opt.key)
            .bind(&opt.label)
            .execute(&mut *tx)
            .await
            .map_err(|e| CatalogError::StorageFailed(format!("attribute_option upsert: {}", e)))?;
        }
    }

    for fam in &payload.families {
        let default_node_id = node_id_by_key.get(&fam.default_taxonomy_node).copied();

        let family_id: Uuid = sqlx::query(
            r#"
            INSERT INTO catalog_families
                (tenant_id, key, family_type, name, canonical_slug, default_taxonomy_node_id, current_revision_number)
            VALUES ($1, $2, $3, $4, $5, $6, 1)
            ON CONFLICT (tenant_id, key) DO UPDATE SET
                family_type = EXCLUDED.family_type,
                name = EXCLUDED.name,
                canonical_slug = EXCLUDED.canonical_slug,
                default_taxonomy_node_id = EXCLUDED.default_taxonomy_node_id
            RETURNING id
            "#,
        )
        .bind(tenant_id)
        .bind(&fam.key)
        .bind(&fam.family_type)
        .bind(&fam.name)
        .bind(&fam.canonical_slug)
        .bind(default_node_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| CatalogError::StorageFailed(format!("family upsert: {}", e)))?
        .get("id");

        family_ids.push(family_id);

        sqlx::query(
            r#"
            INSERT INTO catalog_family_revisions (tenant_id, family_id, revision_number, status)
            VALUES ($1, $2, 1, 'draft')
            ON CONFLICT (family_id, revision_number) DO NOTHING
            "#,
        )
        .bind(tenant_id)
        .bind(family_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| CatalogError::StorageFailed(format!("family_revision insert: {}", e)))?;

        if let Some(node_id) = default_node_id {
            sqlx::query(
                r#"
                INSERT INTO catalog_family_taxonomy_nodes (family_id, taxonomy_node_id)
                VALUES ($1, $2)
                ON CONFLICT (family_id, taxonomy_node_id) DO NOTHING
                "#,
            )
            .bind(family_id)
            .bind(node_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| CatalogError::StorageFailed(format!("family_taxonomy_node insert: {}", e)))?;
        }

        for fa in &fam.attributes {
            let attr_id = attr_id_by_key.get(&fa.attribute_key).copied().ok_or_else(|| {
                CatalogError::AttributeNotFound(fa.attribute_key.clone())
            })?;
            sqlx::query(
                r#"
                INSERT INTO catalog_family_attributes
                    (tenant_id, family_id, attribute_id, role, required, filterable, sortable, is_variant_axis, display_order)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (family_id, attribute_id) DO UPDATE SET
                    role = EXCLUDED.role,
                    required = EXCLUDED.required,
                    filterable = EXCLUDED.filterable,
                    sortable = EXCLUDED.sortable,
                    is_variant_axis = EXCLUDED.is_variant_axis,
                    display_order = EXCLUDED.display_order
                "#,
            )
            .bind(tenant_id)
            .bind(family_id)
            .bind(attr_id)
            .bind(&fa.role)
            .bind(fa.required)
            .bind(fa.filterable)
            .bind(fa.sortable)
            .bind(fa.is_variant_axis)
            .bind(fa.display_order)
            .execute(&mut *tx)
            .await
            .map_err(|e| CatalogError::StorageFailed(format!("family_attribute upsert: {}", e)))?;
        }

        for fp in &fam.filter_policies {
            let attr_id = attr_id_by_key.get(&fp.attribute_key).copied().ok_or_else(|| {
                CatalogError::AttributeNotFound(fp.attribute_key.clone())
            })?;
            sqlx::query(
                r#"
                INSERT INTO catalog_family_filter_policies
                    (tenant_id, family_id, attribute_id, filter_type, operator_set, display_order)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (family_id, attribute_id) DO UPDATE SET
                    filter_type = EXCLUDED.filter_type,
                    operator_set = EXCLUDED.operator_set,
                    display_order = EXCLUDED.display_order
                "#,
            )
            .bind(tenant_id)
            .bind(family_id)
            .bind(attr_id)
            .bind(&fp.filter_type)
            .bind(&fp.operator_set)
            .bind(fp.display_order)
            .execute(&mut *tx)
            .await
            .map_err(|e| CatalogError::StorageFailed(format!("filter_policy upsert: {}", e)))?;
        }

        for sp in &fam.sort_policies {
            let attr_id = attr_id_by_key.get(&sp.attribute_key).copied().ok_or_else(|| {
                CatalogError::AttributeNotFound(sp.attribute_key.clone())
            })?;
            sqlx::query(
                r#"
                INSERT INTO catalog_family_sort_policies
                    (tenant_id, family_id, sort_key, attribute_id, direction, is_default)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (family_id, sort_key) DO UPDATE SET
                    attribute_id = EXCLUDED.attribute_id,
                    direction = EXCLUDED.direction,
                    is_default = EXCLUDED.is_default
                "#,
            )
            .bind(tenant_id)
            .bind(family_id)
            .bind(&sp.sort_key)
            .bind(attr_id)
            .bind(&sp.direction)
            .bind(sp.is_default)
            .execute(&mut *tx)
            .await
            .map_err(|e| CatalogError::StorageFailed(format!("sort_policy upsert: {}", e)))?;
        }

        for dp in &fam.display_policies {
            let attr_id = attr_id_by_key.get(&dp.attribute_key).copied().ok_or_else(|| {
                CatalogError::AttributeNotFound(dp.attribute_key.clone())
            })?;
            sqlx::query(
                r#"
                INSERT INTO catalog_family_display_policies
                    (tenant_id, family_id, surface, attribute_id, role, display_order)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (family_id, surface, attribute_id) DO UPDATE SET
                    role = EXCLUDED.role,
                    display_order = EXCLUDED.display_order
                "#,
            )
            .bind(tenant_id)
            .bind(family_id)
            .bind(&dp.surface)
            .bind(attr_id)
            .bind(&dp.role)
            .bind(dp.order)
            .execute(&mut *tx)
            .await
            .map_err(|e| CatalogError::StorageFailed(format!("display_policy upsert: {}", e)))?;
        }

        for v in &fam.variants {
            variant_count += 1;
            let variant_id: Uuid = sqlx::query(
                r#"
                INSERT INTO catalog_variants (tenant_id, family_id, key, name, revision_number)
                VALUES ($1, $2, $3, $4, 1)
                ON CONFLICT (family_id, key) DO UPDATE SET name = EXCLUDED.name
                RETURNING id
                "#,
            )
            .bind(tenant_id)
            .bind(family_id)
            .bind(&v.key)
            .bind(&v.name)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| CatalogError::StorageFailed(format!("variant upsert: {}", e)))?
            .get("id");

            for (attr_key, raw_value) in &v.values {
                let attr_id = attr_id_by_key.get(attr_key).copied().ok_or_else(|| {
                    CatalogError::AttributeNotFound(attr_key.clone())
                })?;

                let normalized = normalize_value(raw_value);
                let display = display_value(raw_value);

                sqlx::query(
                    r#"
                    INSERT INTO catalog_variant_attribute_values
                        (tenant_id, variant_id, attribute_id, raw_value, normalized_value, display_value)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (variant_id, attribute_id) DO UPDATE SET
                        raw_value = EXCLUDED.raw_value,
                        normalized_value = EXCLUDED.normalized_value,
                        display_value = EXCLUDED.display_value
                    "#,
                )
                .bind(tenant_id)
                .bind(variant_id)
                .bind(attr_id)
                .bind(raw_value)
                .bind(&normalized)
                .bind(&display)
                .execute(&mut *tx)
                .await
                .map_err(|e| CatalogError::StorageFailed(format!("variant_attr_value upsert: {}", e)))?;
            }
        }
    }

    let mut asset_count = 0usize;
    for asset in &payload.assets {
        asset_count += 1;
        sqlx::query(
            r#"
            INSERT INTO catalog_assets (tenant_id, asset_key, media_type, uri, metadata)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (tenant_id, asset_key) DO UPDATE SET
                media_type = EXCLUDED.media_type,
                uri = EXCLUDED.uri,
                metadata = EXCLUDED.metadata
            "#,
        )
        .bind(tenant_id)
        .bind(&asset.asset_key)
        .bind(&asset.media_type)
        .bind(&asset.uri)
        .bind(&asset.metadata)
        .execute(&mut *tx)
        .await
        .map_err(|e| CatalogError::StorageFailed(format!("asset upsert: {}", e)))?;
    }

    tx.commit()
        .await
        .map_err(|e| CatalogError::StorageFailed(format!("commit: {}", e)))?;

    let summary = SeedSummary {
        taxonomy_tree_count: payload.taxonomy_trees.len(),
        taxonomy_node_count,
        family_count: payload.families.len(),
        variant_count,
        attribute_definition_count: payload.attribute_definitions.len(),
        asset_count,
    };

    Ok((summary, family_ids, tree_keys))
}

fn normalize_value(raw: &serde_json::Value) -> serde_json::Value {
    if let Some(n) = raw.as_f64() {
        json!({ "normalized": n })
    } else if let Some(s) = raw.as_str() {
        json!({ "normalized": s })
    } else if let Some(b) = raw.as_bool() {
        json!({ "normalized": b })
    } else {
        json!({ "normalized": raw.clone() })
    }
}

fn display_value(raw: &serde_json::Value) -> Option<String> {
    if let Some(s) = raw.as_str() {
        Some(s.to_string())
    } else if let Some(n) = raw.as_f64() {
        Some(n.to_string())
    } else {
        Some(raw.to_string())
    }
}
