use crate::commands::Command;
use anyhow::{Context, Result};
use clap::Args;
use colored::Colorize;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Args)]
pub struct TenantCreateCommand {
    #[arg(help = "Tenant key/identifier")]
    pub tenant_key: String,

    #[arg(long, help = "Tenant display name")]
    pub name: Option<String>,

    #[arg(long, help = "Region")]
    pub region: Option<String>,

    #[arg(long, help = "Skip migrations")]
    pub skip_migrate: bool,

    #[arg(long, help = "Skip seeding")]
    pub skip_seed: bool,

    #[arg(long, help = "Output as JSON")]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct TenantDeleteCommand {
    #[arg(help = "Tenant key/identifier")]
    pub tenant_key: String,

    #[arg(long, help = "Skip confirmation")]
    pub yes: bool,
}

#[derive(Serialize)]
struct CreateTenantRequest {
    #[serde(rename = "tenantKey")]
    tenant_key: String,
    migrate: bool,
    seed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    region: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct TenantResponse {
    tenant_id: String,
    name: String,
    status: String,
    region: Option<String>,
    db_name: Option<String>,
    db_host: Option<String>,
    db_port: Option<i32>,
    connection_string: Option<String>,
}

#[derive(Deserialize)]
struct CreateTenantResponse {
    status: String,
    tenant: TenantResponse,
}

impl Command for TenantCreateCommand {
    fn execute(&self) -> Result<()> {
        let base_url = std::env::var("CONTROL_PLANE_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:8000".to_string());

        if !self.json {
            println!(
                "{}",
                format!("Creating tenant: {}", self.tenant_key)
                    .cyan()
                    .bold()
            );
        }

        let client = Client::builder()
            .timeout(Duration::from_secs(60))
            .build()?;

        let request = CreateTenantRequest {
            tenant_key: self.tenant_key.clone(),
            migrate: !self.skip_migrate,
            seed: !self.skip_seed,
            name: self.name.clone(),
            region: self.region.clone(),
        };

        let response = client
            .post(format!("{}/admin/tenants", base_url))
            .json(&request)
            .send()
            .context("Failed to call create tenant endpoint. Is the control plane running?")?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().unwrap_or_default();
            anyhow::bail!(
                "Create tenant endpoint returned error: {} - {}",
                status,
                error_text
            );
        }

        let create_response: CreateTenantResponse = response.json()?;

        if self.json {
            println!("{}", serde_json::to_string_pretty(&create_response.tenant)?);
        } else {
            println!("{} Tenant created successfully", "✓".green());
            println!("\n{}", "Tenant Details:".bold());
            println!("  ID:     {}", create_response.tenant.tenant_id);
            println!("  Name:   {}", create_response.tenant.name);
            println!("  Status: {}", create_response.tenant.status);
            if let Some(region) = create_response.tenant.region {
                println!("  Region: {}", region);
            }

            if let Some(db_name) = create_response.tenant.db_name {
                println!("\n{}", "Database:".bold());
                println!("  Name: {}", db_name);
                if let Some(host) = create_response.tenant.db_host {
                    println!("  Host: {}", host);
                }
                if let Some(port) = create_response.tenant.db_port {
                    println!("  Port: {}", port);
                }
                if let Some(conn_str) = create_response.tenant.connection_string {
                    println!("  Connection: {}", conn_str);
                }
            }
        }

        Ok(())
    }
}

impl Command for TenantDeleteCommand {
    fn execute(&self) -> Result<()> {
        if !self.yes {
            println!(
                "{}",
                format!(
                    "Are you sure you want to delete tenant '{}'? This will drop the database!",
                    self.tenant_key
                )
                .yellow()
            );
            println!("Run with --yes to confirm");
            return Ok(());
        }

        let base_url = std::env::var("CONTROL_PLANE_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:8000".to_string());

        println!(
            "{}",
            format!("Deleting tenant: {}", self.tenant_key)
                .cyan()
                .bold()
        );

        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?;

        let response = client
            .delete(format!("{}/admin/tenants/{}", base_url, self.tenant_key))
            .send()
            .context("Failed to call delete tenant endpoint. Is the control plane running?")?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().unwrap_or_default();
            anyhow::bail!(
                "Delete tenant endpoint returned error: {} - {}",
                status,
                error_text
            );
        }

        println!("{} Tenant deleted successfully", "✓".green());

        Ok(())
    }
}
