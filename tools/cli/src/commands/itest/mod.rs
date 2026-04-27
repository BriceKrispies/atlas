mod down;
mod run;
mod status;
mod test;
mod up;

pub use down::DownCommand;
pub use run::RunCommand as ItestRunCommand;
pub use status::StatusCommand;
pub use test::TestCommand;
pub use up::UpCommand;

use crate::commands::Command;
use anyhow::Result;
use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct ItestCommand {
    #[command(subcommand)]
    command: ItestSubcommands,
}

#[derive(Debug, Subcommand)]
enum ItestSubcommands {
    #[command(about = "Bring up infra (postgres+keycloak in podman) and spawn ingress/control-plane/workers as host processes")]
    Up(UpCommand),

    #[command(about = "Stop the host services and tear down the infra containers")]
    Down(DownCommand),

    #[command(about = "Show stack health and PIDs")]
    Status(StatusCommand),

    #[command(about = "Run the blackbox test suites against a running stack")]
    Test(TestCommand),

    #[command(about = "up + test + down (the full e2e workflow)")]
    Run(ItestRunCommand),
}

impl Command for ItestCommand {
    fn execute(&self) -> Result<()> {
        match &self.command {
            ItestSubcommands::Up(c) => c.execute(),
            ItestSubcommands::Down(c) => c.execute(),
            ItestSubcommands::Status(c) => c.execute(),
            ItestSubcommands::Test(c) => c.execute(),
            ItestSubcommands::Run(c) => c.execute(),
        }
    }
}
