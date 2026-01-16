//! Spec Validation Library
//!
//! This crate is a CI/dev-time harness for validating fixtures against
//! atlas_core domain types and validation rules.
//!
//! ## Architecture
//!
//! - `discover` - Walks specs/fixtures and parses filenames
//! - `json` - Loads JSON and strips documentation fields
//! - `validate` - Adapters that call into atlas_core::validation
//!
//! ## Filename Convention
//!
//! `<kind>__<expect>__<name>.json`
//!
//! - `kind`: event_envelope | module_manifest | search_documents | analytics_events
//! - `expect`: valid | invalid
//! - `name`: freeform, no double underscores
//!
//! ## Usage
//!
//! ```no_run
//! use spec_validate::{discover, run_validation, RunOptions};
//! use std::path::Path;
//!
//! let result = discover::discover(Path::new("specs/fixtures")).unwrap();
//! let summary = run_validation(&result.cases, &RunOptions::default());
//! ```

pub mod discover;
pub mod json;
pub mod validate;

use discover::{Case, Expect, Kind};

/// Options for running validation.
#[derive(Debug, Default, Clone)]
pub struct RunOptions {
    /// Filter by kinds (empty = all kinds).
    pub kinds: Vec<Kind>,
    /// Filter by expectation (None = all).
    pub expect: Option<Expect>,
}

impl RunOptions {
    /// Check if a case matches the filters.
    pub fn matches(&self, case: &Case) -> bool {
        let kind_matches = self.kinds.is_empty() || self.kinds.contains(&case.kind);
        let expect_matches = self.expect.is_none() || self.expect == Some(case.expect);
        kind_matches && expect_matches
    }
}

/// Result of validating a single case.
#[derive(Debug)]
pub struct CaseResult {
    pub case: Case,
    pub outcome: Outcome,
}

/// Validation outcome for a case.
#[derive(Debug)]
pub enum Outcome {
    /// Validation passed as expected.
    Pass,
    /// Validation failed unexpectedly.
    Fail(String),
}

impl CaseResult {
    pub fn is_pass(&self) -> bool {
        matches!(self.outcome, Outcome::Pass)
    }
}

/// Summary of a validation run.
#[derive(Debug, Default)]
pub struct RunSummary {
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub results: Vec<CaseResult>,
}

impl RunSummary {
    pub fn is_success(&self) -> bool {
        self.failed == 0
    }
}

/// Run validation on a set of cases.
pub fn run_validation(cases: &[Case], options: &RunOptions) -> RunSummary {
    let mut summary = RunSummary::default();

    for case in cases {
        if !options.matches(case) {
            continue;
        }

        summary.total += 1;
        let result = validate_case(case);

        if result.is_pass() {
            summary.passed += 1;
        } else {
            summary.failed += 1;
        }

        summary.results.push(result);
    }

    summary
}

/// Validate a single case.
fn validate_case(case: &Case) -> CaseResult {
    // Load and strip JSON
    let value = match json::load_and_strip(&case.path) {
        Ok(v) => v,
        Err(e) => {
            return CaseResult {
                case: case.clone(),
                outcome: Outcome::Fail(format!("JSON load error: {}", e)),
            };
        }
    };

    // Run validation
    let validation_result = validate::validate(case.kind, value);

    // Determine outcome based on expectation
    let outcome = match (case.expect, validation_result) {
        // Expected valid, validation passed -> PASS
        (Expect::Valid, Ok(())) => Outcome::Pass,
        // Expected valid, validation failed -> FAIL
        (Expect::Valid, Err(e)) => {
            Outcome::Fail(format!("Expected valid but got: {}", e))
        }
        // Expected invalid, validation failed -> PASS (correctly rejected)
        (Expect::Invalid, Err(_)) => Outcome::Pass,
        // Expected invalid, validation passed -> FAIL
        (Expect::Invalid, Ok(())) => {
            Outcome::Fail("Expected invalid but validation passed".to_string())
        }
    };

    CaseResult {
        case: case.clone(),
        outcome,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_run_options_matches_all() {
        let opts = RunOptions::default();
        let case = Case {
            kind: Kind::EventEnvelope,
            expect: Expect::Valid,
            name: "test".to_string(),
            path: PathBuf::new(),
        };
        assert!(opts.matches(&case));
    }

    #[test]
    fn test_run_options_matches_kind_filter() {
        let opts = RunOptions {
            kinds: vec![Kind::EventEnvelope],
            expect: None,
        };

        let matching = Case {
            kind: Kind::EventEnvelope,
            expect: Expect::Valid,
            name: "test".to_string(),
            path: PathBuf::new(),
        };
        assert!(opts.matches(&matching));

        let non_matching = Case {
            kind: Kind::ModuleManifest,
            expect: Expect::Valid,
            name: "test".to_string(),
            path: PathBuf::new(),
        };
        assert!(!opts.matches(&non_matching));
    }

    #[test]
    fn test_run_options_matches_expect_filter() {
        let opts = RunOptions {
            kinds: vec![],
            expect: Some(Expect::Invalid),
        };

        let matching = Case {
            kind: Kind::EventEnvelope,
            expect: Expect::Invalid,
            name: "test".to_string(),
            path: PathBuf::new(),
        };
        assert!(opts.matches(&matching));

        let non_matching = Case {
            kind: Kind::EventEnvelope,
            expect: Expect::Valid,
            name: "test".to_string(),
            path: PathBuf::new(),
        };
        assert!(!opts.matches(&non_matching));
    }
}
