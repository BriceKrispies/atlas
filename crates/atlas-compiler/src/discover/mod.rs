//! File discovery and input enumeration.
//!
//! This module implements discovery rules D1-D8 from the normative requirements,
//! enumerating exactly which files the compiler validates and which schemas apply.
//!
//! Discovery is based on explicit file allowlists, not structural pattern-matching.

use std::path::{Path, PathBuf};

mod types;

pub use types::{DiscoveredInput, SchemaKind, ValidationTarget};

/// Discovers all compiler inputs based on normative discovery rules D1-D8.
///
/// This function applies the explicit file allowlists defined in the normative
/// requirements and returns the complete set of files the compiler must process.
///
/// # Arguments
///
/// * `specs_root` - Path to the specs directory (typically `specs/`)
///
/// # Returns
///
/// A vector of `DiscoveredInput` items, each representing a file and its
/// associated validation schema.
pub fn discover(specs_root: impl AsRef<Path>) -> Result<Vec<DiscoveredInput>, DiscoveryError> {
    let specs_root = specs_root.as_ref();
    let mut inputs = Vec::new();

    // Rule D1: Event Envelope Fixtures
    inputs.extend(discover_event_envelopes(specs_root)?);

    // Rule D2: Module Manifest Files
    inputs.extend(discover_module_manifests(specs_root)?);

    // Rule D3: Policy Bundle Fixtures
    inputs.extend(discover_policy_bundles(specs_root)?);

    // Rule D4: Search Document Fixtures
    inputs.extend(discover_search_documents(specs_root)?);

    // Rule D5: Search Query Fixtures
    inputs.extend(discover_search_queries(specs_root)?);

    // Rule D6: Analytics Event Fixtures
    inputs.extend(discover_analytics_events(specs_root)?);

    // Rule D7: Analytics Query Fixtures
    inputs.extend(discover_analytics_queries(specs_root)?);

    // Rule D8: File Exclusions (applied implicitly by not discovering specs/book/)

    Ok(inputs)
}

/// Discovery Rule D1: Event Envelope Fixtures
///
/// The compiler MUST validate the following files against
/// `schemas/contracts/event_envelope.schema.json`:
/// - `fixtures/event_envelope__valid__canonical.json`
/// - `fixtures/event_envelope__invalid__missing_idempotency.json`
/// - `fixtures/event_envelope__valid__page_create_intent.json`
/// - `fixtures/event_envelope__valid__page_created_event.json`
fn discover_event_envelopes(
    specs_root: &Path,
) -> Result<Vec<DiscoveredInput>, DiscoveryError> {
    let files = vec![
        "fixtures/event_envelope__valid__canonical.json",
        "fixtures/event_envelope__invalid__missing_idempotency.json",
        "fixtures/event_envelope__valid__page_create_intent.json",
        "fixtures/event_envelope__valid__page_created_event.json",
    ];

    let schema_path = specs_root.join("schemas/contracts/event_envelope.schema.json");

    files
        .into_iter()
        .map(|file| {
            let path = specs_root.join(file);
            validate_file_exists(&path)?;
            Ok(DiscoveredInput::new(
                path,
                SchemaKind::EventEnvelope,
                schema_path.clone(),
                ValidationTarget::WholeFile,
            ))
        })
        .collect()
}

/// Discovery Rule D2: Module Manifest Files
///
/// The compiler MUST validate the following files against
/// `schemas/contracts/module_manifest.schema.json`:
/// - `fixtures/module_manifest__valid__content_pages.json`
fn discover_module_manifests(
    specs_root: &Path,
) -> Result<Vec<DiscoveredInput>, DiscoveryError> {
    let files = vec!["fixtures/module_manifest__valid__content_pages.json"];

    let schema_path = specs_root.join("schemas/contracts/module_manifest.schema.json");

    files
        .into_iter()
        .map(|file| {
            let path = specs_root.join(file);
            validate_file_exists(&path)?;
            Ok(DiscoveredInput::new(
                path,
                SchemaKind::ModuleManifest,
                schema_path.clone(),
                ValidationTarget::WholeFile,
            ))
        })
        .collect()
}

/// Discovery Rule D3: Policy Bundle Fixtures
///
/// The compiler MUST validate each policy object in the `policies` array
/// of the following file against `schemas/contracts/policy_ast.schema.json`:
/// - `fixtures/sample_policy_bundle.json`
fn discover_policy_bundles(specs_root: &Path) -> Result<Vec<DiscoveredInput>, DiscoveryError> {
    let files = vec!["fixtures/sample_policy_bundle.json"];

    let schema_path = specs_root.join("schemas/contracts/policy_ast.schema.json");

    files
        .into_iter()
        .map(|file| {
            let path = specs_root.join(file);
            validate_file_exists(&path)?;
            Ok(DiscoveredInput::new(
                path,
                SchemaKind::PolicyAst,
                schema_path.clone(),
                ValidationTarget::ArrayField("policies".to_string()),
            ))
        })
        .collect()
}

/// Discovery Rule D4: Search Document Fixtures
///
/// The compiler MUST validate each array element in the following file
/// against `schemas/contracts/search_document.schema.json`:
/// - `fixtures/search_documents__valid__sample.json`
fn discover_search_documents(
    specs_root: &Path,
) -> Result<Vec<DiscoveredInput>, DiscoveryError> {
    let files = vec!["fixtures/search_documents__valid__sample.json"];

    let schema_path = specs_root.join("schemas/contracts/search_document.schema.json");

    files
        .into_iter()
        .map(|file| {
            let path = specs_root.join(file);
            validate_file_exists(&path)?;
            Ok(DiscoveredInput::new(
                path,
                SchemaKind::SearchDocument,
                schema_path.clone(),
                ValidationTarget::ArrayElements,
            ))
        })
        .collect()
}

