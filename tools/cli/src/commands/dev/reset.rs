use crate::commands::Command;
use crate::dev_supervisor::DevSupervisor;
use anyhow::Result;
use clap::Args;
use colored::Colorize;
use std::fs;
use std::process::Command as StdCommand;

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
                "⚠️  This will destroy all local dev data:".yellow().bold()
            );
            println!("  • Stop all running services");
            println!("  • Drop control plane database");
            println!("  • Drop all tenant databases");
            println!("  • Remove docker volumes");
            println!("  • Clear .dev directory");
            println!("\nRun with --yes to confirm");
            return Ok(());
        }

        println!("{}", "Resetting local dev environment...".cyan().bold());

        let supervisor = DevSupervisor::new()?;

        println!("{} Stopping containers...", "→".cyan());
        supervisor.stop_compose().ok();

        println!("{} Removing docker volumes...", "→".cyan());
        let runtime = supervisor.detect_container_runtime();
        let compose_cmd = if runtime == "podman" {
            "podman-compose"
        } else {
            "docker-compose"
        };

        StdCommand::new(compose_cmd)
            .args([
                "-f",
                "infra/compose/compose.control-plane.yml",
                "--env-file",
                "infra/compose/.env",
                "down",
                "-v",
            ])
            .status()
            .ok();

        println!("{} Clearing .dev directory...", "→".cyan());
        if fs::metadata(".dev").is_ok() {
            fs::remove_dir_all(".dev").ok();
        }

        println!("\n{} Local dev environment has been reset", "✓".green());
        println!("\nRun `atlas dev quickstart <tenant-key>` to set up again");

        Ok(())
    }
}
