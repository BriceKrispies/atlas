// Black-box integration test harness for Atlas Platform

pub mod assertions;
pub mod client;
pub mod config;
pub mod fixtures;
pub mod keycloak;

// Re-export commonly used items
pub use assertions::*;
pub use client::TestClient;
pub use config::{KeycloakConfig, TestConfig};
pub use fixtures::*;
pub use keycloak::KeycloakClient;
