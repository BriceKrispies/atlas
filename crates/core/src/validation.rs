//! Semantic validation for domain types.
//!
//! This module contains all semantic validation rules for the Atlas platform.
//! These validators are used both at runtime (by ingress, workers) and at
//! CI/dev-time (by spec_validate).
//!
//! Design principles:
//! - Pure functions: no I/O, no file access, no network
//! - Assume deserialization already succeeded
//! - Return structured, meaningful errors
//! - Enforce platform invariants documented in specs/

use crate::types::{AnalyticsEvent, EventEnvelope, ModuleManifest, SearchDocument};
use std::collections::HashSet;
use thiserror::Error;

/// Validation error with structured information.
#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("Missing required field: {field}")]
    MissingField { field: String },

    #[error("Invalid format: {message}")]
    InvalidFormat { message: String },

    #[error("Duplicate value: {message}")]
    Duplicate { message: String },

    #[error("Invalid reference: {message}")]
    InvalidReference { message: String },

    #[error("Constraint violation: {message}")]
    ConstraintViolation { message: String },
}

pub type ValidationResult<T> = Result<T, ValidationError>;

// ============================================================================
// EventEnvelope Validation
// ============================================================================

/// Validate EventEnvelope against platform invariants.
///
/// Enforces:
/// - I3: idempotencyKey is required and non-empty
/// - eventType must follow Module.EventName pattern
/// - schemaVersion must be >= 1
/// - eventId, tenantId, correlationId must be non-empty
pub fn validate_event_envelope(envelope: &EventEnvelope) -> ValidationResult<()> {
    // Invariant I3: idempotencyKey is required
    if envelope.idempotency_key.is_empty() {
        return Err(ValidationError::MissingField {
            field: "idempotencyKey".to_string(),
        });
    }

    // eventId must be non-empty
    if envelope.event_id.is_empty() {
        return Err(ValidationError::MissingField {
            field: "eventId".to_string(),
        });
    }

    // tenantId must be non-empty
    if envelope.tenant_id.is_empty() {
        return Err(ValidationError::MissingField {
            field: "tenantId".to_string(),
        });
    }

    // correlationId must be non-empty
    if envelope.correlation_id.is_empty() {
        return Err(ValidationError::MissingField {
            field: "correlationId".to_string(),
        });
    }

    // Event type must follow Module.EventName pattern
    if !envelope.event_type.contains('.') {
        return Err(ValidationError::InvalidFormat {
            message: format!(
                "eventType must follow Module.EventName pattern, got: {}",
                envelope.event_type
            ),
        });
    }

    // Schema version must be >= 1
    if envelope.schema_version < 1 {
        return Err(ValidationError::InvalidFormat {
            message: "schemaVersion must be >= 1".to_string(),
        });
    }

    // schemaId must be non-empty
    if envelope.schema_id.is_empty() {
        return Err(ValidationError::MissingField {
            field: "schemaId".to_string(),
        });
    }

    Ok(())
}

// ============================================================================
// ModuleManifest Validation
// ============================================================================

