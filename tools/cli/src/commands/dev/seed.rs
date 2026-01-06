use crate::commands::Command;
use anyhow::{Context, Result};
use clap::Args;
use colored::Colorize;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Args)]
pub struct SeedControlCommand {}

#[derive(Deserialize)]
struct SeedResponse {
    status: String,
    message: String,
}

impl Command for SeedControlCommand {
    fn execute(&self) -> Result<()> {
        println!("{}", "Seeding control plane database...".cyan().bold());

        let base_url = std::env::var("CONTROL_PLANE_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:8000".to_string());

        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?;

        let response = client
            .post(format!("{}/admin/seed", base_url))
            .send()
            .context("Failed to call seed endpoint. Is the control plane running?")?;

        if !response.status().is_success() {
            anyhow::bail!("Seed endpoint returned error: {}", response.status());
        }

        let seed_response: SeedResponse = response.json()?;

        println!("{} {}", "✓".green(), seed_response.message);
        println!("{} Status: {}", "→".cyan(), seed_response.status);

        Ok(())
    }
}
