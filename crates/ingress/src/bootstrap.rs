//! Bootstrap logic for loading configuration from Control Plane Registry
//!
//! This module handles runtime configuration for the ingress service.
//! It enforces strict-by-default behavior for production safety.
//!
//! # Environment Modes
//!
//! - **Strict (default)**: All required configuration must be explicitly set.
//!   TENANT_ID is forbidden - tenant must come from request context (Host/JWT/header).
//! - **Dev (ATLAS_ENV=dev)**: Allows convenience defaults for local development.
//!   TENANT_ID can be used as a fallback for requests without tenant context.

use crate::authn::{AuthConfig, OidcConfig};
use crate::schema::{create_default_schema_registry, SchemaRegistry};
use anyhow::{Context, Result};
use atlas_config::{
    atlas_env, forbid_in_strict, get_env_optional, get_env_or_dev, is_env_enabled, log_env_mode,
    require_env, AtlasEnv,
};
use atlas_core::policy::PolicyEngine;
use atlas_core::types::Policy;
use atlas_platform_adapters::PostgresControlPlaneRegistry;
use atlas_platform_runtime::ports::ControlPlaneRegistry;
use atlas_platform_runtime::registry::{ActionMetadata, ActionRegistry};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tracing::{info, warn};

#[cfg(feature = "test-auth")]
use tracing::error;

