//! Seed database with sample data

use anyhow::{Context, Result};
use atlas_platform_control_plane_db::get_pool;
use serde_json::json;
use std::fs;

#[tokio::main]
async fn main() -> Result<()> {
    atlas_core::init_logging();

    tracing::info!("Starting database seeding...");

    let pool = get_pool().await?;

    // Insert sample tenant
    tracing::info!("Inserting sample tenant...");
    sqlx::query(
        "INSERT INTO control_plane.tenants (tenant_id, name, status, region)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id) DO NOTHING",
    )
    .bind("tenant-itest-001")
    .bind("Sample Tenant")
    .bind("active")
    .bind("us-west")
    .execute(&pool)
    .await
    .context("Failed to insert tenant")?;

    // Load module manifests. The seed registers both:
    // 1. content-pages from specs/fixtures (the canonical test fixture).
    // 2. structured-catalog from specs/modules (the real Chunk B manifest)
    //    if the file exists — without this, ingress's
    //    bootstrap_with_postgres path can't see catalog actions because
    //    they only live in the in-memory bootstrap fallback.
    let fixtures_dir = std::env::var("ATLAS_FIXTURES_DIR")
        .unwrap_or_else(|_| "../../specs/fixtures".to_string());
    let modules_dir = std::env::var("ATLAS_MODULES_DIR")
        .unwrap_or_else(|_| "../../specs/modules".to_string());

    let manifest_paths: Vec<(String, String)> = {
        let mut paths = vec![(
            "content-pages".to_string(),
            format!("{}/module_manifest__valid__content_pages.json", fixtures_dir),
        )];
        let catalog_path = format!("{}/structured-catalog/module.manifest.json", modules_dir);
        if std::path::Path::new(&catalog_path).exists() {
            paths.push(("structured-catalog".to_string(), catalog_path));
        }
        paths
    };

    for (label, manifest_path) in manifest_paths {
        tracing::info!("Loading module manifest: {}", label);
        let manifest_content = fs::read_to_string(&manifest_path)
            .with_context(|| format!("Failed to read manifest at {manifest_path}"))?;
        let mut manifest: serde_json::Value = serde_json::from_str(&manifest_content)?;

        if let Some(obj) = manifest.as_object_mut() {
            obj.retain(|k, _| !k.starts_with('$'));
        }

        let module_id = manifest["moduleId"]
            .as_str()
            .with_context(|| format!("Missing moduleId in manifest {label}"))?;
        let version = manifest["version"]
            .as_str()
            .with_context(|| format!("Missing version in manifest {label}"))?;
        let display_name = manifest["displayName"]
            .as_str()
            .with_context(|| format!("Missing displayName in manifest {label}"))?;

        let schema_hash = format!("{:x}", md5::compute(manifest_content.as_bytes()));

        tracing::info!("Inserting module: {}", module_id);
        sqlx::query(
            "INSERT INTO control_plane.modules (module_id, display_name, latest_version)
             VALUES ($1, $2, $3)
             ON CONFLICT (module_id) DO UPDATE SET
                latest_version = EXCLUDED.latest_version",
        )
        .bind(module_id)
        .bind(display_name)
        .bind(version)
        .execute(&pool)
        .await
        .context("Failed to insert module")?;

        tracing::info!("Inserting module version: {} v{}", module_id, version);
        sqlx::query(
            "INSERT INTO control_plane.module_versions (module_id, version, manifest_json, schema_hash)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (module_id, version) DO NOTHING",
        )
        .bind(module_id)
        .bind(version)
        .bind(&manifest)
        .bind(&schema_hash)
        .execute(&pool)
        .await
        .context("Failed to insert module version")?;

        tracing::info!("Enabling module for tenant: {}", module_id);
        sqlx::query(
            "INSERT INTO control_plane.tenant_modules (tenant_id, module_id, enabled_version)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, module_id) DO UPDATE SET
                enabled_version = EXCLUDED.enabled_version",
        )
        .bind("tenant-itest-001")
        .bind(module_id)
        .bind(version)
        .execute(&pool)
        .await
        .context("Failed to enable module for tenant")?;
    }

    // Insert sample schemas from specs directory
    tracing::info!("Inserting schema registry entries...");
    let schemas_dir = std::env::var("ATLAS_SCHEMAS_DIR")
        .unwrap_or_else(|_| "../../specs/schemas/contracts".to_string());
    let schema_files = vec![
        ("event_envelope", format!("{}/event_envelope.schema.json", schemas_dir)),
        ("module_manifest", format!("{}/module_manifest.schema.json", schemas_dir)),
        ("policy_ast", format!("{}/policy_ast.schema.json", schemas_dir)),
        ("cache_policy", format!("{}/cache_policy.schema.json", schemas_dir)),
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
            .execute(&pool)
            .await?;
            tracing::info!("Inserted schema: {}", schema_id);
        }
    }

    // Insert sample policy bundle
    tracing::info!("Inserting sample policy bundle...");
    let policy_bundle = json!({
        "policies": [
            {
                "policyId": "allow-all-admin",
                "tenantId": "tenant-itest-001",
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
    .bind("tenant-itest-001")
    .bind(1)
    .bind(&policy_bundle)
    .bind("active")
    .execute(&pool)
    .await
    .context("Failed to insert policy bundle")?;

    tracing::info!("Database seeding completed successfully");

    Ok(())
}
