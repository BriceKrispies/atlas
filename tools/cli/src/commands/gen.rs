use crate::commands::Command;
use crate::generators::{generate_k8s_manifest, generate_kafka_manifest, OpenApiConfig, OpenApiGenerator};
use crate::types::ServiceManifest;
use anyhow::{Context, Result};
use clap::Args;
use colored::Colorize;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Debug, Args)]
pub struct GenCommand {
    #[arg(long, help = "Show what would be generated without writing files")]
    pub dry_run: bool,
}

impl Command for GenCommand {
    fn execute(&self) -> Result<()> {
        if self.dry_run {
            println!("{}", "[DRY RUN] Would regenerate infrastructure".yellow());
        } else {
            println!("{}", "Regenerating infrastructure from manifests...".cyan());
        }

        let manifests = Self::find_all_manifests()?;

        if manifests.is_empty() {
            println!("{}", "No service manifests found in apps/".yellow());
            return Ok(());
        }

        if !self.dry_run {
            fs::create_dir_all("infra/k8s/services")?;
            fs::create_dir_all("infra/kafka")?;
        }

        for manifest in &manifests {
            self.generate_for_service(manifest)?;
        }

        if self.dry_run {
            println!("{}", "[DRY RUN] No files were written".yellow());
        } else {
            println!(
                "{}",
                format!("✓ Generated infrastructure for {} services", manifests.len()).green()
            );
        }

        Ok(())
    }
}

impl GenCommand {
    fn find_all_manifests() -> Result<Vec<ServiceManifest>> {
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

                manifests.push(manifest);
            }
        }

        Ok(manifests)
    }

    fn generate_for_service(&self, manifest: &ServiceManifest) -> Result<()> {
        let k8s_yaml = generate_k8s_manifest(manifest)?;
        let k8s_path = Path::new("infra")
            .join("k8s")
            .join("services")
            .join(format!("{}.yaml", manifest.name));

        if self.dry_run {
            println!(
                "  {} Would write: {:?}",
                "•".cyan(),
                k8s_path.display()
            );
        } else {
            fs::write(&k8s_path, k8s_yaml)
                .context(format!("Failed to write K8s manifest: {:?}", k8s_path))?;
            println!("  {} Generated: {:?}", "✓".green(), k8s_path.display());
        }

        if let Some(kafka_yaml) = generate_kafka_manifest(manifest)? {
            let kafka_path = Path::new("infra")
                .join("kafka")
                .join(format!("{}.yaml", manifest.name));

            if self.dry_run {
                println!(
                    "  {} Would write: {:?}",
                    "•".cyan(),
                    kafka_path.display()
                );
            } else {
                fs::write(&kafka_path, kafka_yaml)
                    .context(format!("Failed to write Kafka manifest: {:?}", kafka_path))?;
                println!("  {} Generated: {:?}", "✓".green(), kafka_path.display());
            }
        }

        // Track if we need to update the manifest
        let mut manifest_updated = manifest.clone();
        let mut needs_manifest_update = false;

        if let Some(ref openapi_spec) = manifest.openapi {
            if manifest.language == "rust" {
                let service_dir = Path::new("apps").join(&manifest.name);
                let config = OpenApiConfig {
                    source: openapi_spec.source.clone(),
                    base_path: openapi_spec.base_path.clone(),
                    tags: if openapi_spec.tags.is_empty() {
                        None
                    } else {
                        Some(openapi_spec.tags.clone())
                    },
                    ops: if openapi_spec.ops.is_empty() {
                        None
                    } else {
                        Some(openapi_spec.ops.clone())
                    },
                };

                let generator = OpenApiGenerator::new(config)?;
                let new_hash = generator.hash().to_string();

                if !self.dry_run {
                    generator.generate_rust_code(&service_dir, false)?;
                    println!("  {} Regenerated OpenAPI code for {}", "✓".green(), manifest.name);

                    // Update hash if it changed
                    if new_hash != openapi_spec.hash {
                        if let Some(ref mut openapi) = manifest_updated.openapi {
                            openapi.hash = new_hash;
                            needs_manifest_update = true;
                        }
                    }
                } else {
                    println!("  {} Would regenerate OpenAPI code for {}", "•".cyan(), manifest.name);
                }
            }
        }

        // Write updated manifest if hash changed
        if needs_manifest_update && !self.dry_run {
            let manifest_path = Path::new("apps")
                .join(&manifest.name)
                .join("service.yaml");
            let updated_yaml = manifest_updated.to_yaml()?;
            fs::write(&manifest_path, updated_yaml)
                .context(format!("Failed to update manifest: {:?}", manifest_path))?;
            println!("  {} Updated manifest hash for {}", "✓".green(), manifest.name);
        }

        Ok(())
    }
}
