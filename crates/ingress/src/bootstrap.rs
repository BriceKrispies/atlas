//! Bootstrap logic for loading configuration from Control Plane Registry

use crate::authn::{AuthConfig, OidcConfig};
use crate::schema::{create_default_schema_registry, SchemaRegistry};
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
    /// Authentication configuration (test auth mode, etc.)
    pub auth_config: AuthConfig,
    /// Schema registry for payload validation
    pub schema_registry: Arc<SchemaRegistry>,
}

/// Bootstrap OIDC configuration from environment variables.
///
/// Environment variables:
/// - `OIDC_ISSUER_URL`: Required issuer URL (must match `iss` claim in tokens)
/// - `OIDC_JWKS_URL`: Optional explicit JWKS URL (for Docker internal networking)
/// - `OIDC_AUDIENCE`: Required expected audience (must match `aud` claim in tokens)
///
/// Returns None if OIDC is not configured (no OIDC_ISSUER_URL set).
fn bootstrap_oidc_config() -> Option<OidcConfig> {
    let issuer_url = match env::var("OIDC_ISSUER_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => {
            info!("OIDC_ISSUER_URL not set - OIDC authentication disabled");
            return None;
        }
    };

    let audience = env::var("OIDC_AUDIENCE").unwrap_or_else(|_| {
        warn!("OIDC_AUDIENCE not set, defaulting to 'account'");
        "account".to_string()
    });

    let jwks_url = env::var("OIDC_JWKS_URL").ok().filter(|s| !s.is_empty());

    info!(
        "OIDC configured: issuer={}, audience={}, jwks_url={:?}",
        issuer_url, audience, jwks_url
    );

    let mut config = OidcConfig::new(issuer_url, audience);
    if let Some(url) = jwks_url {
        config = config.with_jwks_url(url);
    }

    Some(config)
}

/// Bootstrap authentication configuration from environment variables.
///
/// Environment variables:
/// - `TEST_AUTH_ENABLED`: Set to "true" to enable test auth mode (only works with `test-auth` feature)
/// - `DEBUG_AUTH_ENDPOINT_ENABLED`: Set to "true" to enable /debug/whoami endpoint (only works with `test-auth` feature)
/// - `OIDC_ISSUER_URL`: OIDC issuer URL for JWT validation
/// - `OIDC_JWKS_URL`: Optional explicit JWKS URL
/// - `OIDC_AUDIENCE`: Expected audience claim
///
/// # Safety
/// Test auth mode and debug endpoint are compile-time gated by the `test-auth` feature.
/// Even if env vars are set to "true", they will have no effect without the feature enabled.
pub fn bootstrap_auth_config() -> AuthConfig {
    // Load OIDC config (shared between test and non-test builds)
    let oidc_config = bootstrap_oidc_config();

    #[cfg(feature = "test-auth")]
    {
        let test_auth_enabled = env::var("TEST_AUTH_ENABLED")
            .unwrap_or_else(|_| "false".to_string())
            .parse::<bool>()
            .unwrap_or(false);

        let debug_endpoint_enabled = env::var("DEBUG_AUTH_ENDPOINT_ENABLED")
            .unwrap_or_else(|_| "false".to_string())
            .parse::<bool>()
            .unwrap_or(false);

        if test_auth_enabled {
            warn!(
                "TEST AUTH MODE ENABLED - X-Debug-Principal header will be accepted. \
                 This should NEVER be enabled in production!"
            );
        }

        if debug_endpoint_enabled {
            warn!(
                "DEBUG AUTH ENDPOINT ENABLED - /debug/whoami will expose principal info. \
                 This should NEVER be enabled in production!"
            );
        }

        let mut config = AuthConfig::new()
            .with_test_auth(test_auth_enabled)
            .with_debug_endpoint(debug_endpoint_enabled);

        if let Some(oidc) = oidc_config {
            config = config.with_oidc(oidc);
        }

        config
    }

    #[cfg(not(feature = "test-auth"))]
    {
        // When feature is not enabled, ignore the env vars entirely
        if env::var("TEST_AUTH_ENABLED").is_ok() {
            info!(
                "TEST_AUTH_ENABLED env var is set but 'test-auth' feature is not enabled. \
                 Test auth mode is disabled."
            );
        }
        if env::var("DEBUG_AUTH_ENDPOINT_ENABLED").is_ok() {
            info!(
                "DEBUG_AUTH_ENDPOINT_ENABLED env var is set but 'test-auth' feature is not enabled. \
                 Debug endpoint is disabled."
            );
        }

        let mut config = AuthConfig::new();
        if let Some(oidc) = oidc_config {
            config = config.with_oidc(oidc);
        }
        config
    }
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
    let auth_config = bootstrap_auth_config();

    // Create default schema registry (schemas could also be loaded from control plane)
    // TODO: Load schemas from control plane database when available
    let schema_registry = create_default_schema_registry();
    info!("Schema registry initialized with {} schemas", schema_registry.len());

    Ok(RuntimeConfig {
        action_registry,
        policy_engine,
        policies,
        tenant_id: tenant_id.to_string(),
        auth_config,
        schema_registry,
    })
}

fn bootstrap_in_memory() -> Result<RuntimeConfig> {
    let auth_config = bootstrap_auth_config();

    // Determine tenant behavior based on test mode
    // In production (non-test mode), we require explicit tenant configuration
    // In test mode, we allow a default tenant for development convenience
    let tenant_id = if auth_config.is_test_auth_enabled() {
        warn!(
            "Using in-memory configuration with default tenant (test mode). \
             This is only acceptable in dev/test environments."
        );
        env::var("TENANT_ID").unwrap_or_else(|_| "default".to_string())
    } else {
        // Production mode: require explicit tenant or fail fast
        match env::var("TENANT_ID") {
            Ok(tid) if !tid.is_empty() => {
                info!("Using explicit tenant from TENANT_ID environment variable");
                tid
            }
            _ => {
                // In production without control plane, we still allow operation
                // but warn that this is a degraded mode
                warn!(
                    "No TENANT_ID configured and control plane disabled. \
                     Using 'default' tenant. This should be configured explicitly in production."
                );
                "default".to_string()
            }
        }
    };

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
        tenant_id: tenant_id.clone(),
        rules: vec![atlas_core::types::PolicyRule {
            rule_id: "allow-all-rule".to_string(),
            effect: atlas_core::types::PolicyEffect::Allow,
            conditions: atlas_core::types::Condition::Literal { value: true },
        }],
        version: 1,
        status: atlas_core::types::PolicyStatus::Active,
    }];

    // Create default schema registry with test schemas
    let schema_registry = create_default_schema_registry();
    info!("Schema registry initialized with {} schemas", schema_registry.len());

    Ok(RuntimeConfig {
        action_registry,
        policy_engine,
        policies,
        tenant_id,
        auth_config,
        schema_registry,
    })
}