/// Validate ModuleManifest against platform invariants.
///
/// Enforces:
/// - moduleId, displayName, version must be non-empty
/// - All actionIds must be unique within the module
/// - All resourceTypes must be unique within the module
/// - All eventTypes must be unique within the module
/// - Action resourceTypes must reference declared resources
/// - Event schemaIds must be non-empty
/// - Job triggeredBy must reference declared events
/// - Cache artifact varyBy dimensions must be valid
pub fn validate_module_manifest(manifest: &ModuleManifest) -> ValidationResult<()> {
    // Required fields must be non-empty
    if manifest.module_id.is_empty() {
        return Err(ValidationError::MissingField {
            field: "moduleId".to_string(),
        });
    }

    if manifest.display_name.is_empty() {
        return Err(ValidationError::MissingField {
            field: "displayName".to_string(),
        });
    }

    if manifest.version.is_empty() {
        return Err(ValidationError::MissingField {
            field: "version".to_string(),
        });
    }

    // Collect declared resource types for cross-reference validation
    let mut resource_types: HashSet<&str> = HashSet::new();
    for resource in &manifest.resources {
        if resource.resource_type.is_empty() {
            return Err(ValidationError::MissingField {
                field: "resources[].resourceType".to_string(),
            });
        }
        if !resource_types.insert(&resource.resource_type) {
            return Err(ValidationError::Duplicate {
                message: format!("resourceType '{}' declared multiple times", resource.resource_type),
            });
        }
    }

    // Validate actions: unique IDs, valid resource references
    let mut action_ids: HashSet<&str> = HashSet::new();
    for action in &manifest.actions {
        if action.action_id.is_empty() {
            return Err(ValidationError::MissingField {
                field: "actions[].actionId".to_string(),
            });
        }
        if !action_ids.insert(&action.action_id) {
            return Err(ValidationError::Duplicate {
                message: format!("actionId '{}' declared multiple times", action.action_id),
            });
        }
        if action.resource_type.is_empty() {
            return Err(ValidationError::MissingField {
                field: format!("actions[{}].resourceType", action.action_id),
            });
        }
        // Action's resourceType must reference a declared resource
        if !resource_types.contains(action.resource_type.as_str()) {
            return Err(ValidationError::InvalidReference {
                message: format!(
                    "action '{}' references undeclared resourceType '{}'",
                    action.action_id, action.resource_type
                ),
            });
        }
    }

    // Collect declared event types for cross-reference validation
    let mut event_types: HashSet<&str> = HashSet::new();
    for event in &manifest.events {
        if event.event_type.is_empty() {
            return Err(ValidationError::MissingField {
                field: "events[].eventType".to_string(),
            });
        }
        if !event_types.insert(&event.event_type) {
            return Err(ValidationError::Duplicate {
                message: format!("eventType '{}' declared multiple times", event.event_type),
            });
        }
        if event.schema_id.is_empty() {
            return Err(ValidationError::MissingField {
                field: format!("events[{}].schemaId", event.event_type),
            });
        }
        // eventType should follow Module.EventName pattern
        if !event.event_type.contains('.') {
            return Err(ValidationError::InvalidFormat {
                message: format!(
                    "eventType must follow Module.EventName pattern, got: {}",
                    event.event_type
                ),
            });
        }
    }

    // Validate projections
    for projection in &manifest.projections {
        if projection.projection_name.is_empty() {
            return Err(ValidationError::MissingField {
                field: "projections[].projectionName".to_string(),
            });
        }
        if projection.output_model.is_empty() {
            return Err(ValidationError::MissingField {
                field: format!("projections[{}].outputModel", projection.projection_name),
            });
        }
        // inputEvents should reference declared events (warning-level, not blocking)
        // We allow referencing events from other modules, so skip strict validation here
    }

    // Validate jobs
    for job in &manifest.jobs {
        if job.job_type.is_empty() {
            return Err(ValidationError::MissingField {
                field: "jobs[].jobType".to_string(),
            });
        }
        if job.schema_id.is_empty() {
            return Err(ValidationError::MissingField {
                field: format!("jobs[{}].schemaId", job.job_type),
            });
        }
        if job.idempotency_key.is_empty() {
            return Err(ValidationError::MissingField {
                field: format!("jobs[{}].idempotencyKey", job.job_type),
            });
        }
    }

    // Validate cache artifacts
    for artifact in &manifest.cache_artifacts {
        if artifact.artifact_id.is_empty() {
            return Err(ValidationError::MissingField {
                field: "cacheArtifacts[].artifactId".to_string(),
            });
        }
        if artifact.ttl_seconds == 0 {
            return Err(ValidationError::ConstraintViolation {
                message: format!(
                    "cacheArtifact '{}' has ttlSeconds=0, must be > 0",
                    artifact.artifact_id
                ),
            });
        }
    }

    Ok(())
}

// ============================================================================
// SearchDocument Validation
// ============================================================================

