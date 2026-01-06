use crate::client::IntentPayload;
use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

/// Generate a unique idempotency key for testing
pub fn unique_idempotency_key(prefix: &str) -> String {
    format!("{}-{}", prefix, Uuid::new_v4())
}

/// Create a valid intent payload for testing
pub fn valid_intent_payload() -> IntentPayload {
    IntentPayload {
        event_id: Uuid::new_v4().to_string(),
        event_type: "content_page.created".to_string(),
        schema_id: "content_page_created".to_string(),
        schema_version: 1,
        occurred_at: chrono::Utc::now().to_rfc3339(),
        tenant_id: "tenant-itest-001".to_string(),
        correlation_id: Uuid::new_v4().to_string(),
        idempotency_key: unique_idempotency_key("itest"),
        causation_id: None,
        principal_id: Some("user-test-001".to_string()),
        user_id: Some("user-test-001".to_string()),
        payload: json!({
            "page_id": "page-001",
            "title": "Test Page",
            "content": "This is a test page",
            "author_id": "user-test-001",
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
pub fn intent_with_invalid_payload() -> IntentPayload {
    IntentPayload {
        payload: json!({
            "invalid_field": "this should not be here"
        }),
        ..valid_intent_payload()
    }
}

/// Create an intent payload for a different event type (for authorization testing)
pub fn intent_for_unauthorized_action() -> IntentPayload {
    IntentPayload {
        event_type: "admin.user.deleted".to_string(),
        schema_id: "user_deleted".to_string(),
        schema_version: 1,
        payload: json!({
            "user_id": "user-to-delete",
            "reason": "Testing unauthorized action"
        }),
        ..valid_intent_payload()
    }
}
