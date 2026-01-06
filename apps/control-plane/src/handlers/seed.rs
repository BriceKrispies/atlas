use atlas_diagnostics::tech_debt;
use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;
use serde_json::json;
use sqlx::PgPool;
use std::fs;

#[derive(Serialize)]
pub struct SeedResponse {
    pub status: String,
    pub message: String,
}

pub async fn seed_control_plane(
    State(pool): State<PgPool>,
) -> Result<Json<SeedResponse>, StatusCode> {
    match seed_database(&pool).await {
        Ok(_) => Ok(Json(SeedResponse {
            status: "success".to_string(),
            message: "Control plane database seeded successfully".to_string(),
        })),
        Err(e) => {
            tracing::error!("Failed to seed database: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

async fn seed_database(pool: &PgPool) -> anyhow::Result<()> {
    tech_debt!(
        id: "seed_database",
        component: "apps/control-plane",
        message: "Seeding database with sample data for development and testing"
    );
    sqlx::query(
        "INSERT INTO control_plane.tenants (tenant_id, name, status, region)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id) DO NOTHING",
    )
    .bind("tenant-001")
    .bind("Sample Tenant")
    .bind("active")
    .bind("us-west")
    .execute(pool)
    .await?;

    let manifest_path = "specs/fixtures/sample_module_manifest.json";
    if let Ok(manifest_content) = fs::read_to_string(manifest_path) {
        let mut manifest: serde_json::Value = serde_json::from_str(&manifest_content)?;

        if let Some(obj) = manifest.as_object_mut() {
            obj.retain(|k, _| !k.starts_with('$'));
        }

        if let (Some(module_id), Some(version), Some(display_name)) = (
            manifest["moduleId"].as_str(),
            manifest["version"].as_str(),
            manifest["displayName"].as_str(),
        ) {
            let schema_hash = format!("{:x}", md5::compute(manifest_content.as_bytes()));

            sqlx::query(
                "INSERT INTO control_plane.modules (module_id, display_name, latest_version)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (module_id) DO UPDATE SET
                    latest_version = EXCLUDED.latest_version",
            )
            .bind(module_id)
            .bind(display_name)
            .bind(version)
            .execute(pool)
            .await?;

            sqlx::query(
                "INSERT INTO control_plane.module_versions (module_id, version, manifest_json, schema_hash)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (module_id, version) DO NOTHING",
            )
            .bind(module_id)
            .bind(version)
            .bind(&manifest)
            .bind(&schema_hash)
            .execute(pool)
            .await?;

            sqlx::query(
                "INSERT INTO control_plane.tenant_modules (tenant_id, module_id, enabled_version)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (tenant_id, module_id) DO UPDATE SET
                    enabled_version = EXCLUDED.enabled_version",
            )
            .bind("tenant-001")
            .bind(module_id)
            .bind(version)
            .execute(pool)
            .await?;
        }
    }

    let schema_files = vec![
        ("event_envelope", "specs/event_envelope.schema.json"),
        ("module_manifest", "specs/module_manifest.schema.json"),
        ("policy_ast", "specs/policy_ast.schema.json"),
        ("cache_policy", "specs/cache_policy.schema.json"),
    ];

    for (schema_id, path) in schema_files {
        if let Ok(content) = fs::read_to_string(path) {
            let schema: serde_json::Value = serde_json::from_str(&content)?;
            sqlx::query(
                "INSERT INTO control_plane.schema_registry (schema_id, version, json_schema, compat_mode)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (schema_id, version) DO NOTHING",
            )
            .bind(schema_id)
            .bind(1)
            .bind(&schema)
            .bind("BACKWARD")
            .execute(pool)
            .await?;
        }
    }

    let policy_bundle = json!({
        "policies": [
            {
                "policyId": "allow-all-admin",
                "tenantId": "tenant-001",
                "rules": [{
                    "ruleId": "admin-allow-all",
                    "effect": "allow",
                    "conditions": {
                        "type": "literal",
                        "value": true
                    }
                }],
                "version": 1,
                "status": "active"
            }
        ]
    });

    sqlx::query(
        "INSERT INTO control_plane.policies (tenant_id, version, policy_json, status)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, version) DO NOTHING",
    )
    .bind("tenant-001")
    .bind(1)
    .bind(&policy_bundle)
    .bind("active")
    .execute(pool)
    .await?;

    Ok(())
}
