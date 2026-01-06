use crate::commands::dev::{
    SeedControlCommand, TenantCreateCommand, UpCommand,
};
use crate::commands::Command;
use anyhow::Result;
use clap::Args;
use colored::Colorize;

#[derive(Debug, Args)]
pub struct QuickstartCommand {
    #[arg(help = "Tenant key/identifier to create")]
    pub tenant_key: String,

    #[arg(long, help = "Tenant display name")]
    pub name: Option<String>,
}

impl Command for QuickstartCommand {
    fn execute(&self) -> Result<()> {
        println!(
            "{}",
            "🚀 Starting Atlas dev quickstart...".cyan().bold()
        );
        println!();

        println!("{}", "Step 1/3: Starting services".bold());
        let up_cmd = UpCommand {
            detach: true,
            skip_migrations: false,
        };
        up_cmd.execute()?;
        println!();

        println!("{}", "Step 2/3: Seeding control plane".bold());
        let seed_cmd = SeedControlCommand {};
        seed_cmd.execute()?;
        println!();

        println!("{}", "Step 3/3: Creating tenant".bold());
        let tenant_cmd = TenantCreateCommand {
            tenant_key: self.tenant_key.clone(),
            name: self.name.clone(),
            region: None,
            skip_migrate: false,
            skip_seed: false,
            json: false,
        };
        tenant_cmd.execute()?;
        println!();

        println!(
            "{}",
            "✨ Quickstart complete! Your dev environment is ready.".green().bold()
        );
        println!("\n{}", "Next steps:".bold());
        println!("  • View status:  atlas dev status");
        println!("  • View logs:    atlas dev logs");
        println!("  • Create tenant: atlas dev tenant create <key>");

        Ok(())
    }
}
