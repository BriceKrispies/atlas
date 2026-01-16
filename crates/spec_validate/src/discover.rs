//! Fixture discovery module.
//!
//! Walks specs/fixtures directory and parses filenames according to the
//! naming convention: `<kind>__<expect>__<name>.json`

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

/// Fixture kind (domain type category).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Kind {
    EventEnvelope,
    ModuleManifest,
    SearchDocuments,
    AnalyticsEvents,
}

impl Kind {
    /// Parse kind from filename prefix.
    pub fn from_str(s: &str) -> Option<Kind> {
        match s {
            "event_envelope" => Some(Kind::EventEnvelope),
            "module_manifest" => Some(Kind::ModuleManifest),
            "search_documents" => Some(Kind::SearchDocuments),
            "analytics_events" => Some(Kind::AnalyticsEvents),
            _ => None,
        }
    }

    /// Returns all known kinds.
    pub fn all() -> &'static [Kind] {
        &[
            Kind::EventEnvelope,
            Kind::ModuleManifest,
            Kind::SearchDocuments,
            Kind::AnalyticsEvents,
        ]
    }
}

impl fmt::Display for Kind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Kind::EventEnvelope => write!(f, "event_envelope"),
            Kind::ModuleManifest => write!(f, "module_manifest"),
            Kind::SearchDocuments => write!(f, "search_documents"),
            Kind::AnalyticsEvents => write!(f, "analytics_events"),
        }
    }
}

/// Expected validation outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Expect {
    Valid,
    Invalid,
}

impl Expect {
    /// Parse expectation from string.
    pub fn from_str(s: &str) -> Option<Expect> {
        match s {
            "valid" => Some(Expect::Valid),
            "invalid" => Some(Expect::Invalid),
            _ => None,
        }
    }
}

impl fmt::Display for Expect {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Expect::Valid => write!(f, "valid"),
            Expect::Invalid => write!(f, "invalid"),
        }
    }
}

/// A discovered test case.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Case {
    pub kind: Kind,
    pub expect: Expect,
    pub name: String,
    pub path: PathBuf,
}

impl Case {
    /// Returns a display-friendly identifier.
    pub fn id(&self) -> String {
        format!("{}__{}__{}", self.kind, self.expect, self.name)
    }
}

/// Result of parsing a filename.
#[derive(Debug)]
pub enum ParseResult {
    /// Successfully parsed case.
    Ok(Case),
    /// Not a JSON file.
    NotJson(PathBuf),
    /// JSON file but doesn't match convention.
    NoMatch(PathBuf),
}

/// Parse a filename according to the convention (pure parsing, no filesystem checks).
///
/// Convention: `<kind>__<expect>__<name>.json`
///
/// This function only parses the filename string. Use `parse_file` to also
/// check that the path is an existing file.
pub fn parse_filename(path: &Path) -> ParseResult {
    // Must have .json extension
    let extension = path.extension().and_then(|e| e.to_str());
    if extension != Some("json") {
        return ParseResult::NotJson(path.to_path_buf());
    }

    // Get filename without extension
    let stem = match path.file_stem().and_then(|s| s.to_str()) {
        Some(s) => s,
        None => return ParseResult::NoMatch(path.to_path_buf()),
    };

    // Split by double underscore
    let parts: Vec<&str> = stem.split("__").collect();
    if parts.len() != 3 {
        return ParseResult::NoMatch(path.to_path_buf());
    }

    let kind_str = parts[0];
    let expect_str = parts[1];
    let name = parts[2];

    // Parse kind
    let kind = match Kind::from_str(kind_str) {
        Some(k) => k,
        None => return ParseResult::NoMatch(path.to_path_buf()),
    };

    // Parse expectation
    let expect = match Expect::from_str(expect_str) {
        Some(e) => e,
        None => return ParseResult::NoMatch(path.to_path_buf()),
    };

    // Name must not contain double underscore
    if name.contains("__") {
        return ParseResult::NoMatch(path.to_path_buf());
    }

    // Name must not be empty
    if name.is_empty() {
        return ParseResult::NoMatch(path.to_path_buf());
    }

    ParseResult::Ok(Case {
        kind,
        expect,
        name: name.to_string(),
        path: path.to_path_buf(),
    })
}

/// Parse a file path (checks that it's an existing file first).
pub fn parse_file(path: &Path) -> ParseResult {
    if !path.is_file() {
        return ParseResult::NoMatch(path.to_path_buf());
    }
    parse_filename(path)
}

/// Discovery result containing cases and ignored files.
#[derive(Debug, Default)]
pub struct DiscoveryResult {
    pub cases: Vec<Case>,
    pub ignored: Vec<PathBuf>,
}

