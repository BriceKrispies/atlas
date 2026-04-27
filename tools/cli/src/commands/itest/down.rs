use crate::commands::Command;
use crate::itest_supervisor::ItestSupervisor;
use anyhow::Result;
use clap::Args;
use colored::Colorize;

#[derive(Debug, Args)]
pub struct DownCommand {
    /// Keep the postgres + keycloak containers running; only stop host services.
    #[arg(long)]
    pub keep_infra: bool,
}

impl Command for DownCommand {
    fn execute(&self) -> Result<()> {
        let sup = ItestSupervisor::new()?;
        sup.stop_all_services()?;
        if !self.keep_infra {
            sup.infra_down()?;
        }
        println!("{}", "Stack torn down.".green().bold());
        Ok(())
    }
}
