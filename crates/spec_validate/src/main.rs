//! Spec validation tool - validates golden fixtures against domain types.
//!
//! Loads fixtures from /specs/fixtures and validates:
//! - JSON parsing succeeds
//! - Required fields are present
//! - Invariants are satisfied (e.g., idempotencyKey for events)

use anyhow::{Context, Result};
use atlas_core::types::{AnalyticsEvent, EventEnvelope, ModuleManifest, SearchDocument};
use atlas_core::validation::validate_event_envelope;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn main() -> Result<()> {
    println!("=== Spec Validation ===\n");

    let fixtures_dir = PathBuf::from("specs/fixtures");
    if !fixtures_dir.exists() {
        anyhow::bail!("Fixtures directory not found: {}", fixtures_dir.display());
    }

    let mut total = 0;
    let mut passed = 0;
    let mut failed = 0;

    // Validate event envelope fixtures
    let event_fixtures = vec![
        "valid_event_envelope.json",
        "sample_page_create_intent.json",
        "expected_page_created_event.json",
    ];

    for fixture_name in event_fixtures {
        total += 1;
        print!("Validating {} ... ", fixture_name);
        match validate_event_fixture(&fixtures_dir, fixture_name) {
            Ok(_) => {
                println!("✓ PASS");
                passed += 1;
            }
            Err(e) => {
                println!("✗ FAIL: {}", e);
                failed += 1;
            }
        }
    }

    // Validate invalid envelope (should fail parsing but succeed as test)
    total += 1;
    print!("Validating invalid_event_envelope_missing_idempotency.json ... ");
    match validate_invalid_event_fixture(
        &fixtures_dir,
        "invalid_event_envelope_missing_idempotency.json",
    ) {
        Ok(_) => {
            println!("✓ PASS (correctly rejected)");
            passed += 1;
        }
        Err(e) => {
            println!("✗ FAIL: {}", e);
            failed += 1;
        }
    }

    // Validate module manifest
    total += 1;
    print!("Validating sample_module_manifest.json ... ");
    match validate_module_manifest_fixture(&fixtures_dir, "sample_module_manifest.json") {
        Ok(_) => {
            println!("✓ PASS");
            passed += 1;
        }
        Err(e) => {
            println!("✗ FAIL: {}", e);
            failed += 1;
        }
    }

    // Validate search documents
    total += 1;
    print!("Validating search_documents.json ... ");
    match validate_search_documents_fixture(&fixtures_dir, "search_documents.json") {
        Ok(_) => {
            println!("✓ PASS");
            passed += 1;
        }
        Err(e) => {
            println!("✗ FAIL: {}", e);
            failed += 1;
        }
    }

    // Validate analytics events
    total += 1;
    print!("Validating analytics_events.json ... ");
    match validate_analytics_events_fixture(&fixtures_dir, "analytics_events.json") {
        Ok(_) => {
            println!("✓ PASS");
            passed += 1;
        }
        Err(e) => {
            println!("✗ FAIL: {}", e);
            failed += 1;
        }
    }

    println!("\n=== Summary ===");
    println!("Total:  {}", total);
    println!("Passed: {}", passed);
    println!("Failed: {}", failed);

    if failed > 0 {
        anyhow::bail!("{} fixtures failed validation", failed);
    }

    println!("\n✓ All fixtures validated successfully");
    Ok(())
}

fn load_fixture(fixtures_dir: &Path, filename: &str) -> Result<Value> {
    let path = fixtures_dir.join(filename);
    let content = fs::read_to_string(&path)
        .with_context(|| format!("Failed to read fixture: {}", path.display()))?;
    let value: Value = serde_json::from_str(&content)
        .with_context(|| format!("Failed to parse JSON: {}", path.display()))?;
    Ok(value)
}

fn strip_doc_fields(mut value: Value) -> Value {
    if let Some(obj) = value.as_object_mut() {
        obj.retain(|k, _| !k.starts_with('$'));
        for v in obj.values_mut() {
            *v = strip_doc_fields(v.clone());
        }
    } else if let Some(arr) = value.as_array_mut() {
        for v in arr.iter_mut() {
            *v = strip_doc_fields(v.clone());
        }
    }
    value
}

fn validate_event_fixture(fixtures_dir: &Path, filename: &str) -> Result<()> {
    let value = load_fixture(fixtures_dir, filename)?;
    let value = strip_doc_fields(value);
    let envelope: EventEnvelope =
        serde_json::from_value(value).context("Failed to deserialize EventEnvelope")?;
    validate_event_envelope(&envelope).context("EventEnvelope validation failed")?;
    Ok(())
}

fn validate_invalid_event_fixture(fixtures_dir: &Path, filename: &str) -> Result<()> {
    let value = load_fixture(fixtures_dir, filename)?;
    let value = strip_doc_fields(value);
    let envelope: EventEnvelope =
        serde_json::from_value(value).context("Failed to deserialize EventEnvelope")?;
    // This should fail validation
    match validate_event_envelope(&envelope) {
        Ok(_) => anyhow::bail!("Expected validation to fail but it passed"),
        Err(_) => Ok(()),
    }
}

fn validate_module_manifest_fixture(fixtures_dir: &Path, filename: &str) -> Result<()> {
    let value = load_fixture(fixtures_dir, filename)?;
    let value = strip_doc_fields(value);
    let _manifest: ModuleManifest =
        serde_json::from_value(value).context("Failed to deserialize ModuleManifest")?;
    Ok(())
}

fn validate_search_documents_fixture(fixtures_dir: &Path, filename: &str) -> Result<()> {
    let value = load_fixture(fixtures_dir, filename)?;
    let value = strip_doc_fields(value);
    let obj = value.as_object().context("Expected object at root")?;
    let docs = obj.get("documents").context("Missing 'documents' field")?;
    let _documents: Vec<SearchDocument> = serde_json::from_value(docs.clone())
        .context("Failed to deserialize SearchDocument array")?;
    Ok(())
}

fn validate_analytics_events_fixture(fixtures_dir: &Path, filename: &str) -> Result<()> {
    let value = load_fixture(fixtures_dir, filename)?;
    let value = strip_doc_fields(value);
    let obj = value.as_object().context("Expected object at root")?;
    let events = obj.get("events").context("Missing 'events' field")?;
    let _events: Vec<AnalyticsEvent> = serde_json::from_value(events.clone())
        .context("Failed to deserialize AnalyticsEvent array")?;
    Ok(())
}