/// Discovery Rule D5: Search Query Fixtures
///
/// The compiler MUST validate the following file against
/// `schemas/contracts/search_query.schema.json`:
/// - `fixtures/search_query.json`
fn discover_search_queries(specs_root: &Path) -> Result<Vec<DiscoveredInput>, DiscoveryError> {
    let files = vec!["fixtures/search_query.json"];

    let schema_path = specs_root.join("schemas/contracts/search_query.schema.json");

    files
        .into_iter()
        .map(|file| {
            let path = specs_root.join(file);
            validate_file_exists(&path)?;
            Ok(DiscoveredInput::new(
                path,
                SchemaKind::SearchQuery,
                schema_path.clone(),
                ValidationTarget::WholeFile,
            ))
        })
        .collect()
}

/// Discovery Rule D6: Analytics Event Fixtures
///
/// The compiler MUST validate each array element in the following file
/// against `schemas/contracts/analytics_event.schema.json`:
/// - `fixtures/analytics_events__valid__sample.json`
fn discover_analytics_events(
    specs_root: &Path,
) -> Result<Vec<DiscoveredInput>, DiscoveryError> {
    let files = vec!["fixtures/analytics_events__valid__sample.json"];

    let schema_path = specs_root.join("schemas/contracts/analytics_event.schema.json");

    files
        .into_iter()
        .map(|file| {
            let path = specs_root.join(file);
            validate_file_exists(&path)?;
            Ok(DiscoveredInput::new(
                path,
                SchemaKind::AnalyticsEvent,
                schema_path.clone(),
                ValidationTarget::ArrayElements,
            ))
        })
        .collect()
}

/// Discovery Rule D7: Analytics Query Fixtures
///
/// The compiler MUST validate the following file against
/// `schemas/contracts/analytics_query.schema.json`:
/// - `fixtures/analytics_query.json`
fn discover_analytics_queries(
    specs_root: &Path,
) -> Result<Vec<DiscoveredInput>, DiscoveryError> {
    let files = vec!["fixtures/analytics_query.json"];

    let schema_path = specs_root.join("schemas/contracts/analytics_query.schema.json");

    files
        .into_iter()
        .map(|file| {
            let path = specs_root.join(file);
            validate_file_exists(&path)?;
            Ok(DiscoveredInput::new(
                path,
                SchemaKind::AnalyticsQuery,
                schema_path.clone(),
                ValidationTarget::WholeFile,
            ))
        })
        .collect()
}

/// Validates that a file exists at the given path.
fn validate_file_exists(path: &Path) -> Result<(), DiscoveryError> {
    if !path.exists() {
        return Err(DiscoveryError::FileNotFound {
            path: path.to_path_buf(),
        });
    }
    if !path.is_file() {
        return Err(DiscoveryError::NotAFile {
            path: path.to_path_buf(),
        });
    }
    Ok(())
}

/// Error type for discovery operations.
#[derive(Debug, Clone)]
pub enum DiscoveryError {
    /// Expected file was not found at the specified path.
    FileNotFound { path: PathBuf },
    /// Path exists but is not a file.
    NotAFile { path: PathBuf },
}

impl std::fmt::Display for DiscoveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DiscoveryError::FileNotFound { path } => {
                write!(f, "Required file not found: {}", path.display())
            }
            DiscoveryError::NotAFile { path } => {
                write!(f, "Path is not a file: {}", path.display())
            }
        }
    }
}

impl std::error::Error for DiscoveryError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discover_requires_valid_specs_root() {
        let result = discover("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_discover_with_specs_directory() {
        // This test will pass if run from the repo root with specs/ directory
        let specs_root = std::path::Path::new("specs");
        if specs_root.exists() {
            let result = discover(specs_root);
            match result {
                Ok(inputs) => {
                    // Should discover files from all rules D1-D7
                    assert!(!inputs.is_empty());

                    // D1: 4 event envelope fixtures
                    let event_envelopes = inputs
                        .iter()
                        .filter(|i| matches!(i.schema_kind(), SchemaKind::EventEnvelope))
                        .count();
                    assert_eq!(event_envelopes, 4, "Expected 4 event envelope fixtures");

                    // D2: 1 module manifest
                    let manifests = inputs
                        .iter()
                        .filter(|i| matches!(i.schema_kind(), SchemaKind::ModuleManifest))
                        .count();
                    assert_eq!(manifests, 1, "Expected 1 module manifest");

                    // D3: 1 policy bundle
                    let policies = inputs
                        .iter()
                        .filter(|i| matches!(i.schema_kind(), SchemaKind::PolicyAst))
                        .count();
                    assert_eq!(policies, 1, "Expected 1 policy bundle");

                    // Total should be 4 + 1 + 1 + 1 + 1 + 1 + 1 = 10
                    assert_eq!(inputs.len(), 10, "Expected 10 total discovered inputs");
                }
                Err(e) => {
                    panic!("Discovery failed: {}", e);
                }
            }
        }
    }

    #[test]
    fn test_discovery_error_display() {
        let err = DiscoveryError::FileNotFound {
            path: PathBuf::from("test.json"),
        };
        assert!(err.to_string().contains("test.json"));

        let err = DiscoveryError::NotAFile {
            path: PathBuf::from("directory"),
        };
        assert!(err.to_string().contains("directory"));
    }
}
