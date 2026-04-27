use crate::commands::Command;
use crate::itest_supervisor::ItestSupervisor;
use anyhow::Result;
use clap::Args;
use colored::Colorize;

#[derive(Debug, Args)]
pub struct UpCommand {
    /// Skip control plane migrations + seed (assume already applied).
    #[arg(long)]
    pub skip_migrations: bool,

    /// Skip Keycloak readiness wait (useful when realm isn't required for the
    /// next test step).
    #[arg(long)]
    pub skip_keycloak_wait: bool,
}

impl Command for UpCommand {
    fn execute(&self) -> Result<()> {
        println!("{}", "Atlas itest hybrid stack — bringing up...".cyan().bold());

        let sup = ItestSupervisor::new()?;

        sup.infra_up(true)?;
        sup.wait_for_postgres()?;
        if !self.skip_keycloak_wait {
            sup.wait_for_keycloak()?;
        }

        if !self.skip_migrations {
            sup.run_control_plane_migrations()?;
            sup.seed_control_plane()?;
        }

        sup.build_services()?;

        sup.spawn_service("control-plane")?;
        sup.wait_for_service_health("control-plane")?;

        sup.spawn_service("ingress")?;
        sup.wait_for_service_health("ingress")?;

        sup.spawn_service("workers")?;
        sup.wait_for_service_health("workers")?;

        sup.print_summary();
        println!("{}", "Stack ready.".green().bold());
        Ok(())
    }
}
