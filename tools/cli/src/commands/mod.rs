pub mod scaffold;
pub mod validate;
pub mod gen;
pub mod run;
pub mod dev;
pub mod itest;
pub mod module;

use anyhow::Result;

pub trait Command {
    fn execute(&self) -> Result<()>;
}

pub use scaffold::ScaffoldCommand;
pub use validate::ValidateCommand;
pub use gen::GenCommand;
pub use run::{RunCommand, RunAllCommand};
pub use dev::DevCommand;
pub use itest::ItestCommand;
pub use module::ModuleCommand;
