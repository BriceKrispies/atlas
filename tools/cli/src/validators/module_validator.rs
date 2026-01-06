use crate::types::ModuleManifest;
use anyhow::{Context, Result};
use jsonschema::JSONSchema;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleValidationResult {
    pub valid: bool,
    pub errors: Vec<ModuleValidationError>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleValidationError {
    pub module: String,
    pub error: String,
}

impl ModuleValidationResult {
    pub fn new() -> Self {
        Self {
            valid: true,
            errors: vec![],
            warnings: vec![],
        }
    }

    pub fn add_error(&mut self, module: String, error: String) {
        self.valid = false;
        self.errors.push(ModuleValidationError { module, error });
    }

    pub fn add_warning(&mut self, warning: String) {
        self.warnings.push(warning);
    }
}

pub struct ModuleValidator;

impl ModuleValidator {
    pub fn validate_manifest_file(manifest_path: &Path) -> Result<ModuleValidationResult> {
        let mut result = ModuleValidationResult::new();

        if !manifest_path.exists() {
            result.add_error(
                "unknown".to_string(),
                format!("Manifest file not found: {}", manifest_path.display()),
            );
            return Ok(result);
        }

        let manifest_content = fs::read_to_string(manifest_path)
            .context(format!("Failed to read manifest: {}", manifest_path.display()))?;

        let manifest: ModuleManifest = match ModuleManifest::from_json(&manifest_content) {
            Ok(m) => m,
            Err(e) => {
                result.add_error(
                    "parse_error".to_string(),
                    format!("Failed to parse manifest: {}", e),
                );
                return Ok(result);
            }
        };

        if let Err(e) = Self::validate_against_schema(&manifest_content) {
            result.add_error(manifest.module_id.clone(), format!("Schema validation failed: {}", e));
        }

        if let Err(errors) = Self::validate_manifest_content(&manifest) {
            for error in errors {
                result.add_error(manifest.module_id.clone(), error);
            }
        }

        Ok(result)
    }

    pub fn validate_all_modules() -> Result<ModuleValidationResult> {
        let mut result = ModuleValidationResult::new();

        let manifests = Self::find_all_module_manifests()?;

        if manifests.is_empty() {
            result.add_warning("No module manifests found in specs/modules/".to_string());
            return Ok(result);
        }

        for (path, _) in &manifests {
            let validation = Self::validate_manifest_file(path)?;
            result.errors.extend(validation.errors);
            result.warnings.extend(validation.warnings);
            if !validation.valid {
                result.valid = false;
            }
        }

        Ok(result)
    }

    fn validate_against_schema(json_content: &str) -> Result<()> {
        let schema_path = Path::new("specs/module_manifest.schema.json");

        if !schema_path.exists() {
            anyhow::bail!("Schema file not found: {}", schema_path.display());
        }

        let schema_content = fs::read_to_string(schema_path)
            .context("Failed to read module manifest schema")?;

        let schema_json: serde_json::Value = serde_json::from_str(&schema_content)
            .context("Failed to parse schema JSON")?;

        let compiled_schema = JSONSchema::compile(&schema_json)
            .map_err(|e| anyhow::anyhow!("Failed to compile JSON schema: {}", e))?;

        let manifest_json: serde_json::Value = serde_json::from_str(json_content)
            .context("Failed to parse manifest JSON")?;

        if let Err(errors) = compiled_schema.validate(&manifest_json) {
            let error_messages: Vec<String> = errors
                .map(|e| format!("  - {} at {}", e, e.instance_path))
                .collect();

            anyhow::bail!("JSON schema validation errors:\n{}", error_messages.join("\n"));
        }

        Ok(())
    }

    fn validate_manifest_content(manifest: &ModuleManifest) -> Result<Vec<String>, Vec<String>> {
        let mut errors = Vec::new();

        if !manifest.module_id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
            errors.push("moduleId must contain only lowercase letters, digits, and hyphens".to_string());
        }

        if manifest.module_type.is_empty() {
            errors.push("moduleType must have at least one type".to_string());
        }

        let valid_types = vec!["ui", "api", "worker", "projection", "hybrid"];
        for t in &manifest.module_type {
            if !valid_types.contains(&t.as_str()) {
                errors.push(format!("Invalid moduleType: {}", t));
            }
        }

        if errors.is_empty() {
            Ok(vec![])
        } else {
            Err(errors)
        }
    }

    fn find_all_module_manifests() -> Result<Vec<(PathBuf, ModuleManifest)>> {
        let mut manifests = Vec::new();
        let modules_dir = Path::new("specs/modules");

        if !modules_dir.exists() {
            return Ok(manifests);
        }

        for entry in WalkDir::new(modules_dir)
            .max_depth(1)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.path().extension().and_then(|s| s.to_str()) == Some("json") {
                let content = fs::read_to_string(entry.path())
                    .context(format!("Failed to read {:?}", entry.path()))?;

                if let Ok(manifest) = ModuleManifest::from_json(&content) {
                    manifests.push((entry.path().to_path_buf(), manifest));
                }
            }
        }

        Ok(manifests)
    }

    pub fn check_module_drift(manifest: &ModuleManifest) -> Result<()> {
        let crate_path_str = manifest.crate_path();
        let crate_path = Path::new(&crate_path_str);

        if !crate_path.exists() {
            return Err(anyhow::anyhow!(
                "Module crate directory not found: {}. Run 'atlas module scaffold' to generate.",
                crate_path.display()
            ));
        }

        let cargo_toml = crate_path.join("Cargo.toml");
        if !cargo_toml.exists() {
            return Err(anyhow::anyhow!(
                "Cargo.toml not found in module crate: {}",
                cargo_toml.display()
            ));
        }

        let lib_rs = crate_path.join("src/lib.rs");
        if !lib_rs.exists() {
            return Err(anyhow::anyhow!(
                "lib.rs not found in module crate: {}",
                lib_rs.display()
            ));
        }

        Ok(())
    }
}
