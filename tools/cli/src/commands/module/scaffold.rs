use crate::commands::Command;
use crate::generators::ModuleGenerator;
use crate::types::ModuleManifest;
use crate::validators::ModuleValidator;
use anyhow::{Context, Result};
use clap::Args;
use colored::Colorize;
use std::fs;
use std::path::Path;

#[derive(Debug, Args)]
pub struct ModuleScaffoldCommand {
    #[arg(long, help = "Path to module manifest JSON file")]
    pub manifest: String,

    #[arg(long, help = "Show what would be created without writing files")]
    pub dry_run: bool,
}

impl Command for ModuleScaffoldCommand {
    fn execute(&self) -> Result<()> {
        let manifest_path = Path::new(&self.manifest);

        if !manifest_path.exists() {
            anyhow::bail!("Manifest file not found: {}", self.manifest);
        }

        let manifest_content = fs::read_to_string(manifest_path)
            .context(format!("Failed to read manifest: {}", self.manifest))?;

        if self.dry_run {
            println!("{}", format!("[DRY RUN] Validating manifest: {}", self.manifest).yellow());
        } else {
            println!("{}", format!("Validating manifest: {}", self.manifest).cyan());
        }

        let validation_result = ModuleValidator::validate_manifest_file(manifest_path)?;

        if !validation_result.valid {
            println!("{}", "✗ Validation failed:".red());
            for error in &validation_result.errors {
                println!("  [{}] {}", error.module.yellow(), error.error.red());
            }
            anyhow::bail!("Module manifest validation failed");
        }

        if !self.dry_run {
            println!("{}", "✓ Manifest is valid".green());
        }

        let manifest = ModuleManifest::from_json(&manifest_content)
            .context("Failed to parse module manifest")?;

        if self.dry_run {
            println!("{}", format!("[DRY RUN] Would scaffold module: {}", manifest.module_id).yellow());
        } else {
            println!("{}", format!("Scaffolding module: {}", manifest.module_id).green());
        }

        ModuleGenerator::generate(&manifest, self.dry_run)?;

        if self.dry_run {
            println!("{}", "[DRY RUN] No files were written".yellow());
        } else {
            println!("{}", "✓ Module scaffolded successfully".green());
            println!("\nModule crate location:");
            println!("  {}", manifest.crate_path());
            println!("\nNext steps:");
            println!("  1. cd {}", manifest.crate_path());
            println!("  2. Review and implement module logic");
            println!("  3. Run: cargo build -p {}", manifest.crate_name());
        }

        Ok(())
    }
}
