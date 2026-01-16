//! JSON loading and field stripping.
//!
//! Provides utilities for loading JSON fixtures and stripping
//! documentation fields (prefixed with `$`).

use serde_json::Value;
use std::fs;
use std::path::Path;

/// Error type for JSON loading.
#[derive(Debug)]
pub enum JsonError {
    /// Failed to read file.
    ReadError { path: String, error: std::io::Error },
    /// Failed to parse JSON.
    ParseError {
        path: String,
        error: serde_json::Error,
    },
}

impl std::fmt::Display for JsonError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JsonError::ReadError { path, error } => {
                write!(f, "Failed to read '{}': {}", path, error)
            }
            JsonError::ParseError { path, error } => {
                write!(f, "Failed to parse JSON '{}': {}", path, error)
            }
        }
    }
}

impl std::error::Error for JsonError {}

/// Load JSON from a file.
pub fn load(path: &Path) -> Result<Value, JsonError> {
    let content = fs::read_to_string(path).map_err(|e| JsonError::ReadError {
        path: path.display().to_string(),
        error: e,
    })?;

    serde_json::from_str(&content).map_err(|e| JsonError::ParseError {
        path: path.display().to_string(),
        error: e,
    })
}

/// Strip documentation fields (prefixed with `$`) from a JSON value.
///
/// This recursively removes all fields that start with `$` from objects,
/// and processes arrays and nested objects.
///
/// Documentation fields are metadata like `$schema`, `$comment`, `$invariants`
/// that are not part of the actual data structure.
pub fn strip_doc_fields(value: Value) -> Value {
    match value {
        Value::Object(mut map) => {
            // Remove all keys starting with '$'
            map.retain(|k, _| !k.starts_with('$'));
            // Recursively process remaining values
            let processed: serde_json::Map<String, Value> = map
                .into_iter()
                .map(|(k, v)| (k, strip_doc_fields(v)))
                .collect();
            Value::Object(processed)
        }
        Value::Array(arr) => {
            // Recursively process array elements
            Value::Array(arr.into_iter().map(strip_doc_fields).collect())
        }
        // Other value types pass through unchanged
        other => other,
    }
}

/// Load JSON from a file and strip documentation fields.
pub fn load_and_strip(path: &Path) -> Result<Value, JsonError> {
    let value = load(path)?;
    Ok(strip_doc_fields(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_strip_doc_fields_simple_object() {
        let input = json!({
            "$schema": "http://example.com/schema.json",
            "$comment": "This is a comment",
            "name": "test",
            "value": 42
        });

        let result = strip_doc_fields(input);

        assert_eq!(
            result,
            json!({
                "name": "test",
                "value": 42
            })
        );
    }

    #[test]
    fn test_strip_doc_fields_nested_object() {
        let input = json!({
            "$comment": "Top level",
            "outer": {
                "$schema": "nested schema",
                "inner": "value"
            }
        });

        let result = strip_doc_fields(input);

        assert_eq!(
            result,
            json!({
                "outer": {
                    "inner": "value"
                }
            })
        );
    }

    #[test]
    fn test_strip_doc_fields_array() {
        let input = json!([
            { "$comment": "First", "id": 1 },
            { "$comment": "Second", "id": 2 }
        ]);

        let result = strip_doc_fields(input);

        assert_eq!(result, json!([{ "id": 1 }, { "id": 2 }]));
    }

    #[test]
    fn test_strip_doc_fields_deeply_nested() {
        let input = json!({
            "$root": "removed",
            "level1": {
                "$l1": "removed",
                "level2": {
                    "$l2": "removed",
                    "level3": {
                        "$l3": "removed",
                        "data": "kept"
                    }
                }
            }
        });

        let result = strip_doc_fields(input);

        assert_eq!(
            result,
            json!({
                "level1": {
                    "level2": {
                        "level3": {
                            "data": "kept"
                        }
                    }
                }
            })
        );
    }

    #[test]
    fn test_strip_doc_fields_array_of_arrays() {
        let input = json!([
            [{ "$meta": "a", "val": 1 }],
            [{ "$meta": "b", "val": 2 }]
        ]);

        let result = strip_doc_fields(input);

        assert_eq!(result, json!([[{ "val": 1 }], [{ "val": 2 }]]));
    }

    #[test]
    fn test_strip_doc_fields_primitives_unchanged() {
        assert_eq!(strip_doc_fields(json!(null)), json!(null));
        assert_eq!(strip_doc_fields(json!(true)), json!(true));
        assert_eq!(strip_doc_fields(json!(42)), json!(42));
        assert_eq!(strip_doc_fields(json!(3.14)), json!(3.14));
        assert_eq!(strip_doc_fields(json!("hello")), json!("hello"));
    }

    #[test]
    fn test_strip_doc_fields_empty_object() {
        let input = json!({
            "$only": "doc fields"
        });

        let result = strip_doc_fields(input);

        assert_eq!(result, json!({}));
    }

    #[test]
    fn test_strip_doc_fields_dollar_in_value() {
        // Dollar signs in VALUES should be preserved
        let input = json!({
            "price": "$100",
            "$comment": "removed"
        });

        let result = strip_doc_fields(input);

        assert_eq!(
            result,
            json!({
                "price": "$100"
            })
        );
    }

    #[test]
    fn test_strip_doc_fields_mixed_array() {
        let input = json!([
            { "$meta": "a", "id": 1 },
            "plain string",
            42,
            null,
            [{ "$nested": true, "data": "value" }]
        ]);

        let result = strip_doc_fields(input);

        assert_eq!(
            result,
            json!([{ "id": 1 }, "plain string", 42, null, [{ "data": "value" }]])
        );
    }
}
