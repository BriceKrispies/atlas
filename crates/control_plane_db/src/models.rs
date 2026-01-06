//! Database models for control plane

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Tenant {
    pub tenant_id: String,
    pub name: String,
    pub status: String,
    pub region: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Module {
    pub module_id: String,
    pub display_name: String,
    pub latest_version: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ModuleVersion {
    pub module_id: String,
    pub version: String,
    pub manifest_json: JsonValue,
    pub schema_hash: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TenantModule {
    pub tenant_id: String,
    pub module_id: String,
    pub enabled_version: String,
    pub enabled_at: DateTime<Utc>,
    pub config_json: Option<JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SchemaRegistryEntry {
    pub schema_id: String,
    pub version: i32,
    pub json_schema: JsonValue,
    pub compat_mode: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PolicyBundle {
    pub tenant_id: String,
    pub version: i32,
    pub policy_json: JsonValue,
    pub status: String,
    pub created_at: DateTime<Utc>,
}
