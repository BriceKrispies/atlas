//! Postgres implementation of ControlPlaneRegistry port

#[cfg(feature = "postgres")]
use async_trait::async_trait;
#[cfg(feature = "postgres")]
use atlas_core::types::{ModuleManifest, Policy};
#[cfg(feature = "postgres")]
use atlas_platform_runtime::ports::{
    ControlPlaneRegistry, EnabledModuleInfo, PortError, PortResult, TenantInfo,
};
#[cfg(feature = "postgres")]
use sqlx::PgPool;

#[cfg(feature = "postgres")]
pub struct PostgresControlPlaneRegistry {
    pool: PgPool,
}

#[cfg(feature = "postgres")]
impl PostgresControlPlaneRegistry {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[cfg(feature = "postgres")]
#[async_trait]
impl ControlPlaneRegistry for PostgresControlPlaneRegistry {
    async fn get_tenant(&self, tenant_id: &str) -> PortResult<TenantInfo> {
        sqlx::query_as::<_, TenantInfo>(
            r#"
            SELECT tenant_id, name, status, region
            FROM control_plane.tenants
            WHERE tenant_id = $1
            "#,
        )
        .bind(tenant_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| PortError::NotFound(format!("Tenant {}: {}", tenant_id, e)))
    }

    async fn list_enabled_modules(&self, tenant_id: &str) -> PortResult<Vec<EnabledModuleInfo>> {
        sqlx::query_as::<_, EnabledModuleInfo>(
            r#"
            SELECT module_id, enabled_version, config_json
            FROM control_plane.tenant_modules
            WHERE tenant_id = $1
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| PortError::Internal(format!("Failed to list enabled modules: {}", e)))
    }

    async fn get_module_manifest(
        &self,
        module_id: &str,
        version: &str,
    ) -> PortResult<ModuleManifest> {
        #[derive(sqlx::FromRow)]
        struct ManifestRow {
            manifest_json: serde_json::Value,
        }

        let row = sqlx::query_as::<_, ManifestRow>(
            r#"
            SELECT manifest_json
            FROM control_plane.module_versions
            WHERE module_id = $1 AND version = $2
            "#,
        )
        .bind(module_id)
        .bind(version)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            PortError::NotFound(format!("Module {} version {}: {}", module_id, version, e))
        })?;

        serde_json::from_value(row.manifest_json).map_err(|e| {
            PortError::Internal(format!("Failed to deserialize module manifest: {}", e))
        })
    }

    async fn get_schema(&self, schema_id: &str, version: i32) -> PortResult<serde_json::Value> {
        #[derive(sqlx::FromRow)]
        struct SchemaRow {
            json_schema: serde_json::Value,
        }

        let row = sqlx::query_as::<_, SchemaRow>(
            r#"
            SELECT json_schema
            FROM control_plane.schema_registry
            WHERE schema_id = $1 AND version = $2
            "#,
        )
        .bind(schema_id)
        .bind(version)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            PortError::NotFound(format!("Schema {} version {}: {}", schema_id, version, e))
        })?;

        Ok(row.json_schema)
    }

    async fn get_active_policy_bundle(&self, tenant_id: &str) -> PortResult<Vec<Policy>> {
        #[derive(sqlx::FromRow)]
        struct PolicyRow {
            policy_json: serde_json::Value,
        }

        let row = sqlx::query_as::<_, PolicyRow>(
            r#"
            SELECT policy_json
            FROM control_plane.policies
            WHERE tenant_id = $1 AND status = 'active'
            ORDER BY version DESC
            LIMIT 1
            "#,
        )
        .bind(tenant_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| PortError::NotFound(format!("Active policy for {}: {}", tenant_id, e)))?;

        // Extract policies array from bundle
        let bundle = row.policy_json;
        let policies_array = bundle
            .get("policies")
            .and_then(|p| p.as_array())
            .ok_or_else(|| PortError::Internal("Policy bundle missing 'policies' array".into()))?;

        serde_json::from_value(serde_json::Value::Array(policies_array.clone()))
            .map_err(|e| PortError::Internal(format!("Failed to deserialize policies: {}", e)))
    }
}
