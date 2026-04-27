//! Adapter implementations for port traits.
//!
//! These adapters implement the port traits defined in atlas-platform-runtime:
//! - InMemoryEventStore
//! - InMemoryCache
//! - InMemorySearchEngine
//! - InMemoryAnalyticsStore
//! - InMemoryTenantDbProvider (requires 'postgres' feature; always errors)
//! - PostgresControlPlaneRegistry (requires 'postgres' feature)
//! - PostgresTenantDbProvider (requires 'postgres' feature)
//! - PostgresSearchEngine (requires 'postgres' feature)

pub mod memory;

#[cfg(feature = "postgres")]
pub mod postgres_registry;

#[cfg(feature = "postgres")]
pub mod postgres_search;

#[cfg(feature = "postgres")]
pub mod postgres_tenant_db;

pub use memory::*;

#[cfg(feature = "postgres")]
pub use postgres_registry::*;

#[cfg(feature = "postgres")]
pub use postgres_search::*;

#[cfg(feature = "postgres")]
pub use postgres_tenant_db::*;
