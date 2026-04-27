//! Schema validation for intent payloads.
//!
//! Validates intent payloads against JSON schemas registered in the schema registry.
//! This enforces Invariant I1 by rejecting invalid payloads at the ingress boundary.
//!
//! ## Error Handling
//!
//! - Unknown schema_id: Returns 400 Bad Request with UNKNOWN_SCHEMA code
//! - Payload validation failure: Returns 400 Bad Request with SCHEMA_VALIDATION_FAILED code

use jsonschema::{JSONSchema, ValidationError};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, info};

/// Key for looking up a schema by ID and version.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct SchemaKey {
    pub schema_id: String,
    pub version: u32,
}

impl SchemaKey {
    pub fn new(schema_id: impl Into<String>, version: u32) -> Self {
        Self {
            schema_id: schema_id.into(),
            version,
        }
    }
}

/// Compiled schema with metadata.
struct CompiledSchema {
    #[allow(dead_code)]
    schema_id: String,
    #[allow(dead_code)]
    version: u32,
    compiled: JSONSchema,
}

/// Result of schema validation.
#[derive(Debug)]
pub enum SchemaValidationResult {
    /// Schema found and payload is valid.
    Valid,
    /// Schema not found in registry.
    UnknownSchema { schema_id: String, version: u32 },
    /// Schema found but payload does not conform.
    ValidationFailed { errors: Vec<String> },
}

/// Schema registry that stores and validates against JSON schemas.
///
/// Thread-safe via Arc for use in async handlers.
pub struct SchemaRegistry {
    schemas: HashMap<SchemaKey, CompiledSchema>,
}

impl SchemaRegistry {
    /// Create a new empty schema registry.
    pub fn new() -> Self {
        Self {
            schemas: HashMap::new(),
        }
    }

    /// Register a schema from a JSON value.
    ///
    /// Returns an error if the schema cannot be compiled.
    pub fn register(
        &mut self,
        schema_id: impl Into<String>,
        version: u32,
        schema_json: &Value,
    ) -> Result<(), String> {
        let schema_id = schema_id.into();
        let key = SchemaKey::new(&schema_id, version);

        let compiled = JSONSchema::compile(schema_json)
            .map_err(|e| format!("Failed to compile schema {}: {}", schema_id, e))?;

        self.schemas.insert(
            key,
            CompiledSchema {
                schema_id: schema_id.clone(),
                version,
                compiled,
            },
        );

        debug!(schema_id = %schema_id, version = version, "Registered schema");
        Ok(())
    }

    /// Validate a payload against a registered schema.
    pub fn validate(
        &self,
        schema_id: &str,
        version: u32,
        payload: &Value,
    ) -> SchemaValidationResult {
        let key = SchemaKey::new(schema_id, version);

        let schema = match self.schemas.get(&key) {
            Some(s) => s,
            None => {
                return SchemaValidationResult::UnknownSchema {
                    schema_id: schema_id.to_string(),
                    version,
                };
            }
        };

        match schema.compiled.validate(payload) {
            Ok(_) => SchemaValidationResult::Valid,
            Err(errors) => {
                let error_messages: Vec<String> = errors
                    .map(|e: ValidationError| format!("{} at {}", e, e.instance_path))
                    .collect();
                SchemaValidationResult::ValidationFailed {
                    errors: error_messages,
                }
            }
        }
    }

    /// Get the number of registered schemas.
    pub fn len(&self) -> usize {
        self.schemas.len()
    }

    /// Check if the registry is empty.
    pub fn is_empty(&self) -> bool {
        self.schemas.is_empty()
    }
}

