use crate::commands::Command;
use crate::commands::itest::{DownCommand, TestCommand, UpCommand};
use anyhow::Result;
use clap::Args;
use colored::Colorize;

#[derive(Debug, Args)]
pub struct RunCommand {
    /// Skip migrations + seed (assume already applied).
    #[arg(long)]
    pub skip_migrations: bool,

    /// Leave the stack running after tests complete instead of tearing it down.
    #[arg(long)]
    pub keep_running: bool,
}

impl Command for RunCommand {
    fn execute(&self) -> Result<()> {
        let up = UpCommand {
            skip_migrations: self.skip_migrations,
            skip_keycloak_wait: false,
        };
        up.execute()?;

        let test = TestCommand {};
        let test_result = test.execute();

        if !self.keep_running {
            let down = DownCommand { keep_infra: false };
            let _ = down.execute();
        }

        match &test_result {
            Ok(()) => println!("{}", "All blackbox tests passed.".green().bold()),
            Err(e) => println!("{} {}", "Blackbox tests failed:".red().bold(), e),
        }
        test_result
    }
}