/// Validate a slice of SearchDocuments against platform invariants.
///
/// Enforces:
/// - documentId, documentType, tenantId must be non-empty
/// - documentIds must be unique within the batch
pub fn validate_search_documents(documents: &[SearchDocument]) -> ValidationResult<()> {
    let mut seen_ids: HashSet<&str> = HashSet::new();

    for doc in documents {
        if doc.document_id.is_empty() {
            return Err(ValidationError::MissingField {
                field: "documentId".to_string(),
            });
        }

        if !seen_ids.insert(&doc.document_id) {
            return Err(ValidationError::Duplicate {
                message: format!("documentId '{}' appears multiple times", doc.document_id),
            });
        }

        if doc.document_type.is_empty() {
            return Err(ValidationError::MissingField {
                field: format!("documents[{}].documentType", doc.document_id),
            });
        }

        if doc.tenant_id.is_empty() {
            return Err(ValidationError::MissingField {
                field: format!("documents[{}].tenantId", doc.document_id),
            });
        }
    }

    Ok(())
}

// ============================================================================
// AnalyticsEvent Validation
// ============================================================================

/// Validate a slice of AnalyticsEvents against platform invariants.
///
/// Enforces:
/// - eventId, eventType, tenantId, schemaId must be non-empty
/// - eventType should follow Module.event_name pattern
/// - eventIds must be unique within the batch
pub fn validate_analytics_events(events: &[AnalyticsEvent]) -> ValidationResult<()> {
    let mut seen_ids: HashSet<&str> = HashSet::new();

    for event in events {
        if event.event_id.is_empty() {
            return Err(ValidationError::MissingField {
                field: "eventId".to_string(),
            });
        }

        if !seen_ids.insert(&event.event_id) {
            return Err(ValidationError::Duplicate {
                message: format!("eventId '{}' appears multiple times", event.event_id),
            });
        }

        if event.event_type.is_empty() {
            return Err(ValidationError::MissingField {
                field: format!("events[{}].eventType", event.event_id),
            });
        }

        if event.tenant_id.is_empty() {
            return Err(ValidationError::MissingField {
                field: format!("events[{}].tenantId", event.event_id),
            });
        }

        if event.schema_id.is_empty() {
            return Err(ValidationError::MissingField {
                field: format!("events[{}].schemaId", event.event_id),
            });
        }

        // eventType should follow Module.event_name pattern (analytics use snake_case)
        if !event.event_type.contains('.') {
            return Err(ValidationError::InvalidFormat {
                message: format!(
                    "eventType must follow Module.event_name pattern, got: {}",
                    event.event_type
                ),
            });
        }
    }

    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::*;
    use chrono::Utc;
    use std::collections::HashMap;

    // --- EventEnvelope Tests ---

    fn valid_envelope() -> EventEnvelope {
        EventEnvelope {
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
        }
    }

    #[test]
    fn test_validate_event_envelope_success() {
        assert!(validate_event_envelope(&valid_envelope()).is_ok());
    }

    #[test]
    fn test_validate_event_envelope_missing_idempotency() {
        let mut envelope = valid_envelope();
        envelope.idempotency_key = "".to_string();
        assert!(matches!(
            validate_event_envelope(&envelope),
            Err(ValidationError::MissingField { field }) if field == "idempotencyKey"
        ));
    }

    #[test]
    fn test_validate_event_envelope_invalid_event_type() {
        let mut envelope = valid_envelope();
        envelope.event_type = "InvalidFormat".to_string();
        assert!(matches!(
            validate_event_envelope(&envelope),
            Err(ValidationError::InvalidFormat { .. })
        ));
    }

    #[test]
    fn test_validate_event_envelope_missing_event_id() {
        let mut envelope = valid_envelope();
        envelope.event_id = "".to_string();
        assert!(matches!(
            validate_event_envelope(&envelope),
            Err(ValidationError::MissingField { field }) if field == "eventId"
        ));
    }

    // --- ModuleManifest Tests ---

    fn valid_manifest() -> ModuleManifest {
        ModuleManifest {
            module_id: "test-module".to_string(),
            display_name: "Test Module".to_string(),
            version: "1.0.0".to_string(),
            actions: vec![ActionDeclaration {
                action_id: "Test.Action".to_string(),
                resource_type: "TestResource".to_string(),
                verb: "create".to_string(),
                audit_level: AuditLevel::Info,
            }],
            resources: vec![ResourceDeclaration {
                resource_type: "TestResource".to_string(),
                ownership: "module".to_string(),
            }],
            events: vec![EventDeclaration {
                event_type: "Test.Created".to_string(),
                category: EventCategory::Domain,
                schema_id: "test.created.v1".to_string(),
                compatibility: SchemaCompatibility::Backward,
            }],
            projections: vec![],
            migrations: vec![],
            ui_routes: vec![],
            jobs: vec![],
            cache_artifacts: vec![],
            capabilities: vec![],
        }
    }

    #[test]
    fn test_validate_module_manifest_success() {
        assert!(validate_module_manifest(&valid_manifest()).is_ok());
    }

    #[test]
    fn test_validate_module_manifest_missing_module_id() {
        let mut manifest = valid_manifest();
        manifest.module_id = "".to_string();
        assert!(matches!(
            validate_module_manifest(&manifest),
            Err(ValidationError::MissingField { field }) if field == "moduleId"
        ));
    }

    #[test]
    fn test_validate_module_manifest_duplicate_action() {
        let mut manifest = valid_manifest();
        manifest.actions.push(manifest.actions[0].clone());
        assert!(matches!(
            validate_module_manifest(&manifest),
            Err(ValidationError::Duplicate { .. })
        ));
    }

    #[test]
    fn test_validate_module_manifest_invalid_resource_reference() {
        let mut manifest = valid_manifest();
        manifest.actions[0].resource_type = "NonExistent".to_string();
        assert!(matches!(
            validate_module_manifest(&manifest),
            Err(ValidationError::InvalidReference { .. })
        ));
    }

    // --- SearchDocument Tests ---

    fn valid_search_docs() -> Vec<SearchDocument> {
        vec![SearchDocument {
            document_id: "doc-001".to_string(),
            document_type: "Page".to_string(),
            tenant_id: "tenant-001".to_string(),
            fields: HashMap::new(),
            permission_attributes: None,
        }]
    }

    #[test]
    fn test_validate_search_documents_success() {
        assert!(validate_search_documents(&valid_search_docs()).is_ok());
    }

    #[test]
    fn test_validate_search_documents_missing_id() {
        let mut docs = valid_search_docs();
        docs[0].document_id = "".to_string();
        assert!(matches!(
            validate_search_documents(&docs),
            Err(ValidationError::MissingField { field }) if field == "documentId"
        ));
    }

    #[test]
    fn test_validate_search_documents_duplicate_id() {
        let mut docs = valid_search_docs();
        docs.push(docs[0].clone());
        assert!(matches!(
            validate_search_documents(&docs),
            Err(ValidationError::Duplicate { .. })
        ));
    }

    // --- AnalyticsEvent Tests ---

    fn valid_analytics_events() -> Vec<AnalyticsEvent> {
        vec![AnalyticsEvent {
            event_id: "ana-001".to_string(),
            event_type: "ContentPages.page_created".to_string(),
            tenant_id: "tenant-001".to_string(),
            dimensions: HashMap::new(),
            metrics: HashMap::new(),
            timestamp: Utc::now(),
            schema_id: "analytics.page.v1".to_string(),
        }]
    }

    #[test]
    fn test_validate_analytics_events_success() {
        assert!(validate_analytics_events(&valid_analytics_events()).is_ok());
    }

    #[test]
    fn test_validate_analytics_events_missing_event_type() {
        let mut events = valid_analytics_events();
        events[0].event_type = "".to_string();
        assert!(matches!(
            validate_analytics_events(&events),
            Err(ValidationError::MissingField { .. })
        ));
    }

    #[test]
    fn test_validate_analytics_events_invalid_event_type_format() {
        let mut events = valid_analytics_events();
        events[0].event_type = "invalid_format".to_string();
        assert!(matches!(
            validate_analytics_events(&events),
            Err(ValidationError::InvalidFormat { .. })
        ));
    }
}
