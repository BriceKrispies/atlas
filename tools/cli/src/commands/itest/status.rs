use crate::commands::Command;
use crate::itest_supervisor::ItestSupervisor;
use anyhow::Result;
use clap::Args;
use colored::Colorize;

#[derive(Debug, Args)]
pub struct StatusCommand {}

impl Command for StatusCommand {
    fn execute(&self) -> Result<()> {
        let sup = ItestSupervisor::new()?;
        let env = sup.env();

        println!("{}", "Atlas itest stack status".bold());
        println!();
        for service in ["control-plane", "ingress", "workers"] {
            let running = sup.is_service_running(service);
            let mark = if running { "✓".green() } else { "✗".red() };
            println!(
                "  {} {:13}  pid file: .itest/{}.pid",
                mark, service, service
            );
        }
        println!();
        println!("  Postgres:      localhost:{}", env.postgres_port);
        println!("  Keycloak:      http://localhost:{}", env.keycloak_port);
        println!(
            "  Control plane: http://localhost:{}/healthz",
            env.control_plane_port
        );
        println!(
            "  Ingress:       http://localhost:{}/",
            env.ingress_port
        );
        println!(
            "  Workers:       http://localhost:{}/metrics",
            env.workers_metrics_port
        );
        println!();
        Ok(())
    }
}