pub struct RuntimeConfig {
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
/// - `OIDC_AUDIENCE`: Required in strict mode when OIDC is enabled
///
/// Returns None if OIDC is not configured (no OIDC_ISSUER_URL set).
fn bootstrap_oidc_config() -> Result<Option<OidcConfig>> {
    let issuer_url = match get_env_optional("OIDC_ISSUER_URL") {
        Some(url) => url,
        None => {
            info!("OIDC_ISSUER_URL not set - OIDC authentication disabled");
            return Ok(None);
        }
    };

    // When OIDC is enabled, audience is required in strict mode
    let audience = get_env_or_dev("OIDC_AUDIENCE", "account").map_err(|e| {
        anyhow::anyhow!(
            "OIDC_AUDIENCE is required when OIDC_ISSUER_URL is set. {}",
            e
        )
    })?;

    let jwks_url = get_env_optional("OIDC_JWKS_URL");

    info!(
        "OIDC configured: issuer={}, audience={}, jwks_url={:?}",
        issuer_url, audience, jwks_url
    );

    let mut config = OidcConfig::new(issuer_url, audience);
    if let Some(url) = jwks_url {
        config = config.with_jwks_url(url);
    }

    Ok(Some(config))
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
pub fn bootstrap_auth_config() -> Result<AuthConfig> {
    // Load OIDC config (shared between test and non-test builds)
    let oidc_config = bootstrap_oidc_config()?;

    #[cfg(feature = "test-auth")]
    {
        let test_auth_enabled = is_env_enabled("TEST_AUTH_ENABLED");
        let debug_endpoint_enabled = is_env_enabled("DEBUG_AUTH_ENDPOINT_ENABLED");

        if test_auth_enabled {
            if atlas_env().is_strict() {
                error!(
                    "TEST_AUTH_ENABLED=true but running in STRICT mode. \
                     Test auth should only be used with ATLAS_ENV=dev."
                );
                // We still allow it (feature gate is the real protection) but warn loudly
            }
            warn!(
                "TEST AUTH MODE ENABLED - X-Debug-Principal header will be accepted. \
                 This should NEVER be enabled in production!"
            );
        }

        if debug_endpoint_enabled {
            if atlas_env().is_strict() {
                error!(
                    "DEBUG_AUTH_ENDPOINT_ENABLED=true but running in STRICT mode. \
                     Debug endpoint should only be used with ATLAS_ENV=dev."
                );
            }
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

        Ok(config)
    }

    #[cfg(not(feature = "test-auth"))]
    {
        // When feature is not enabled, ignore the env vars entirely
        if get_env_optional("TEST_AUTH_ENABLED").is_some() {
            info!(
                "TEST_AUTH_ENABLED env var is set but 'test-auth' feature is not enabled. \
                 Test auth mode is disabled."
            );
        }
        if get_env_optional("DEBUG_AUTH_ENDPOINT_ENABLED").is_some() {
            info!(
                "DEBUG_AUTH_ENDPOINT_ENABLED env var is set but 'test-auth' feature is not enabled. \
                 Debug endpoint is disabled."
            );
        }

        let mut config = AuthConfig::new();
        if let Some(oidc) = oidc_config {
            config = config.with_oidc(oidc);
        }
        Ok(config)
    }
}

/// Resolve the tenant ID for bootstrapping.
///
/// # Strict Mode (production)
/// TENANT_ID environment variable is **forbidden**. Tenant must be resolved per-request
/// from Host header, JWT claims, or X-Tenant-ID header. This function returns an error
/// if TENANT_ID is set in strict mode.
///
/// # Dev Mode
/// TENANT_ID environment variable is allowed as a convenience fallback. If not set,
/// uses "tenant-dev" as the default. This is only for local development.
fn resolve_bootstrap_tenant() -> Result<String> {
    let env_mode = atlas_env();

    match env_mode {
        AtlasEnv::Strict => {
            // In strict mode, TENANT_ID is forbidden for bootstrap
            if let Err(e) = forbid_in_strict(
                "TENANT_ID",
                "Tenant must be resolved per-request in production (via Host/JWT/header). \
                 Set ATLAS_ENV=dev for local development with a static tenant.",
            ) {
                return Err(anyhow::anyhow!("{}", e));
            }

            // Return a placeholder - actual tenant resolution happens per-request
            // The ingress will reject requests that don't have proper tenant context
            Ok("__strict_mode_no_default_tenant__".to_string())
        }
        AtlasEnv::Dev => {
            let tenant_id =
                get_env_or_dev("TENANT_ID", "tenant-dev").expect("dev mode allows defaults");

            warn!(
                tenant_id = %tenant_id,
                "DEV MODE: Using static tenant ID for bootstrap. \
                 In production, tenant is resolved per-request."
            );

            Ok(tenant_id)
        }
    }
}

pub async fn bootstrap_runtime() -> Result<RuntimeConfig> {
    // Log the environment mode at startup
    log_env_mode();

    let control_plane_enabled = is_env_enabled("CONTROL_PLANE_ENABLED");

    if !control_plane_enabled {
        info!("Control Plane Registry not enabled, using in-memory fallback");
        return bootstrap_in_memory();
    }

    info!("Control Plane Registry enabled, bootstrapping from database...");

    // CONTROL_PLANE_DB_URL is required when control plane is enabled
    let database_url = require_env("CONTROL_PLANE_DB_URL").map_err(|e| {
        anyhow::anyhow!(
            "CONTROL_PLANE_DB_URL must be set when CONTROL_PLANE_ENABLED=true. {}",
            e
        )
    })?;

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .context("Failed to connect to control plane database")?;

    let registry = Arc::new(PostgresControlPlaneRegistry::new(pool));

    // Resolve tenant for bootstrap (strict mode will reject this path)
    let tenant_id = resolve_bootstrap_tenant()?;

    bootstrap_from_registry(registry, &tenant_id).await
}

async fn bootstrap_from_registry(
    registry: Arc<PostgresControlPlaneRegistry>,
    tenant_id: &str,
) -> Result<RuntimeConfig> {
    // In strict mode with the placeholder tenant, we can't bootstrap from registry
    // This path shouldn't be reached in production - tenant comes per-request
    if tenant_id == "__strict_mode_no_default_tenant__" {
        return Err(anyhow::anyhow!(
            "Cannot bootstrap from registry in strict mode without tenant context. \
             The ingress service in strict mode resolves tenant per-request. \
             If you need a static tenant for development, set ATLAS_ENV=dev."
        ));
    }

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
    let auth_config = bootstrap_auth_config()?;

    // Create default schema registry (schemas could also be loaded from control plane)
    let schema_registry = create_default_schema_registry();
    info!(
        "Schema registry initialized with {} schemas",
        schema_registry.len()
    );

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
    let auth_config = bootstrap_auth_config()?;
    let tenant_id = resolve_bootstrap_tenant()?;

    // In strict mode, we still allow in-memory bootstrap but warn
    if atlas_env().is_strict() && tenant_id != "__strict_mode_no_default_tenant__" {
        warn!(
            "Running in-memory mode in STRICT environment. \
             This is unusual - typically strict mode uses control plane."
        );
    }

    // Handle the strict mode placeholder
    let effective_tenant = if tenant_id == "__strict_mode_no_default_tenant__" {
        warn!(
            "STRICT MODE: No default tenant. Requests must provide tenant context \
             via Host header, JWT claims, or X-Tenant-ID header."
        );
        // Use a placeholder that will cause clear errors if accidentally used
        "__no_tenant__".to_string()
    } else {
        tenant_id
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

    action_registry.register(ActionMetadata {
        module_id: "structured-catalog".to_string(),
        action_id: "Catalog.SeedPackage.Apply".to_string(),
        resource_type: "SeedPackage".to_string(),
        verb: "apply".to_string(),
    });

    action_registry.register(ActionMetadata {
        module_id: "structured-catalog".to_string(),
        action_id: "Catalog.Family.Publish".to_string(),
        resource_type: "Family".to_string(),
        verb: "publish".to_string(),
    });

    // Create minimal policy engine with allow-all policy
    let policy_engine = PolicyEngine::new();
    let policies = vec![Policy {
        policy_id: "allow-all".to_string(),
        tenant_id: effective_tenant.clone(),
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
    info!(
        "Schema registry initialized with {} schemas",
        schema_registry.len()
    );

    Ok(RuntimeConfig {
        action_registry,
        policy_engine,
        policies,
        tenant_id: effective_tenant,
        auth_config,
        schema_registry,
    })
}
