use crate::commands::Command;
use crate::dev_supervisor::DevSupervisor;
use anyhow::Result;
use clap::Args;
use colored::Colorize;
use std::fs;

#[derive(Debug, Args)]
pub struct ResetCommand {
    #[arg(long, help = "Skip confirmation")]
    pub yes: bool,
}

impl Command for ResetCommand {
    fn execute(&self) -> Result<()> {
        if !self.yes {
            println!(
                "{}",
                "Warning: This will destroy all local dev data:".yellow().bold()
            );
            println!("  - Stop all running services");
            println!("  - Drop control plane database");
            println!("  - Drop all tenant databases");
            println!("  - Remove docker volumes");
            println!("  - Clear .dev directory");
            println!("\nRun with --yes to confirm");
            return Ok(());
        }

        println!("{}", "Resetting local dev environment...".cyan().bold());

        let supervisor = DevSupervisor::new()?;

        println!("{} Stopping containers...", "→".cyan());
        supervisor.stop_compose().ok();

        println!("{} Removing docker volumes...", "→".cyan());
        // Use the supervisor's compose command which injects all env vars
        // This ensures we don't need --env-file
        let runtime = supervisor.detect_container_runtime();
        let compose_cmd = if runtime == "podman" {
            "podman-compose"
        } else {
            "docker-compose"
        };

        // Build command with dev env vars
        let mut cmd = std::process::Command::new(compose_cmd);
        cmd.args([
            "-f",
            "infra/compose/compose.control-plane.yml",
            "down",
            "-v",
        ]);

        // Inject minimal required env vars for compose to work
        cmd.env("POSTGRES_DB", "control_plane");
        cmd.env("POSTGRES_USER", "atlas_platform");
        cmd.env("POSTGRES_PASSWORD", "local_dev_password");
        cmd.env("PGADMIN_DEFAULT_EMAIL", "admin@example.com");
        cmd.env("PGADMIN_DEFAULT_PASSWORD", "admin");
        cmd.env(
            "CONTROL_PLANE_DB_URL",
            "postgres://atlas_platform:local_dev_password@postgres:5432/control_plane",
        );

        cmd.status().ok();

        println!("{} Clearing .dev directory...", "→".cyan());
        if fs::metadata(".dev").is_ok() {
            fs::remove_dir_all(".dev").ok();
        }

        println!("\n{} Local dev environment has been reset", "✓".green());
        println!("\nRun `atlas dev quickstart <tenant-key>` to set up again");

        Ok(())
    }
}
