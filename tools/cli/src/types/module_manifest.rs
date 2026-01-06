use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleManifest {
    pub manifest_version: u32,
    pub module_id: String,
    pub display_name: String,
    pub version: String,
    pub module_type: Vec<String>,

    #[serde(default)]
    pub capabilities: Vec<String>,

    #[serde(default)]
    pub actions: Vec<Action>,

    #[serde(default)]
    pub resources: Vec<Resource>,

    #[serde(default)]
    pub events: Events,

    #[serde(default)]
    pub projections: Vec<Projection>,

    #[serde(default)]
    pub migrations: Vec<Migration>,

    #[serde(default)]
    pub ui_routes: Vec<UiRoute>,

    #[serde(default)]
    pub jobs: Vec<Job>,

    #[serde(default)]
    pub cache_artifacts: Vec<CacheArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub action_id: String,
    pub resource_type: String,
    pub verb: String,
    pub audit_level: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_policy_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub resource_type: String,
    pub ownership: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribute_schema_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Events {
    #[serde(default)]
    pub publishes: Vec<EventContract>,

    #[serde(default)]
    pub consumes: Vec<EventContract>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventContract {
    pub event_type: String,
    pub category: String,
    pub schema_id: String,
    pub compatibility: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_hint: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub partition_key_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    pub projection_name: String,
    pub input_events: Vec<String>,
    pub output_model: String,
    pub rebuildable: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub store_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Migration {
    pub migration_id: String,
    pub applies_to: String,
    pub engine: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub order: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiRoute {
    pub route_id: String,
    pub path: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub nav_label: Option<String>,

    #[serde(default)]
    pub required_capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub job_id: String,
    pub kind: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_event: Option<String>,

    #[serde(default = "default_concurrency")]
    pub concurrency: i32,

    #[serde(default)]
    pub retry_policy: RetryPolicy,
}

fn default_concurrency() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryPolicy {
    #[serde(default = "default_max_attempts")]
    pub max_attempts: i32,

    #[serde(default = "default_backoff_seconds")]
    pub backoff_seconds: i32,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: default_max_attempts(),
            backoff_seconds: default_backoff_seconds(),
        }
    }
}

fn default_max_attempts() -> i32 {
    3
}

fn default_backoff_seconds() -> i32 {
    5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheArtifact {
    pub artifact_id: String,
    pub vary_by: Vec<String>,
    pub ttl_seconds: i32,
    pub tags: Vec<String>,
    pub privacy: String,
}

impl ModuleManifest {
    pub fn from_json(json: &str) -> Result<Self> {
        Ok(serde_json::from_str(json)?)
    }

    pub fn crate_name(&self) -> String {
        format!("atlas-module-{}", self.module_id.replace("-", "_"))
    }

    pub fn crate_path(&self) -> String {
        format!("crates/modules/{}", self.module_id)
    }
}
