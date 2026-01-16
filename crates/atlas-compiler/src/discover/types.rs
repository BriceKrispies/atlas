//! Types for representing discovered compiler inputs.

use std::path::{Path, PathBuf};

/// Represents a discovered file and its associated validation schema.
///
/// Each `DiscoveredInput` corresponds to a file that the compiler must
/// validate according to the normative discovery rules D1-D7.
#[derive(Debug, Clone)]
pub struct DiscoveredInput {
    /// Path to the discovered file.
    file_path: PathBuf,
    /// The kind of schema this file validates against.
    schema_kind: SchemaKind,
    /// Path to the JSON Schema file for validation.
    schema_path: PathBuf,
    /// How the file content should be validated.
    validation_target: ValidationTarget,
}

impl DiscoveredInput {
    /// Creates a new discovered input.
    pub fn new(
        file_path: PathBuf,
        schema_kind: SchemaKind,
        schema_path: PathBuf,
        validation_target: ValidationTarget,
    ) -> Self {
        Self {
            file_path,
            schema_kind,
            schema_path,
            validation_target,
        }
    }

    /// Returns the path to the discovered file.
    pub fn file_path(&self) -> &Path {
        &self.file_path
    }

    /// Returns the schema kind for this input.
    pub fn schema_kind(&self) -> SchemaKind {
        self.schema_kind
    }

    /// Returns the path to the JSON Schema file.
    pub fn schema_path(&self) -> &Path {
        &self.schema_path
    }

    /// Returns the validation target specification.
    pub fn validation_target(&self) -> &ValidationTarget {
        &self.validation_target
    }
}

/// Represents the kind of JSON schema that applies to a discovered file.
///
/// Each variant corresponds to a schema file in `schemas/contracts/`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SchemaKind {
    /// Event envelope schema (`event_envelope.schema.json`)
    EventEnvelope,
    /// Module manifest schema (`module_manifest.schema.json`)
    ModuleManifest,
    /// Policy AST schema (`policy_ast.schema.json`)
    PolicyAst,
    /// Cache policy schema (`cache_policy.schema.json`)
    CachePolicy,
    /// Search document schema (`search_document.schema.json`)
    SearchDocument,
    /// Search query schema (`search_query.schema.json`)
    SearchQuery,
    /// Analytics event schema (`analytics_event.schema.json`)
    AnalyticsEvent,
    /// Analytics query schema (`analytics_query.schema.json`)
    AnalyticsQuery,
}

impl SchemaKind {
    /// Returns the filename of the JSON Schema for this kind.
    pub fn schema_filename(&self) -> &'static str {
        match self {
            SchemaKind::EventEnvelope => "event_envelope.schema.json",
            SchemaKind::ModuleManifest => "module_manifest.schema.json",
            SchemaKind::PolicyAst => "policy_ast.schema.json",
            SchemaKind::CachePolicy => "cache_policy.schema.json",
            SchemaKind::SearchDocument => "search_document.schema.json",
            SchemaKind::SearchQuery => "search_query.schema.json",
            SchemaKind::AnalyticsEvent => "analytics_event.schema.json",
            SchemaKind::AnalyticsQuery => "analytics_query.schema.json",
        }
    }
}

impl std::fmt::Display for SchemaKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SchemaKind::EventEnvelope => write!(f, "EventEnvelope"),
            SchemaKind::ModuleManifest => write!(f, "ModuleManifest"),
            SchemaKind::PolicyAst => write!(f, "PolicyAst"),
            SchemaKind::CachePolicy => write!(f, "CachePolicy"),
            SchemaKind::SearchDocument => write!(f, "SearchDocument"),
            SchemaKind::SearchQuery => write!(f, "SearchQuery"),
            SchemaKind::AnalyticsEvent => write!(f, "AnalyticsEvent"),
            SchemaKind::AnalyticsQuery => write!(f, "AnalyticsQuery"),
        }
    }
}

/// Specifies how a file's content should be validated.
///
/// Some files are validated as a whole, while others require validation
/// of specific array elements or fields within the JSON structure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationTarget {
    /// Validate the entire file content against the schema.
    WholeFile,
    /// Validate each element in a top-level array against the schema.
    ArrayElements,
    /// Validate each element in a specific named array field.
    ArrayField(String),
}

impl ValidationTarget {
    /// Returns true if this target requires array element extraction.
    pub fn is_array_based(&self) -> bool {
        matches!(self, ValidationTarget::ArrayElements | ValidationTarget::ArrayField(_))
    }

    /// Returns the field name if this is an array field target.
    pub fn field_name(&self) -> Option<&str> {
        match self {
            ValidationTarget::ArrayField(name) => Some(name),
            _ => None,
        }
    }
}

impl std::fmt::Display for ValidationTarget {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ValidationTarget::WholeFile => write!(f, "WholeFile"),
            ValidationTarget::ArrayElements => write!(f, "ArrayElements"),
            ValidationTarget::ArrayField(field) => write!(f, "ArrayField({})", field),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schema_kind_filename() {
        assert_eq!(
            SchemaKind::EventEnvelope.schema_filename(),
            "event_envelope.schema.json"
        );
        assert_eq!(
            SchemaKind::ModuleManifest.schema_filename(),
            "module_manifest.schema.json"
        );
    }

    #[test]
    fn test_schema_kind_display() {
        assert_eq!(SchemaKind::EventEnvelope.to_string(), "EventEnvelope");
        assert_eq!(SchemaKind::PolicyAst.to_string(), "PolicyAst");
    }

    #[test]
    fn test_validation_target_is_array_based() {
        assert!(!ValidationTarget::WholeFile.is_array_based());
        assert!(ValidationTarget::ArrayElements.is_array_based());
        assert!(ValidationTarget::ArrayField("policies".to_string()).is_array_based());
    }

    #[test]
    fn test_validation_target_field_name() {
        assert_eq!(ValidationTarget::WholeFile.field_name(), None);
        assert_eq!(ValidationTarget::ArrayElements.field_name(), None);
        assert_eq!(
            ValidationTarget::ArrayField("policies".to_string()).field_name(),
            Some("policies")
        );
    }

    #[test]
    fn test_discovered_input_accessors() {
        let input = DiscoveredInput::new(
            PathBuf::from("test.json"),
            SchemaKind::EventEnvelope,
            PathBuf::from("schema.json"),
            ValidationTarget::WholeFile,
        );

        assert_eq!(input.file_path(), Path::new("test.json"));
        assert_eq!(input.schema_kind(), SchemaKind::EventEnvelope);
        assert_eq!(input.schema_path(), Path::new("schema.json"));
        assert_eq!(*input.validation_target(), ValidationTarget::WholeFile);
    }
}
