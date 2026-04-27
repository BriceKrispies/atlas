use crate::errors::{CatalogError, CatalogResult};
use atlas_core::types::EventEnvelope;
use atlas_platform_runtime::ports::{EventStore, TenantDbProvider};
use chrono::Utc;
use serde_json::json;
use sqlx::Row;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct FamilyPublishCommand {
    pub tenant_id: String,
    pub correlation_id: String,
    pub principal_id: Option<String>,
    pub family_key: String,
    pub family_revision_number: i32,
}

#[derive(Debug, Clone)]
pub struct FamilyPublishResult {
    pub event_id: String,
    pub family_id: Uuid,
    pub variant_event_ids: Vec<String>,
}

pub async fn handle_family_publish(
    cmd: FamilyPublishCommand,
    event_store: Arc<dyn EventStore>,
    tenant_db: Arc<dyn TenantDbProvider>,
) -> CatalogResult<FamilyPublishResult> {
    let pool = tenant_db
        .get_pool(&cmd.tenant_id)
        .await
        .map_err(|e| CatalogError::TenantDbUnavailable(e.to_string()))?;

    let family_row = sqlx::query("SELECT id FROM catalog_families WHERE tenant_id = $1 AND key = $2")
        .bind(&cmd.tenant_id)
        .bind(&cmd.family_key)
        .fetch_optional(&pool)
        .await
        .map_err(|e| CatalogError::StorageFailed(e.to_string()))?
        .ok_or_else(|| CatalogError::FamilyNotFound(cmd.family_key.clone()))?;
    let family_id: Uuid = family_row.get("id");

    let updated = sqlx::query(
        r#"
        UPDATE catalog_family_revisions
        SET status = 'published', published_at = NOW()
        WHERE family_id = $1 AND revision_number = $2
        RETURNING id
        "#,
    )
    .bind(family_id)
    .bind(cmd.family_revision_number)
    .fetch_optional(&pool)
    .await
    .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

    if updated.is_none() {
        return Err(CatalogError::FamilyRevisionNotFound {
            family: cmd.family_key.clone(),
            revision: cmd.family_revision_number,
        });
    }

    sqlx::query(
        "UPDATE catalog_families SET published_revision_number = $1 WHERE id = $2",
    )
    .bind(cmd.family_revision_number)
    .bind(family_id)
    .execute(&pool)
    .await
    .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

    let event_id = Uuid::new_v4().to_string();
    let idempotency_key = format!(
        "catalog.family.publish.{}.{}.{}",
        cmd.tenant_id, cmd.family_key, cmd.family_revision_number
    );

    let envelope = EventEnvelope {
        event_id: event_id.clone(),
        event_type: "StructuredCatalog.FamilyPublished".to_string(),
        schema_id: "catalog.family_published.v1".to_string(),
        schema_version: 1,
        occurred_at: Utc::now(),
        tenant_id: cmd.tenant_id.clone(),
        correlation_id: cmd.correlation_id.clone(),
        idempotency_key,
        causation_id: None,
        principal_id: cmd.principal_id.clone(),
        user_id: cmd.principal_id.clone(),
        cache_invalidation_tags: Some(vec![
            format!("Tenant:{}", cmd.tenant_id),
            format!("Family:{}", family_id),
        ]),
        payload: json!({
            "familyKey": cmd.family_key,
            "familyId": family_id.to_string(),
            "revisionNumber": cmd.family_revision_number,
            "publishedAt": Utc::now().to_rfc3339()
        }),
    };

    let stored_event_id = event_store
        .append(&envelope)
        .await
        .map_err(|e| CatalogError::EventAppendFailed(e.to_string()))?;

    let variant_rows = sqlx::query(
        r#"
        SELECT v.id, v.key,
               (SELECT COUNT(*) FROM catalog_variant_attribute_values WHERE variant_id = v.id) AS attr_count
        FROM catalog_variants v
        WHERE v.family_id = $1
        "#,
    )
    .bind(family_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| CatalogError::StorageFailed(e.to_string()))?;

    let mut variant_event_ids = Vec::new();
    for row in variant_rows {
        let variant_id: Uuid = row.get("id");
        let variant_key: String = row.get("key");
        let attr_count: i64 = row.get("attr_count");

        let v_event_id = Uuid::new_v4().to_string();
        let v_idempotency = format!(
            "catalog.variant.upserted.{}.{}.{}.{}",
            cmd.tenant_id, cmd.family_key, variant_key, cmd.family_revision_number
        );
        let v_envelope = EventEnvelope {
            event_id: v_event_id.clone(),
            event_type: "StructuredCatalog.VariantUpserted".to_string(),
            schema_id: "catalog.variant_upserted.v1".to_string(),
            schema_version: 1,
            occurred_at: Utc::now(),
            tenant_id: cmd.tenant_id.clone(),
            correlation_id: cmd.correlation_id.clone(),
            idempotency_key: v_idempotency,
            causation_id: Some(stored_event_id.clone()),
            principal_id: cmd.principal_id.clone(),
            user_id: cmd.principal_id.clone(),
            cache_invalidation_tags: Some(vec![
                format!("Tenant:{}", cmd.tenant_id),
                format!("Family:{}", family_id),
            ]),
            payload: json!({
                "familyKey": cmd.family_key,
                "familyId": family_id.to_string(),
                "variantKey": variant_key,
                "variantId": variant_id.to_string(),
                "revisionNumber": cmd.family_revision_number,
                "attributeValuesCount": attr_count as i32,
                "upsertedAt": Utc::now().to_rfc3339()
            }),
        };
        let stored = event_store
            .append(&v_envelope)
            .await
            .map_err(|e| CatalogError::EventAppendFailed(e.to_string()))?;
        variant_event_ids.push(stored);
    }

    Ok(FamilyPublishResult {
        event_id: stored_event_id,
        family_id,
        variant_event_ids,
    })
}
