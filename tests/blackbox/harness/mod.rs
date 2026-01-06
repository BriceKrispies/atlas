// Black-box integration test harness for Atlas Platform

pub mod client;
pub mod config;
pub mod fixtures;
pub mod assertions;

// Re-export commonly used items
pub use client::TestClient;
pub use config::TestConfig;
pub use fixtures::*;
pub use assertions::*;
