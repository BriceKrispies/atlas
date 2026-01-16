//! Ingress library - exports types and utilities for testing.
//!
//! The main ingress service is in `main.rs` (binary target).
//! This library exposes authentication and authorization types for integration tests.

pub mod authn;
pub mod authz;
pub mod schema;
