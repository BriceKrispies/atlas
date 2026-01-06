use crate::commands::Command;
use crate::validators::Validator;
use anyhow::Result;
use clap::Args;
use colored::Colorize;

#[derive(Debug, Args)]
pub struct ValidateCommand {
    #[arg(long, help = "Check for drift between manifests and generated files")]
    pub check_drift: bool,

    #[arg(long, help = "Output results in JSON format")]
    pub json: bool,
}

impl Command for ValidateCommand {
    fn execute(&self) -> Result<()> {
        if !self.json {
            println!("{}", "Validating service manifests...".cyan());
        }

        let result = Validator::validate_all(self.check_drift)?;

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
                    println!("  [{}] {}", error.service.yellow(), error.error.red());
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
