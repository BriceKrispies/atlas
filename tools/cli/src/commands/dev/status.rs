use crate::commands::Command;
use crate::dev_supervisor::DevSupervisor;
use anyhow::Result;
use clap::Args;
use colored::Colorize;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Args)]
pub struct StatusCommand {
    #[arg(long, help = "Show logs")]
    pub logs: bool,
}

#[derive(Deserialize)]
struct TenantResponse {
    tenant_id: String,
    name: String,
    status: String,
    db_name: Option<String>,
}

impl Command for StatusCommand {
    fn execute(&self) -> Result<()> {
        println!("{}", "Development Environment Status".cyan().bold());
        println!();

        let supervisor = DevSupervisor::new()?;

        let postgres_running = supervisor.is_compose_running();
        let control_plane_running = supervisor.is_control_plane_running();

        println!("{}", "Services:".bold());
        println!(
            "  PostgreSQL:    {}",
            if postgres_running {
                "✓ Running".green()
            } else {
                "✗ Stopped".red()
            }
        );
        println!(
            "  Control Plane: {}",
            if control_plane_running {
                "✓ Running (http://localhost:8000)".green()
            } else {
                "✗ Stopped".red()
            }
        );

        if control_plane_running {
            println!();
            println!("{}", "Tenants:".bold());

            match fetch_tenants() {
                Ok(tenants) => {
                    if tenants.is_empty() {
                        println!("  No tenants found");
                    } else {
                        for tenant in tenants {
                            println!("  • {} ({})", tenant.tenant_id.cyan(), tenant.name);
                            if let Some(db_name) = tenant.db_name {
                                println!("    Database: {}", db_name);
                            }
                        }
                    }
                }
                Err(e) => {
                    println!("  {} Failed to fetch tenants: {}", "⚠".yellow(), e);
                }
            }
        }

        if self.logs && control_plane_running {
            println!();
            println!("{}", "Control Plane Logs (last 20 lines):".bold());
            if let Ok(logs) = supervisor.get_logs() {
                let lines: Vec<&str> = logs.lines().collect();
                let start = if lines.len() > 20 {
                    lines.len() - 20
                } else {
                    0
                };
                for line in &lines[start..] {
                    println!("  {}", line);
                }
            }
        }

        Ok(())
    }
}

fn fetch_tenants() -> Result<Vec<TenantResponse>> {
    let _base_url = std::env::var("CONTROL_PLANE_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:8000".to_string());

    let _client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()?;

    Ok(vec![])
}