impl Default for SchemaRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Create a schema registry with default test schemas.
///
/// This is used when running without a control plane database.
/// Registers the schema used by integration tests.
pub fn create_default_schema_registry() -> Arc<SchemaRegistry> {
    let mut registry = SchemaRegistry::new();

    // Register the schema used by integration tests: ui.contentpages.page.create.v1
    // This schema validates the payload structure for page creation intents.
    let page_create_schema = serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
            "actionId": { "type": "string" },
            "resourceType": { "type": "string" },
            "resourceId": { "type": ["string", "null"] },
            "pageId": { "type": "string" },
            "title": { "type": "string" },
            "slug": { "type": "string" },
            "content": { "type": "string" },
            "authorId": { "type": "string" },
            "status": {
                "type": "string",
                "enum": ["draft", "published", "archived"]
            }
        },
        "required": ["actionId", "resourceType", "pageId", "title", "slug"]
    });

    if let Err(e) = registry.register("ui.contentpages.page.create.v1", 1, &page_create_schema) {
        tracing::error!("Failed to register default schema: {}", e);
    } else {
        info!("Registered default schema: ui.contentpages.page.create.v1 v1");
    }

    // StructuredCatalog command payload: Catalog.SeedPackage.Apply
    let catalog_seed_package_apply_schema = serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "actionId": { "type": "string", "const": "Catalog.SeedPackage.Apply" },
            "resourceType": { "type": "string", "const": "SeedPackage" },
            "resourceId": { "type": ["string", "null"] },
            "seedPackageKey": { "type": "string", "minLength": 1 },
            "seedPackageVersion": { "type": "string", "minLength": 1 },
            "payload": { "type": "object", "additionalProperties": true }
        },
        "required": ["actionId", "resourceType", "seedPackageKey", "seedPackageVersion", "payload"]
    });
    if let Err(e) = registry.register(
        "catalog.seed_package.apply.v1",
        1,
        &catalog_seed_package_apply_schema,
    ) {
        tracing::error!("Failed to register default schema: {}", e);
    } else {
        info!("Registered default schema: catalog.seed_package.apply.v1 v1");
    }

    // StructuredCatalog command payload: Catalog.Family.Publish
    let catalog_family_publish_schema = serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "actionId": { "type": "string", "const": "Catalog.Family.Publish" },
            "resourceType": { "type": "string", "const": "Family" },
            "resourceId": { "type": ["string", "null"] },
            "familyKey": { "type": "string", "minLength": 1 },
            "familyRevisionNumber": { "type": "integer", "minimum": 1 }
        },
        "required": ["actionId", "resourceType", "familyKey", "familyRevisionNumber"]
    });
    if let Err(e) = registry.register(
        "catalog.family.publish.v1",
        1,
        &catalog_family_publish_schema,
    ) {
        tracing::error!("Failed to register default schema: {}", e);
    } else {
        info!("Registered default schema: catalog.family.publish.v1 v1");
    }

    // StructuredCatalog event payload: SeedPackageApplied
    let catalog_seed_package_applied_schema = serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "seedPackageKey": { "type": "string", "minLength": 1 },
            "seedPackageVersion": { "type": "string", "minLength": 1 },
            "appliedAt": { "type": "string", "format": "date-time" },
            "summary": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "taxonomyTreeCount": { "type": "integer", "minimum": 0 },
                    "taxonomyNodeCount": { "type": "integer", "minimum": 0 },
                    "familyCount": { "type": "integer", "minimum": 0 },
                    "variantCount": { "type": "integer", "minimum": 0 },
                    "attributeDefinitionCount": { "type": "integer", "minimum": 0 },
                    "assetCount": { "type": "integer", "minimum": 0 }
                },
                "required": [
                    "taxonomyTreeCount", "taxonomyNodeCount", "familyCount",
                    "variantCount", "attributeDefinitionCount", "assetCount"
                ]
            }
        },
        "required": ["seedPackageKey", "seedPackageVersion", "appliedAt", "summary"]
    });
    if let Err(e) = registry.register(
        "catalog.seed_package_applied.v1",
        1,
        &catalog_seed_package_applied_schema,
    ) {
        tracing::error!("Failed to register default schema: {}", e);
    } else {
        info!("Registered default schema: catalog.seed_package_applied.v1 v1");
    }

    // StructuredCatalog event payload: FamilyPublished
    let catalog_family_published_schema = serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "familyKey": { "type": "string", "minLength": 1 },
            "familyId": { "type": "string", "format": "uuid" },
            "revisionNumber": { "type": "integer", "minimum": 1 },
            "publishedAt": { "type": "string", "format": "date-time" }
        },
        "required": ["familyKey", "familyId", "revisionNumber", "publishedAt"]
    });
    if let Err(e) = registry.register(
        "catalog.family_published.v1",
        1,
        &catalog_family_published_schema,
    ) {
        tracing::error!("Failed to register default schema: {}", e);
    } else {
        info!("Registered default schema: catalog.family_published.v1 v1");
    }

    // StructuredCatalog event payload: VariantUpserted
    let catalog_variant_upserted_schema = serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "familyKey": { "type": "string", "minLength": 1 },
            "familyId": { "type": "string", "format": "uuid" },
            "variantKey": { "type": "string", "minLength": 1 },
            "variantId": { "type": "string", "format": "uuid" },
            "revisionNumber": { "type": "integer", "minimum": 1 },
            "attributeValuesCount": { "type": "integer", "minimum": 0 },
            "upsertedAt": { "type": "string", "format": "date-time" }
        },
        "required": [
            "familyKey", "familyId", "variantKey", "variantId",
            "revisionNumber", "attributeValuesCount", "upsertedAt"
        ]
    });
    if let Err(e) = registry.register(
        "catalog.variant_upserted.v1",
        1,
        &catalog_variant_upserted_schema,
    ) {
        tracing::error!("Failed to register default schema: {}", e);
    } else {
        info!("Registered default schema: catalog.variant_upserted.v1 v1");
    }

    Arc::new(registry)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_validate_valid_payload() {
        let mut registry = SchemaRegistry::new();
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "count": { "type": "integer" }
            },
            "required": ["name"]
        });

        registry.register("test.schema", 1, &schema).unwrap();

        let valid_payload = serde_json::json!({
            "name": "test",
            "count": 42
        });

        let result = registry.validate("test.schema", 1, &valid_payload);
        assert!(matches!(result, SchemaValidationResult::Valid));
    }

    #[test]
    fn test_validate_unknown_schema() {
        let registry = SchemaRegistry::new();

        let payload = serde_json::json!({ "foo": "bar" });
        let result = registry.validate("nonexistent", 1, &payload);

        assert!(matches!(
            result,
            SchemaValidationResult::UnknownSchema { .. }
        ));
    }

    #[test]
    fn test_validate_invalid_payload() {
        let mut registry = SchemaRegistry::new();
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" }
            },
            "required": ["name"]
        });

        registry.register("test.schema", 1, &schema).unwrap();

        // Missing required field
        let invalid_payload = serde_json::json!({
            "other": "value"
        });

        let result = registry.validate("test.schema", 1, &invalid_payload);
        match result {
            SchemaValidationResult::ValidationFailed { errors } => {
                assert!(!errors.is_empty());
            }
            _ => panic!("Expected ValidationFailed"),
        }
    }

    #[test]
    fn test_different_versions() {
        let mut registry = SchemaRegistry::new();

        let schema_v1 = serde_json::json!({
            "type": "object",
            "properties": { "name": { "type": "string" } },
            "required": ["name"]
        });

        let schema_v2 = serde_json::json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "count": { "type": "integer" }
            },
            "required": ["name", "count"]
        });

        registry.register("test.schema", 1, &schema_v1).unwrap();
        registry.register("test.schema", 2, &schema_v2).unwrap();

        // Valid for v1, but missing count for v2
        let payload = serde_json::json!({ "name": "test" });

        let result_v1 = registry.validate("test.schema", 1, &payload);
        assert!(matches!(result_v1, SchemaValidationResult::Valid));

        let result_v2 = registry.validate("test.schema", 2, &payload);
        assert!(matches!(
            result_v2,
            SchemaValidationResult::ValidationFailed { .. }
        ));
    }

    #[test]
    fn test_default_registry_has_test_schema() {
        let registry = create_default_schema_registry();
        assert!(!registry.is_empty());

        // Should have the integration test schema
        let payload = serde_json::json!({
            "actionId": "ContentPages.Page.Create",
            "resourceType": "Page",
            "resourceId": null,
            "pageId": "page-001",
            "title": "Test Page",
            "slug": "test-page"
        });

        let result = registry.validate("ui.contentpages.page.create.v1", 1, &payload);
        assert!(matches!(result, SchemaValidationResult::Valid));
    }
}
