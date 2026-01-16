//! ModuleManifest validation adapter.

use super::AdapterError;
use atlas_core::types::ModuleManifest;
use atlas_core::validation;
use serde_json::Value;

/// Validate a ModuleManifest from JSON.
///
/// 1. Deserializes JSON into ModuleManifest
/// 2. Calls atlas_core::validation::validate_module_manifest
pub fn validate_module_manifest(value: Value) -> Result<(), AdapterError> {
    // Deserialize into domain type
    let manifest: ModuleManifest = serde_json::from_value(value)
        .map_err(|e| AdapterError::Deserialize(e.to_string()))?;

    // Call core validation
    validation::validate_module_manifest(&manifest)
        .map_err(|e| AdapterError::Validation(e.to_string()))
}
