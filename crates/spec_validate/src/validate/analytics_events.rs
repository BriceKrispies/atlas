//! AnalyticsEvents validation adapter.

use super::AdapterError;
use atlas_core::types::AnalyticsEvent;
use atlas_core::validation;
use serde_json::Value;

/// Validate AnalyticsEvents from JSON.
///
/// Expects JSON with an `events` array field:
/// ```json
/// { "events": [ ... ] }
/// ```
///
/// 1. Extracts the `events` array
/// 2. Deserializes into Vec<AnalyticsEvent>
/// 3. Calls atlas_core::validation::validate_analytics_events
pub fn validate_analytics_events(value: Value) -> Result<(), AdapterError> {
    // Extract events array from wrapper object
    let events_value = match value {
        Value::Object(mut obj) => obj.remove("events").ok_or_else(|| {
            AdapterError::Deserialize("Missing 'events' field".to_string())
        })?,
        Value::Array(_) => {
            // Allow bare array for flexibility
            value
        }
        _ => {
            return Err(AdapterError::Deserialize(
                "Expected object with 'events' field or array".to_string(),
            ));
        }
    };

    // Deserialize into domain type
    let events: Vec<AnalyticsEvent> = serde_json::from_value(events_value)
        .map_err(|e| AdapterError::Deserialize(e.to_string()))?;

    // Call core validation
    validation::validate_analytics_events(&events)
        .map_err(|e| AdapterError::Validation(e.to_string()))
}
