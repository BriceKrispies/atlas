use crate::client::{IntentResponse, RawResponse};

/// Assert that an HTTP response has the expected status code
pub fn assert_status(response: &RawResponse, expected_status: u16) {
    assert_eq!(
        response.status, expected_status,
        "Expected status {}, got {}. Body: {}",
        expected_status, response.status, response.body
    );
}

/// Assert that an intent response contains a valid event ID
pub fn assert_valid_event_id(response: &IntentResponse) {
    assert!(
        !response.event_id.is_empty(),
        "Event ID should not be empty"
    );
}

/// Assert that an intent response has the expected tenant ID
pub fn assert_tenant_id(response: &IntentResponse, expected_tenant_id: &str) {
    assert_eq!(
        response.tenant_id, expected_tenant_id,
        "Expected tenant_id {}, got {}",
        expected_tenant_id, response.tenant_id
    );
}

/// Assert that two intent responses have the same event ID (for idempotency testing)
pub fn assert_same_event(response1: &IntentResponse, response2: &IntentResponse) {
    assert_eq!(
        response1.event_id, response2.event_id,
        "Expected same event_id for idempotent requests, got {} and {}",
        response1.event_id, response2.event_id
    );
}

/// Assert that a response body contains a specific substring
pub fn assert_body_contains(response: &RawResponse, substring: &str) {
    assert!(
        response.body.contains(substring),
        "Expected response body to contain '{}', got: {}",
        substring,
        response.body
    );
}

/// Assert that a response header has a specific value
pub fn assert_header(response: &RawResponse, header_name: &str, expected_value: &str) {
    let actual_value = response
        .headers
        .get(header_name)
        .expect(&format!("Header '{}' not found", header_name));

    assert_eq!(
        actual_value, expected_value,
        "Expected header '{}' to be '{}', got '{}'",
        header_name, expected_value, actual_value
    );
}
