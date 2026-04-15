use crate::commands::Command;
use crate::dev_supervisor::DevSupervisor;
use anyhow::Result;
use clap::Args;
use colored::Colorize;

#[derive(Debug, Args)]
pub struct UpCommand {
    #[arg(long, help = "Run in background")]
    pub detach: bool,

    #[arg(long, help = "Skip migrations")]
    pub skip_migrations: bool,
}

impl Command for UpCommand {
    fn execute(&self) -> Result<()> {
        let supervisor = DevSupervisor::new()?;

        println!("{}", "Starting development environment...".cyan().bold());

        if supervisor.is_compose_running() && supervisor.is_control_plane_running() {
            println!("{} Services are already running", "→".yellow());
            if !self.skip_migrations {
                supervisor.run_migrations()?;
            }
        } else {
            supervisor.start_compose(self.detach)?;

            if !self.skip_migrations && self.detach {
                supervisor.run_migrations()?;
            }
        }

        if self.detach {
            println!("\n{}", "Development environment is ready!".green().bold());
            println!("\n{}", "Services:".bold());
            println!("  Control Plane API: http://localhost:8000");
            println!("  PostgreSQL:        localhost:5433");
            println!("  pgAdmin:           http://localhost:5050");
            println!("\n{}", "Logs:".bold());
            println!("  atlas dev status --logs");
        } else {
            println!("\n{} Services running in foreground mode...", "→".cyan());
            println!("{} Press Ctrl+C to stop", "→".cyan());
        }

        Ok(())
    }
}
