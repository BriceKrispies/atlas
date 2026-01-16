//! Atlas Platform Specification Compiler
//!
//! This crate contains the core compiler for the Atlas platform specification system.
//! It implements the complete compilation pipeline:
//!
//! - **Discovery**: File discovery and input enumeration (discovery rules D1-D8)
//! - **Validation**: Schema validation and conformance checking against normative requirements
//! - **IR**: Intermediate representation generation
//! - **Codegen**: Code generation from validated IR
//!
//! Execution of the compiler is driven by the CLI in `tools/cli`.
//!
//! # Example
//!
//! ```no_run
//! use atlas_compiler::Compiler;
//! use atlas_compiler::discover;
//!
//! // Discover all input files from the specs directory
//! let inputs = discover::discover("specs").expect("Failed to discover inputs");
//! println!("Discovered {} files", inputs.len());
//!
//! // Create compiler instance for processing
//! let compiler = Compiler::new();
//! ```

pub mod codegen;
pub mod discover;
pub mod ir;
pub mod validate;

// Re-export commonly used types
pub use discover::{DiscoveredInput, SchemaKind, ValidationTarget};

/// Atlas platform specification compiler.
///
/// This is the main entry point for the compiler pipeline. It orchestrates
/// discovery, validation, IR generation, and code generation phases.
pub struct Compiler {
    _private: (),
}

impl Compiler {
    /// Creates a new compiler instance.
    pub fn new() -> Self {
        Self { _private: () }
    }
}

impl Default for Compiler {
    fn default() -> Self {
        Self::new()
    }
}
