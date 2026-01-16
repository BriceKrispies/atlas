//! SearchDocuments validation adapter.

use super::AdapterError;
use atlas_core::types::SearchDocument;
use atlas_core::validation;
use serde_json::Value;

/// Validate SearchDocuments from JSON.
///
/// Expects JSON with a `documents` array field:
/// ```json
/// { "documents": [ ... ] }
/// ```
///
/// 1. Extracts the `documents` array
/// 2. Deserializes into Vec<SearchDocument>
/// 3. Calls atlas_core::validation::validate_search_documents
pub fn validate_search_documents(value: Value) -> Result<(), AdapterError> {
    // Extract documents array from wrapper object
    let docs_value = match value {
        Value::Object(mut obj) => obj.remove("documents").ok_or_else(|| {
            AdapterError::Deserialize("Missing 'documents' field".to_string())
        })?,
        Value::Array(_) => {
            // Allow bare array for flexibility
            value
        }
        _ => {
            return Err(AdapterError::Deserialize(
                "Expected object with 'documents' field or array".to_string(),
            ));
        }
    };

    // Deserialize into domain type
    let documents: Vec<SearchDocument> = serde_json::from_value(docs_value)
        .map_err(|e| AdapterError::Deserialize(e.to_string()))?;

    // Call core validation
    validation::validate_search_documents(&documents)
        .map_err(|e| AdapterError::Validation(e.to_string()))
}
