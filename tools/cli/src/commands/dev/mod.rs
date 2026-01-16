mod up;
mod seed;
mod tenant;
mod reset;
mod quickstart;
mod status;
mod keycloak;

pub use up::UpCommand;
pub use seed::SeedControlCommand;
pub use tenant::{TenantCreateCommand, TenantDeleteCommand};
pub use reset::ResetCommand;
pub use quickstart::QuickstartCommand;
pub use status::StatusCommand;
pub use keycloak::KeycloakSetupCommand;

use crate::commands::Command;
use anyhow::Result;
use clap::{Args, Subcommand};

#[derive(Debug, Args)]
pub struct DevCommand {
    #[command(subcommand)]
    command: DevSubcommands,
}

#[derive(Debug, Subcommand)]
enum DevSubcommands {
    #[command(about = "Start control plane and dependencies")]
    Up(UpCommand),

    #[command(name = "seed-control", about = "Seed control plane database")]
    SeedControl(SeedControlCommand),

    #[command(about = "Manage tenants")]
    Tenant {
        #[command(subcommand)]
        command: TenantCommands,
    },

    #[command(about = "Reset local dev environment")]
    Reset(ResetCommand),

    #[command(about = "Quick setup: up + seed + create tenant")]
    Quickstart(QuickstartCommand),

    #[command(about = "Show dev environment status")]
    Status(StatusCommand),

    #[command(about = "Setup Keycloak realm, clients, and test user")]
    Keycloak(KeycloakSetupCommand),
}

#[derive(Debug, Subcommand)]
enum TenantCommands {
    #[command(about = "Create a new tenant")]
    Create(TenantCreateCommand),

    #[command(about = "Delete a tenant (dev only)")]
    Delete(TenantDeleteCommand),
}

impl Command for DevCommand {
    fn execute(&self) -> Result<()> {
        match &self.command {
            DevSubcommands::Up(cmd) => cmd.execute(),
            DevSubcommands::SeedControl(cmd) => cmd.execute(),
            DevSubcommands::Tenant { command } => match command {
                TenantCommands::Create(cmd) => cmd.execute(),
                TenantCommands::Delete(cmd) => cmd.execute(),
            },
            DevSubcommands::Reset(cmd) => cmd.execute(),
            DevSubcommands::Quickstart(cmd) => cmd.execute(),
            DevSubcommands::Status(cmd) => cmd.execute(),
            DevSubcommands::Keycloak(cmd) => cmd.execute(),
        }
    }
}
