//! Core domain types matching the JSON schemas in /specs

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Event envelope matching event_envelope.schema.json
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope {
    pub event_id: String,
    pub event_type: String,
    pub schema_id: String,
    pub schema_version: u32,
    pub occurred_at: DateTime<Utc>,
    pub tenant_id: String,
    pub correlation_id: String,
    pub idempotency_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub principal_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_invalidation_tags: Option<Vec<String>>,
    pub payload: serde_json::Value,
}

/// Module manifest matching module_manifest.schema.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleManifest {
    pub module_id: String,
    pub display_name: String,
    pub version: String,
    pub actions: Vec<ActionDeclaration>,
    pub resources: Vec<ResourceDeclaration>,
    pub events: Vec<EventDeclaration>,
    pub projections: Vec<ProjectionDeclaration>,
    pub migrations: Vec<MigrationDeclaration>,
    pub ui_routes: Vec<UiRouteDeclaration>,
    pub jobs: Vec<JobDeclaration>,
    pub cache_artifacts: Vec<CacheArtifact>,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionDeclaration {
    pub action_id: String,
    pub resource_type: String,
    pub verb: String,
    pub audit_level: AuditLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuditLevel {
    None,
    Info,
    Basic,
    Sensitive,
    FullPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDeclaration {
    pub resource_type: String,
    pub ownership: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventDeclaration {
    pub event_type: String,
    pub category: EventCategory,
    pub schema_id: String,
    pub compatibility: SchemaCompatibility,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventCategory {
    Domain,
    Integration,
    Analytics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SchemaCompatibility {
    Forward,
    Backward,
    Full,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionDeclaration {
    pub projection_name: String,
    pub input_events: Vec<String>,
    pub output_model: String,
    pub rebuildable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationDeclaration {
    pub migration_id: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiRouteDeclaration {
    pub path: String,
    pub component: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobDeclaration {
    pub job_type: String,
    pub schema_id: String,
    pub triggered_by: Vec<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheArtifact {
    pub artifact_id: String,
    pub vary_by: Vec<VaryDimension>,
    pub ttl_seconds: u32,
    pub tags: Vec<String>,
    pub privacy: PrivacyLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum VaryDimension {
    Tenant,
    Locale,
    Role,
    User,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrivacyLevel {
    Public,
    Tenant,
    User,
}

/// Policy AST matching policy_ast.schema.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    pub policy_id: String,
    pub tenant_id: String,
    pub rules: Vec<PolicyRule>,
    pub version: u32,
    pub status: PolicyStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyRule {
    pub rule_id: String,
    pub effect: PolicyEffect,
    pub conditions: Condition,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PolicyEffect {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Condition {
    Literal {
        value: bool,
    },
    And {
        operands: Vec<Condition>,
    },
    Or {
        operands: Vec<Condition>,
    },
    Not {
        operand: Box<Condition>,
    },
    Equals {
        left: Box<Condition>,
        right: Box<Condition>,
    },
    Attribute {
        path: String,
        source: AttributeSource,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AttributeSource {
    Principal,
    Resource,
    Environment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PolicyStatus {
    Active,
    Inactive,
}

/// Search document matching search_document.schema.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchDocument {
    pub document_id: String,
    pub document_type: String,
    pub tenant_id: String,
    pub fields: HashMap<String, serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_attributes: Option<PermissionAttributes>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionAttributes {
    pub allowed_principals: Vec<String>,
}

/// Analytics event matching analytics_event.schema.json
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsEvent {
    pub event_id: String,
    pub event_type: String,
    pub tenant_id: String,
    pub dimensions: HashMap<String, String>,
    pub metrics: HashMap<String, f64>,
    pub timestamp: DateTime<Utc>,
    pub schema_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_envelope_serde() {
        let envelope = EventEnvelope {
            event_id: "evt-123".to_string(),
            event_type: "Test.Event".to_string(),
            schema_id: "test.event.v1".to_string(),
            schema_version: 1,
            occurred_at: Utc::now(),
            tenant_id: "tenant-001".to_string(),
            correlation_id: "corr-123".to_string(),
            idempotency_key: "idem-123".to_string(),
            causation_id: None,
            principal_id: None,
            user_id: None,
            cache_invalidation_tags: None,
            payload: serde_json::json!({}),
        };

        let json = serde_json::to_string(&envelope).unwrap();
        let deserialized: EventEnvelope = serde_json::from_str(&json).unwrap();
        assert_eq!(envelope, deserialized);
    }
}
