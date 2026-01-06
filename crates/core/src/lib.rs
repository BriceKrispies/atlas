//! Core domain contracts, types, and pure business logic.
//!
//! This crate contains:
//! - Domain types (EventEnvelope, ModuleManifest, Policy, etc.)
//! - Policy evaluation (ABAC with deny-overrides-allow semantics)
//! - Schema validation helpers
//! - No I/O, no side effects - pure functions only

pub mod cache;
pub mod logging;
pub mod policy;
pub mod types;
pub mod validation;

pub use cache::*;
pub use logging::*;
pub use policy::{evaluate_policy, PolicyDecision, PolicyEngine};
pub use types::*;
pub use validation::*;

pub use atlas_diagnostics::{guardrail, init_observability, mvp_shortcut, tech_debt};
