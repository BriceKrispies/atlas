//! Runtime abstractions: ports, action registry, projection runner.
//!
//! This crate defines the ports (trait interfaces) for the hexagonal architecture:
//! - EventStore: Append and read events
//! - Cache: Get/set/invalidate with tag-based invalidation
//! - SearchEngine: Index and query documents
//! - ProjectionRunner: Apply events to projections
//!
//! Adapters (in crates/adapters) implement these ports.

pub mod cache_helpers;
pub mod ports;
pub mod registry;
pub mod singleflight;

pub use cache_helpers::*;
pub use ports::*;
pub use registry::*;
pub use singleflight::*;
