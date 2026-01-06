use anyhow::Result;
use atlas_cli::commands::{Command, DevCommand, GenCommand, ModuleCommand, RunAllCommand, RunCommand, ScaffoldCommand, ValidateCommand};
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "atlas")]
#[command(about = "Atlas microservices CLI - Wire up services mechanically", long_about = None)]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    #[command(about = "Scaffold a new service")]
    Scaffold(ScaffoldCommand),

    #[command(about = "Validate all service manifests")]
    Validate(ValidateCommand),

    #[command(about = "Generate infrastructure from service manifests")]
    Gen(GenCommand),

    #[command(about = "Run a specific service")]
    Run(RunCommand),

    #[command(name = "run-all", about = "Run all services concurrently")]
    RunAll(RunAllCommand),

    #[command(about = "Manage local dev environment")]
    Dev(DevCommand),

    #[command(about = "Manage modules as crates")]
    Module(ModuleCommand),
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Scaffold(cmd) => cmd.execute(),
        Commands::Validate(cmd) => cmd.execute(),
        Commands::Gen(cmd) => cmd.execute(),
        Commands::Run(cmd) => cmd.execute(),
        Commands::RunAll(cmd) => cmd.execute(),
        Commands::Dev(cmd) => cmd.execute(),
        Commands::Module(cmd) => cmd.execute(),
    }
}
