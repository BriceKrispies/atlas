use crate::commands::Command;
use crate::itest_supervisor::ItestSupervisor;
use anyhow::Result;
use clap::Args;

#[derive(Debug, Args)]
pub struct TestCommand {}

impl Command for TestCommand {
    fn execute(&self) -> Result<()> {
        let sup = ItestSupervisor::new()?;
        sup.run_blackbox_tests()
    }
}
