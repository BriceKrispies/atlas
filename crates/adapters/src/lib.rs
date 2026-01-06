//! Adapter implementations for port traits.
//!
//! These adapters implement the port traits defined in atlas-platform-runtime:
//! - InMemoryEventStore
//! - InMemoryCache
//! - InMemorySearchEngine
//! - InMemoryAnalyticsStore
//! - PostgresControlPlaneRegistry (requires 'postgres' feature)

pub mod memory;

#[cfg(feature = "postgres")]
pub mod postgres_registry;

pub use memory::*;

#[cfg(feature = "postgres")]
pub use postgres_registry::*;
