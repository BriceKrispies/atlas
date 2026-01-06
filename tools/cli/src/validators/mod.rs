pub mod module_validator;

use crate::generators::{generate_k8s_manifest, generate_kafka_manifest};
use crate::types::ServiceManifest;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub use module_validator::{ModuleValidator, ModuleValidationResult, ModuleValidationError};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationError {
    pub service: String,
    pub error: String,
}

impl ValidationResult {
    pub fn new() -> Self {
        Self {
            valid: true,
            errors: vec![],
            warnings: vec![],
        }
    }

    pub fn add_error(&mut self, service: String, error: String) {
        self.valid = false;
        self.errors.push(ValidationError { service, error });
    }

    pub fn add_warning(&mut self, warning: String) {
        self.warnings.push(warning);
    }
}

pub struct Validator;

impl Validator {
    pub fn validate_all(check_drift: bool) -> Result<ValidationResult> {
        let mut result = ValidationResult::new();

        let manifests = Self::find_all_manifests()?;

        if manifests.is_empty() {
            result.add_warning("No service manifests found in apps/".to_string());
            return Ok(result);
        }

        let mut service_names = HashSet::new();

        for (path, manifest) in &manifests {
            if let Err(errors) = manifest.validate() {
                for error in errors {
                    result.add_error(manifest.name.clone(), error);
                }
            }

            let parent_dir = path
                .parent()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("");

            if parent_dir != manifest.name {
                result.add_error(
                    manifest.name.clone(),
                    format!(
                        "Service name '{}' does not match directory name '{}'",
                        manifest.name, parent_dir
                    ),
                );
            }

            if !service_names.insert(manifest.name.clone()) {
                result.add_error(
                    manifest.name.clone(),
                    format!("Duplicate service name: {}", manifest.name),
                );
            }
        }

        if check_drift {
            for (_, manifest) in &manifests {
                if let Err(e) = Self::check_drift(manifest) {
                    result.add_error(manifest.name.clone(), format!("Drift detected: {}", e));
                }
            }
        }

        Ok(result)
    }

    fn find_all_manifests() -> Result<Vec<(PathBuf, ServiceManifest)>> {
        let mut manifests = Vec::new();
        let apps_dir = Path::new("apps");

        if !apps_dir.exists() {
            return Ok(manifests);
        }

        for entry in WalkDir::new(apps_dir)
            .max_depth(2)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_name() == "service.yaml" {
                let content = fs::read_to_string(entry.path())
                    .context(format!("Failed to read {:?}", entry.path()))?;

                let manifest = ServiceManifest::from_yaml(&content).context(format!(
                    "Failed to parse manifest at {:?}",
                    entry.path()
                ))?;

                manifests.push((entry.path().to_path_buf(), manifest));
            }
        }

        Ok(manifests)
    }

    fn check_drift(manifest: &ServiceManifest) -> Result<()> {
        let k8s_path = Path::new("infra")
            .join("k8s")
            .join("services")
            .join(format!("{}.yaml", manifest.name));

        if k8s_path.exists() {
            let existing = fs::read_to_string(&k8s_path)?;
            let expected = generate_k8s_manifest(manifest)?;

            if existing.trim() != expected.trim() {
                return Err(anyhow::anyhow!(
                    "K8s manifest has drifted from service.yaml"
                ));
            }
        } else {
            return Err(anyhow::anyhow!(
                "Expected K8s manifest not found: {:?}",
                k8s_path
            ));
        }

        if manifest.kafka.is_some() {
            let kafka_path = Path::new("infra")
                .join("kafka")
                .join(format!("{}.yaml", manifest.name));

            if kafka_path.exists() {
                let existing = fs::read_to_string(&kafka_path)?;
                if let Some(expected) = generate_kafka_manifest(manifest)? {
                    if existing.trim() != expected.trim() {
                        return Err(anyhow::anyhow!(
                            "Kafka manifest has drifted from service.yaml"
                        ));
                    }
                }
            } else if let Some(_) = generate_kafka_manifest(manifest)? {
                return Err(anyhow::anyhow!(
                    "Expected Kafka manifest not found: {:?}",
                    kafka_path
                ));
            }
        }

        // Check OpenAPI drift
        if let Some(ref openapi_spec) = manifest.openapi {
            Self::check_openapi_drift(manifest, openapi_spec)?;
        }

        Ok(())
    }

    fn check_openapi_drift(manifest: &ServiceManifest, openapi_spec: &crate::types::OpenApiSpec) -> Result<()> {
        // Check if OpenAPI source file exists
        let source_path = Path::new(&openapi_spec.source);
        if !source_path.exists() {
            return Err(anyhow::anyhow!(
                "OpenAPI spec file not found: {}",
                openapi_spec.source
            ));
        }

        // Compute current hash
        let content = fs::read_to_string(source_path)
            .context(format!("Failed to read OpenAPI spec: {}", openapi_spec.source))?;
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let current_hash = hex::encode(hasher.finalize());

        // Compare with stored hash
        if current_hash != openapi_spec.hash {
            return Err(anyhow::anyhow!(
                "OpenAPI spec has changed (hash mismatch). Run 'atlas gen' to regenerate."
            ));
        }

        // Check if generated files exist
        let service_dir = Path::new("apps").join(&manifest.name);
        let generated_dir = service_dir.join("generated");

        let expected_files = vec![
            generated_dir.join("mod.rs"),
            generated_dir.join("models.rs"),
            generated_dir.join("routes.rs"),
            generated_dir.join("validation.rs"),
        ];

        for file in expected_files {
            if !file.exists() {
                return Err(anyhow::anyhow!(
                    "Expected OpenAPI-generated file not found: {:?}. Run 'atlas gen' to regenerate.",
                    file
                ));
            }
        }

        Ok(())
    }
}
