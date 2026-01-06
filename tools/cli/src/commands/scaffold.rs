use crate::commands::Command;
use crate::generators::ScaffoldGenerator;
use crate::types::ServiceType;
use anyhow::Result;
use clap::Args;
use colored::Colorize;

#[derive(Debug, Args)]
pub struct ScaffoldCommand {
    #[arg(help = "Name of the service to scaffold")]
    pub name: String,

    #[arg(
        short = 't',
        long = "type",
        default_value = "api",
        help = "Service type: api, worker, projector, or hybrid"
    )]
    pub service_type: String,

    #[arg(
        short = 'l',
        long = "language",
        default_value = "rust",
        help = "Programming language"
    )]
    pub language: String,

    #[arg(long, help = "Path to OpenAPI spec (local file or URL)")]
    pub openapi: Option<String>,

    #[arg(
        long,
        default_value = "auto",
        help = "OpenAPI format: auto, json, or yaml"
    )]
    pub openapi_format: String,

    #[arg(long, default_value = "/", help = "Base path for API routes")]
    pub openapi_base_path: String,

    #[arg(
        long,
        value_delimiter = ',',
        help = "Comma-separated list of OpenAPI tags to include"
    )]
    pub openapi_tags: Option<Vec<String>>,

    #[arg(
        long,
        value_delimiter = ',',
        help = "Comma-separated list of operation IDs to include"
    )]
    pub openapi_ops: Option<Vec<String>>,

    #[arg(long, help = "Show what would be created without writing files")]
    pub dry_run: bool,
}

impl Command for ScaffoldCommand {
    fn execute(&self) -> Result<()> {
        let service_type = match self.service_type.to_lowercase().as_str() {
            "api" => ServiceType::Api,
            "worker" => ServiceType::Worker,
            "projector" => ServiceType::Projector,
            "hybrid" => ServiceType::Hybrid,
            _ => {
                anyhow::bail!("Invalid service type. Must be: api, worker, projector, or hybrid");
            }
        };

        if self.dry_run {
            println!(
                "{}",
                format!("[DRY RUN] Would scaffold service: {}", self.name).yellow()
            );
            println!("  Type: {:?}", service_type);
            println!("  Language: {}", self.language);
            println!("  Directory: apps/{}", self.name);
        } else {
            println!("{}", format!("Scaffolding service: {}", self.name).green());
        }

        ScaffoldGenerator::generate(
            &self.name,
            service_type,
            &self.language,
            self.openapi.as_deref(),
            &self.openapi_format,
            &self.openapi_base_path,
            self.openapi_tags.as_deref(),
            self.openapi_ops.as_deref(),
            self.dry_run,
        )?;

        if self.dry_run {
            println!("{}", "[DRY RUN] No files were written".yellow());
        } else {
            println!("{}", "✓ Service scaffolded successfully".green());
            println!("\nNext steps:");
            println!("  1. cd apps/{}", self.name);
            println!("  2. Review and edit service.yaml");
            println!("  3. Run: atlas gen");
        }

        Ok(())
    }
}
