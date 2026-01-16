//! EventEnvelope validation adapter.

use super::AdapterError;
use atlas_core::types::EventEnvelope;
use atlas_core::validation;
use serde_json::Value;

/// Validate an EventEnvelope from JSON.
///
/// 1. Deserializes JSON into EventEnvelope
/// 2. Calls atlas_core::validation::validate_event_envelope
pub fn validate_event_envelope(value: Value) -> Result<(), AdapterError> {
    // Deserialize into domain type
    let envelope: EventEnvelope = serde_json::from_value(value)
        .map_err(|e| AdapterError::Deserialize(e.to_string()))?;

    // Call core validation
    validation::validate_event_envelope(&envelope)
        .map_err(|e| AdapterError::Validation(e.to_string()))
}
