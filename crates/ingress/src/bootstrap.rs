//! Bootstrap logic for loading configuration from Control Plane Registry

use anyhow::{Context, Result};
use atlas_core::policy::PolicyEngine;
use atlas_core::types::Policy;
use atlas_platform_adapters::PostgresControlPlaneRegistry;
use atlas_platform_runtime::ports::ControlPlaneRegistry;
use atlas_platform_runtime::registry::{ActionMetadata, ActionRegistry};
use sqlx::postgres::PgPoolOptions;
use std::env;
use std::sync::Arc;
use tracing::{info, warn};

pub struct RuntimeConfig {
    #[allow(dead_code)]
    pub action_registry: ActionRegistry,
    pub policy_engine: PolicyEngine,
    pub policies: Vec<Policy>,
    pub tenant_id: String,
}

pub async fn bootstrap_runtime() -> Result<RuntimeConfig> {
    let control_plane_enabled = env::var("CONTROL_PLANE_ENABLED")
        .unwrap_or_else(|_| "false".to_string())
        .parse::<bool>()
        .unwrap_or(false);

    if !control_plane_enabled {
        info!("Control Plane Registry not enabled, using in-memory fallback");
        return bootstrap_in_memory();
    }

    info!("Control Plane Registry enabled, bootstrapping from database...");

    let database_url = env::var("CONTROL_PLANE_DB_URL")
        .context("CONTROL_PLANE_DB_URL not set but CONTROL_PLANE_ENABLED=true")?;

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .context("Failed to connect to control plane database")?;

    let registry = Arc::new(PostgresControlPlaneRegistry::new(pool));

    // Get tenant ID from environment (in production this would come from request context)
    let tenant_id = env::var("TENANT_ID").unwrap_or_else(|_| "tenant-001".to_string());

    bootstrap_from_registry(registry, &tenant_id).await
}

async fn bootstrap_from_registry(
    registry: Arc<PostgresControlPlaneRegistry>,
    tenant_id: &str,
) -> Result<RuntimeConfig> {
    info!("Bootstrapping runtime for tenant: {}", tenant_id);

    // Verify tenant exists
    let tenant_info = registry
        .get_tenant(tenant_id)
        .await
        .context("Failed to get tenant info")?;
    info!(
        "Loaded tenant: {} (status: {})",
        tenant_info.name, tenant_info.status
    );

    if tenant_info.status != "active" {
        anyhow::bail!(
            "Tenant {} is not active (status: {})",
            tenant_id,
            tenant_info.status
        );
    }

    // Load enabled modules
    let enabled_modules = registry
        .list_enabled_modules(tenant_id)
        .await
        .context("Failed to list enabled modules")?;
    info!("Found {} enabled modules", enabled_modules.len());

    // Build action registry from enabled modules
    let mut action_registry = ActionRegistry::new();

    for module_info in &enabled_modules {
        info!(
            "Loading module: {} v{}",
            module_info.module_id, module_info.enabled_version
        );

        let manifest = registry
            .get_module_manifest(&module_info.module_id, &module_info.enabled_version)
            .await
            .with_context(|| {
                format!(
                    "Failed to load manifest for {} v{}",
                    module_info.module_id, module_info.enabled_version
                )
            })?;

        // Validate manifest (basic validation)
        if manifest.module_id != module_info.module_id {
            anyhow::bail!(
                "Manifest module_id mismatch: expected {}, got {}",
                module_info.module_id,
                manifest.module_id
            );
        }

        // Register all actions from the manifest
        for action in &manifest.actions {
            let metadata = ActionMetadata {
                module_id: manifest.module_id.clone(),
                action_id: action.action_id.clone(),
                resource_type: action.resource_type.clone(),
                verb: action.verb.clone(),
            };
            action_registry.register(metadata);
        }

        info!(
            "Registered {} actions from module {}",
            manifest.actions.len(),
            manifest.module_id
        );
    }

    // Load policy bundle
    let policies = registry
        .get_active_policy_bundle(tenant_id)
        .await
        .context("Failed to load active policy bundle")?;
    info!("Loaded {} policies", policies.len());

    let policy_engine = PolicyEngine::new();

    Ok(RuntimeConfig {
        action_registry,
        policy_engine,
        policies,
        tenant_id: tenant_id.to_string(),
    })
}

fn bootstrap_in_memory() -> Result<RuntimeConfig> {
    warn!("Using in-memory configuration (no control plane database)");

    // Create minimal action registry with sample actions
    let mut action_registry = ActionRegistry::new();

    action_registry.register(ActionMetadata {
        module_id: "content-pages".to_string(),
        action_id: "ContentPages.Page.Create".to_string(),
        resource_type: "Page".to_string(),
        verb: "create".to_string(),
    });

    // Create minimal policy engine with allow-all policy
    let policy_engine = PolicyEngine::new();
    let policies = vec![Policy {
        policy_id: "allow-all".to_string(),
        tenant_id: "default".to_string(),
        rules: vec![atlas_core::types::PolicyRule {
            rule_id: "allow-all-rule".to_string(),
            effect: atlas_core::types::PolicyEffect::Allow,
            conditions: atlas_core::types::Condition::Literal { value: true },
        }],
        version: 1,
        status: atlas_core::types::PolicyStatus::Active,
    }];

    Ok(RuntimeConfig {
        action_registry,
        policy_engine,
        policies,
        tenant_id: "default".to_string(),
    })
}
