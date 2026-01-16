//! Spec Validation CLI
//!
//! Validates golden fixtures against atlas_core domain types and validation rules.
//!
//! ## Usage
//!
//! ```bash
//! # Validate all fixtures
//! cargo run -p spec_validate
//!
//! # Filter by kind
//! cargo run -p spec_validate -- --kind event_envelope
//! cargo run -p spec_validate -- --kind event_envelope --kind module_manifest
//!
//! # Filter by expectation
//! cargo run -p spec_validate -- --expect valid
//! cargo run -p spec_validate -- --expect invalid
//!
//! # List discovered fixtures
//! cargo run -p spec_validate -- --list
//! ```

use spec_validate::discover::{self, Expect, Kind};
use spec_validate::{run_validation, Outcome, RunOptions};
use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args = parse_args();

    if args.help {
        print_help();
        return ExitCode::SUCCESS;
    }

    let fixtures_dir = PathBuf::from("specs/fixtures");
    if !fixtures_dir.exists() {
        eprintln!("Error: Fixtures directory not found: {}", fixtures_dir.display());
        return ExitCode::FAILURE;
    }

    // Discover fixtures
    let discovery = match discover::discover(&fixtures_dir) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("Error: Failed to discover fixtures: {}", e);
            return ExitCode::FAILURE;
        }
    };

    // Print warnings for ignored files
    if !discovery.ignored.is_empty() {
        eprintln!("\nWarning: {} JSON file(s) ignored (filename doesn't match convention):",
            discovery.ignored.len());
        for path in &discovery.ignored {
            eprintln!("  - {}", path.display());
        }
        eprintln!();
    }

    // Handle --list
    if args.list {
        println!("Discovered {} fixture(s):\n", discovery.cases.len());
        for case in &discovery.cases {
            let mark = match case.expect {
                Expect::Valid => "+",
                Expect::Invalid => "-",
            };
            println!("  [{}] {} :: {}", mark, case.kind, case.name);
        }
        return ExitCode::SUCCESS;
    }

    // Build run options
    let options = RunOptions {
        kinds: args.kinds,
        expect: args.expect,
    };

    // Run validation
    println!("=== Spec Validation ===\n");

    let summary = run_validation(&discovery.cases, &options);

    // Print results
    for result in &summary.results {
        let status = match &result.outcome {
            Outcome::Pass => {
                let suffix = if result.case.expect == Expect::Invalid {
                    " (correctly rejected)"
                } else {
                    ""
                };
                format!("\x1b[32m\u{2713} PASS{}\x1b[0m", suffix)
            }
            Outcome::Fail(msg) => format!("\x1b[31m\u{2717} FAIL: {}\x1b[0m", msg),
        };
        println!("{} ... {}", result.case.id(), status);
    }

    // Print summary
    println!("\n=== Summary ===");
    println!("Total:  {}", summary.total);
    println!("Passed: {}", summary.passed);
    println!("Failed: {}", summary.failed);

    if summary.is_success() {
        println!("\n\x1b[32m\u{2713} All fixtures validated successfully\x1b[0m");
        ExitCode::SUCCESS
    } else {
        println!("\n\x1b[31m\u{2717} {} fixture(s) failed validation\x1b[0m", summary.failed);
        ExitCode::FAILURE
    }
}

#[derive(Debug, Default)]
struct Args {
    help: bool,
    list: bool,
    kinds: Vec<Kind>,
    expect: Option<Expect>,
}

fn parse_args() -> Args {
    let mut args = Args::default();
    let mut argv: Vec<String> = env::args().skip(1).collect();

    while !argv.is_empty() {
        let arg = argv.remove(0);
        match arg.as_str() {
            "-h" | "--help" => args.help = true,
            "-l" | "--list" => args.list = true,
            "-k" | "--kind" => {
                if let Some(value) = argv.first() {
                    if let Some(kind) = Kind::from_str(value) {
                        args.kinds.push(kind);
                        argv.remove(0);
                    } else {
                        eprintln!("Warning: Unknown kind '{}', ignoring", value);
                        argv.remove(0);
                    }
                }
            }
            "-e" | "--expect" => {
                if let Some(value) = argv.first() {
                    if let Some(expect) = Expect::from_str(value) {
                        args.expect = Some(expect);
                        argv.remove(0);
                    } else {
                        eprintln!("Warning: Unknown expect '{}', ignoring", value);
                        argv.remove(0);
                    }
                }
            }
            other => {
                // Handle --kind=value and --expect=value forms
                if let Some(rest) = other.strip_prefix("--kind=") {
                    if let Some(kind) = Kind::from_str(rest) {
                        args.kinds.push(kind);
                    } else {
                        eprintln!("Warning: Unknown kind '{}', ignoring", rest);
                    }
                } else if let Some(rest) = other.strip_prefix("--expect=") {
                    if let Some(expect) = Expect::from_str(rest) {
                        args.expect = Some(expect);
                    } else {
                        eprintln!("Warning: Unknown expect '{}', ignoring", rest);
                    }
                } else {
                    eprintln!("Warning: Unknown argument '{}', ignoring", other);
                }
            }
        }
    }

    args
}

fn print_help() {
    println!(
        r#"spec_validate - Validate golden fixtures against domain types

USAGE:
    cargo run -p spec_validate [OPTIONS]

OPTIONS:
    -h, --help              Print this help message
    -l, --list              List discovered fixtures without validating
    -k, --kind <KIND>       Filter by kind (repeatable)
    -e, --expect <EXPECT>   Filter by expectation

KINDS:
    event_envelope          Event envelope fixtures
    module_manifest         Module manifest fixtures
    search_documents        Search document fixtures
    analytics_events        Analytics event fixtures

EXPECTS:
    valid                   Fixtures expected to pass validation
    invalid                 Fixtures expected to fail validation

FILENAME CONVENTION:
    <kind>__<expect>__<name>.json

EXAMPLES:
    # Validate all fixtures
    cargo run -p spec_validate

    # Validate only event envelopes
    cargo run -p spec_validate -- --kind event_envelope

    # Validate only invalid fixtures
    cargo run -p spec_validate -- --expect invalid

    # List all discovered fixtures
    cargo run -p spec_validate -- --list
"#
    );
}
