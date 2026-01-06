//! Schema validation helpers for domain types.

use crate::types::EventEnvelope;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ValidationError {
    #[error("Missing required field: {field}")]
    MissingField { field: String },
    #[error("Invalid format: {message}")]
    InvalidFormat { message: String },
    #[error("Schema validation failed: {message}")]
    SchemaValidation { message: String },
}

pub type ValidationResult<T> = Result<T, ValidationError>;

/// Validate EventEnvelope against spec invariants
pub fn validate_event_envelope(envelope: &EventEnvelope) -> ValidationResult<()> {
    // Invariant I3: idempotencyKey is required
    if envelope.idempotency_key.is_empty() {
        return Err(ValidationError::MissingField {
            field: "idempotencyKey".to_string(),
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

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn test_validate_event_envelope_success() {
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

        assert!(validate_event_envelope(&envelope).is_ok());
    }

    #[test]
    fn test_validate_event_envelope_missing_idempotency() {
        let envelope = EventEnvelope {
            event_id: "evt-123".to_string(),
            event_type: "Test.Event".to_string(),
            schema_id: "test.event.v1".to_string(),
            schema_version: 1,
            occurred_at: Utc::now(),
            tenant_id: "tenant-001".to_string(),
            correlation_id: "corr-123".to_string(),
            idempotency_key: "".to_string(),
            causation_id: None,
            principal_id: None,
            user_id: None,
            cache_invalidation_tags: None,
            payload: serde_json::json!({}),
        };

        assert!(validate_event_envelope(&envelope).is_err());
    }

    #[test]
    fn test_validate_event_envelope_invalid_event_type() {
        let envelope = EventEnvelope {
            event_id: "evt-123".to_string(),
            event_type: "InvalidFormat".to_string(),
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

        assert!(validate_event_envelope(&envelope).is_err());
    }
}
