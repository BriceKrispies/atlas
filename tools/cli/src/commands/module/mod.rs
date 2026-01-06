pub mod scaffold;
pub mod validate;

use crate::commands::Command;
use anyhow::Result;
use clap::{Args, Subcommand};

pub use scaffold::ModuleScaffoldCommand;
pub use validate::ModuleValidateCommand;

#[derive(Debug, Args)]
pub struct ModuleCommand {
    #[command(subcommand)]
    command: ModuleSubcommands,
}

#[derive(Debug, Subcommand)]
enum ModuleSubcommands {
    #[command(about = "Scaffold a module crate from a manifest")]
    Scaffold(ModuleScaffoldCommand),

    #[command(about = "Validate module manifest(s)")]
    Validate(ModuleValidateCommand),
}

impl Command for ModuleCommand {
    fn execute(&self) -> Result<()> {
        match &self.command {
            ModuleSubcommands::Scaffold(cmd) => cmd.execute(),
            ModuleSubcommands::Validate(cmd) => cmd.execute(),
        }
    }
}
