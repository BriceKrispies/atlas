use crate::commands::Command;
use crate::validators::ModuleValidator;
use anyhow::Result;
use clap::Args;
use colored::Colorize;
use std::path::Path;

#[derive(Debug, Args)]
pub struct ModuleValidateCommand {
    #[arg(long, help = "Path to specific module manifest to validate")]
    pub manifest: Option<String>,

    #[arg(long, help = "Check for drift between manifests and generated crates")]
    pub check_drift: bool,

    #[arg(long, help = "Output results in JSON format")]
    pub json: bool,
}

impl Command for ModuleValidateCommand {
    fn execute(&self) -> Result<()> {
        let result = if let Some(ref manifest_path) = self.manifest {
            let path = Path::new(manifest_path);
            if !self.json {
                println!("{}", format!("Validating module manifest: {}", manifest_path).cyan());
            }
            ModuleValidator::validate_manifest_file(path)?
        } else {
            if !self.json {
                println!("{}", "Validating all module manifests...".cyan());
            }
            ModuleValidator::validate_all_modules()?
        };

        if self.json {
            println!("{}", serde_json::to_string_pretty(&result)?);
        } else {
            if result.valid {
                println!("{}", "✓ All validations passed".green());
            } else {
                println!("{}", "✗ Validation failed".red());
            }

            if !result.errors.is_empty() {
                println!("\n{}", "Errors:".red().bold());
                for error in &result.errors {
                    println!("  [{}] {}", error.module.yellow(), error.error.red());
                }
            }

            if !result.warnings.is_empty() {
                println!("\n{}", "Warnings:".yellow().bold());
                for warning in &result.warnings {
                    println!("  {}", warning.yellow());
                }
            }

            if !result.valid {
                std::process::exit(1);
            }
        }

        Ok(())
    }
}