/// Discover all fixture cases in the given directory.
///
/// Walks the directory recursively, parses filenames, and returns
/// discovered cases sorted by (kind, expect, name).
pub fn discover(fixtures_dir: &Path) -> std::io::Result<DiscoveryResult> {
    let mut result = DiscoveryResult::default();

    walk_directory(fixtures_dir, &mut result)?;

    // Sort cases by (kind, expect, name)
    result.cases.sort();

    Ok(result)
}

fn walk_directory(dir: &Path, result: &mut DiscoveryResult) -> std::io::Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() {
            walk_directory(&path, result)?;
        } else {
            match parse_file(&path) {
                ParseResult::Ok(case) => result.cases.push(case),
                ParseResult::NoMatch(p) => {
                    // Only track .json files that don't match
                    if p.extension().and_then(|e| e.to_str()) == Some("json") {
                        result.ignored.push(p);
                    }
                }
                ParseResult::NotJson(_) => {
                    // Silently ignore non-JSON files (README.md, etc.)
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_parse_valid_event_envelope() {
        let path = Path::new("specs/fixtures/event_envelope__valid__sample.json");
        match parse_filename(path) {
            ParseResult::Ok(case) => {
                assert_eq!(case.kind, Kind::EventEnvelope);
                assert_eq!(case.expect, Expect::Valid);
                assert_eq!(case.name, "sample");
            }
            _ => panic!("Expected Ok"),
        }
    }

    #[test]
    fn test_parse_invalid_event_envelope() {
        let path = Path::new("specs/fixtures/event_envelope__invalid__missing_field.json");
        match parse_filename(path) {
            ParseResult::Ok(case) => {
                assert_eq!(case.kind, Kind::EventEnvelope);
                assert_eq!(case.expect, Expect::Invalid);
                assert_eq!(case.name, "missing_field");
            }
            _ => panic!("Expected Ok"),
        }
    }

    #[test]
    fn test_parse_module_manifest() {
        let path = Path::new("module_manifest__valid__content_pages.json");
        match parse_filename(path) {
            ParseResult::Ok(case) => {
                assert_eq!(case.kind, Kind::ModuleManifest);
                assert_eq!(case.expect, Expect::Valid);
                assert_eq!(case.name, "content_pages");
            }
            _ => panic!("Expected Ok"),
        }
    }

    #[test]
    fn test_parse_search_documents() {
        let path = Path::new("search_documents__valid__sample.json");
        match parse_filename(path) {
            ParseResult::Ok(case) => {
                assert_eq!(case.kind, Kind::SearchDocuments);
                assert_eq!(case.expect, Expect::Valid);
            }
            _ => panic!("Expected Ok"),
        }
    }

    #[test]
    fn test_parse_analytics_events() {
        let path = Path::new("analytics_events__valid__sample.json");
        match parse_filename(path) {
            ParseResult::Ok(case) => {
                assert_eq!(case.kind, Kind::AnalyticsEvents);
                assert_eq!(case.expect, Expect::Valid);
            }
            _ => panic!("Expected Ok"),
        }
    }

    #[test]
    fn test_parse_wrong_extension() {
        let path = Path::new("event_envelope__valid__sample.txt");
        assert!(matches!(parse_filename(path), ParseResult::NotJson(_)));
    }

    #[test]
    fn test_parse_missing_parts() {
        let path = Path::new("event_envelope__valid.json");
        assert!(matches!(parse_filename(path), ParseResult::NoMatch(_)));
    }

    #[test]
    fn test_parse_unknown_kind() {
        let path = Path::new("unknown_type__valid__sample.json");
        assert!(matches!(parse_filename(path), ParseResult::NoMatch(_)));
    }

    #[test]
    fn test_parse_unknown_expect() {
        let path = Path::new("event_envelope__maybe__sample.json");
        assert!(matches!(parse_filename(path), ParseResult::NoMatch(_)));
    }

    #[test]
    fn test_parse_legacy_filename() {
        // Legacy filenames should not match
        let path = Path::new("valid_event_envelope.json");
        assert!(matches!(parse_filename(path), ParseResult::NoMatch(_)));
    }

    #[test]
    fn test_kind_display() {
        assert_eq!(Kind::EventEnvelope.to_string(), "event_envelope");
        assert_eq!(Kind::ModuleManifest.to_string(), "module_manifest");
        assert_eq!(Kind::SearchDocuments.to_string(), "search_documents");
        assert_eq!(Kind::AnalyticsEvents.to_string(), "analytics_events");
    }

    #[test]
    fn test_expect_display() {
        assert_eq!(Expect::Valid.to_string(), "valid");
        assert_eq!(Expect::Invalid.to_string(), "invalid");
    }

    #[test]
    fn test_case_id() {
        let case = Case {
            kind: Kind::EventEnvelope,
            expect: Expect::Valid,
            name: "sample".to_string(),
            path: PathBuf::from("test.json"),
        };
        assert_eq!(case.id(), "event_envelope__valid__sample");
    }
}
