use crate::client::IntentPayload;
use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

/// Generate a unique idempotency key for testing
pub fn unique_idempotency_key(prefix: &str) -> String {
    format!("{}-{}", prefix, Uuid::new_v4())
}

/// Create a valid intent payload for testing
///
/// Note: The payload must include `actionId` and `resourceType` for authorization.
/// These fields are extracted from envelope.payload and used for policy evaluation.
pub fn valid_intent_payload() -> IntentPayload {
    IntentPayload {
        event_id: Uuid::new_v4().to_string(),
        event_type: "ContentPages.PageCreateRequested".to_string(),
        schema_id: "ui.contentpages.page.create.v1".to_string(),
        schema_version: 1,
        occurred_at: chrono::Utc::now().to_rfc3339(),
        tenant_id: "tenant-itest-001".to_string(),
        correlation_id: Uuid::new_v4().to_string(),
        idempotency_key: unique_idempotency_key("itest"),
        causation_id: None,
        principal_id: Some("user-test-001".to_string()),
        user_id: Some("user-test-001".to_string()),
        payload: json!({
            // Required for authorization
            "actionId": "ContentPages.Page.Create",
            "resourceType": "Page",
            "resourceId": null,
            // Action-specific data
            "pageId": "page-001",
            "title": "Test Page",
            "content": "This is a test page",
            "authorId": "user-test-001",
            "status": "draft"
        }),
    }
}

/// Create an intent payload with a specific idempotency key
pub fn intent_with_idempotency_key(idempotency_key: String) -> IntentPayload {
    IntentPayload {
        idempotency_key,
        ..valid_intent_payload()
    }
}

/// Create an intent payload with a specific tenant ID
pub fn intent_with_tenant_id(tenant_id: String) -> IntentPayload {
    IntentPayload {
        tenant_id,
        ..valid_intent_payload()
    }
}

/// Create an intent payload with a specific event type
pub fn intent_with_event_type(event_type: String) -> IntentPayload {
    IntentPayload {
        event_type,
        ..valid_intent_payload()
    }
}

/// Create an intent payload with missing idempotency key (for negative testing)
pub fn intent_without_idempotency_key() -> IntentPayload {
    IntentPayload {
        idempotency_key: String::new(),
        ..valid_intent_payload()
    }
}

/// Create an intent payload with invalid schema (for negative testing)
pub fn intent_with_invalid_schema() -> IntentPayload {
    IntentPayload {
        schema_id: "nonexistent_schema".to_string(),
        schema_version: 999,
        ..valid_intent_payload()
    }
}

/// Create an intent payload with invalid JSON payload (for negative testing)
///
/// Note: This is now expected to fail with 400 because it's missing
/// the required `actionId` and `resourceType` fields for authorization.
pub fn intent_with_invalid_payload() -> IntentPayload {
    IntentPayload {
        payload: json!({
            // Missing actionId and resourceType - will fail authz validation
            "invalid_field": "this should not be here"
        }),
        ..valid_intent_payload()
    }
}

/// Create an intent payload with a valid schema but payload that doesn't conform.
///
/// Uses the valid test schema (ui.contentpages.page.create.v1) but with a payload
/// that is missing required fields, triggering SCHEMA_VALIDATION_FAILED.
pub fn intent_with_schema_mismatch_payload() -> IntentPayload {
    IntentPayload {
        event_id: Uuid::new_v4().to_string(),
        event_type: "ContentPages.PageCreateRequested".to_string(),
        // Valid schema that is registered in the default schema registry
        schema_id: "ui.contentpages.page.create.v1".to_string(),
        schema_version: 1,
        occurred_at: Utc::now().to_rfc3339(),
        tenant_id: "tenant-itest-001".to_string(),
        correlation_id: Uuid::new_v4().to_string(),
        idempotency_key: unique_idempotency_key("itest-schema-mismatch"),
        causation_id: None,
        principal_id: Some("user-test-001".to_string()),
        user_id: Some("user-test-001".to_string()),
        // Missing required fields: actionId, resourceType, pageId, title
        payload: json!({
            "someOtherField": "this payload doesn't match the schema"
        }),
    }
}

/// Create an intent payload that should be denied by authorization.
///
/// This uses a different tenant_id than the test principal's tenant,
/// which triggers the tenant isolation check (403 Forbidden).
///
/// The test principal is in "tenant-itest-001", but this payload
/// targets "tenant-unauthorized" - a tenant mismatch.
pub fn intent_for_unauthorized_action() -> IntentPayload {
    IntentPayload {
        event_id: Uuid::new_v4().to_string(),
        event_type: "ContentPages.PageCreateRequested".to_string(),
        schema_id: "ui.contentpages.page.create.v1".to_string(),
        schema_version: 1,
        occurred_at: Utc::now().to_rfc3339(),
        // Different tenant than principal - will trigger tenant isolation denial
        tenant_id: "tenant-unauthorized".to_string(),
        correlation_id: Uuid::new_v4().to_string(),
        idempotency_key: unique_idempotency_key("itest-unauth"),
        causation_id: None,
        principal_id: Some("attacker-user".to_string()),
        user_id: Some("attacker-user".to_string()),
        payload: json!({
            "actionId": "ContentPages.Page.Create",
            "resourceType": "Page",
            "resourceId": null,
            "pageId": "page-unauthorized",
            "title": "Unauthorized Page"
        }),
    }
}
