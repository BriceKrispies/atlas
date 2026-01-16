//! Validation adapters.
//!
//! Each adapter deserializes JSON into atlas_core domain types and calls
//! the corresponding validation function. Adapters contain NO domain logic.

mod analytics_events;
mod event_envelope;
mod module_manifest;
mod search_documents;

pub use analytics_events::validate_analytics_events;
pub use event_envelope::validate_event_envelope;
pub use module_manifest::validate_module_manifest;
pub use search_documents::validate_search_documents;

use crate::discover::Kind;
use serde_json::Value;

/// Error type for validation adapters.
#[derive(Debug)]
pub enum AdapterError {
    /// Failed to deserialize JSON into domain type.
    Deserialize(String),
    /// Domain validation failed.
    Validation(String),
}

impl std::fmt::Display for AdapterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AdapterError::Deserialize(msg) => write!(f, "Deserialization failed: {}", msg),
            AdapterError::Validation(msg) => write!(f, "Validation failed: {}", msg),
        }
    }
}

impl std::error::Error for AdapterError {}

/// Validate a JSON value according to its kind.
///
/// Dispatches to the appropriate adapter based on the kind.
pub fn validate(kind: Kind, value: Value) -> Result<(), AdapterError> {
    match kind {
        Kind::EventEnvelope => validate_event_envelope(value),
        Kind::ModuleManifest => validate_module_manifest(value),
        Kind::SearchDocuments => validate_search_documents(value),
        Kind::AnalyticsEvents => validate_analytics_events(value),
    }
}
