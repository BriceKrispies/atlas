//! Integration tests for ingress authentication and authorization.
//!
//! These tests verify:
//! - Authn middleware: unauthenticated requests are rejected with 401
//! - Test auth mode allows principal injection via header
//! - Public endpoints (health, metrics) don't require auth
//! - Tenant isolation: principal in tenant A cannot access tenant B
//! - Authz: policy engine decisions are enforced
//! - Action/Resource mapping: intents map to correct authorization context

use atlas_core::policy::PolicyEngine;
use atlas_core::types::{AttributeSource, Condition, Policy, PolicyEffect, PolicyRule, PolicyStatus};
use atlas_platform_adapters::InMemoryEventStore;
use atlas_platform_ingress::authn::{authn_middleware, AuthConfig, Principal, TENANT_ID_HEADER};
use atlas_platform_ingress::authz::{
    authorize, validate_tenant_match, AuthorizationContext, AuthzRequestError, IntentAuthzRequest,
};
#[cfg(feature = "test-auth")]
use atlas_platform_ingress::authn::DEBUG_PRINCIPAL_HEADER;
use axum::{
    body::Body,
    extract::{Extension, Request},
    http::{header, Method, StatusCode},
    middleware::{self, Next},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use std::sync::Arc;
use tower::util::ServiceExt;

/// Test app state matching ingress structure
struct TestAppState {
    #[allow(dead_code)]
    event_store: Arc<InMemoryEventStore>,
}

/// Create a test router with authn middleware
fn create_test_app(auth_config: AuthConfig) -> Router {
    let state = Arc::new(TestAppState {
        event_store: Arc::new(InMemoryEventStore::new()),
    });

    let auth_config = Arc::new(auth_config);
    let tenant_id = "test-tenant".to_string();

    let auth_config_clone = auth_config.clone();
    let tenant_id_clone = tenant_id.clone();
    let authn_layer = middleware::from_fn(move |request: Request<Body>, next: Next| {
        let auth_config = auth_config_clone.clone();
        let tenant_id = tenant_id_clone.clone();
        async move { authn_middleware(auth_config, tenant_id, request, next).await }
    });

    // Handler that requires auth and returns principal info
    async fn authenticated_handler(
        Extension(principal): Extension<Principal>,
    ) -> impl IntoResponse {
        Json(json!({
            "principal_id": principal.id,
            "principal_type": principal.principal_type,
            "tenant_id": principal.tenant_id
        }))
    }

    // Public handler that doesn't require auth
    async fn public_handler() -> impl IntoResponse {
        Json(json!({
            "status": "healthy"
        }))
    }

    // Authenticated routes
    let authenticated_routes = Router::new()
        .route("/api/v1/test", post(authenticated_handler))
        .layer(authn_layer);

    // Public routes
    let public_routes = Router::new()
        .route("/health", get(public_handler));

    Router::new()
        .merge(authenticated_routes)
        .merge(public_routes)
        .with_state(state)
}

#[tokio::test]
async fn test_unauthenticated_request_returns_401() {
    // Create app without test auth enabled
    let auth_config = AuthConfig::default();
    let app = create_test_app(auth_config);

    // Make a request without any auth
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/test")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{}"))
        .unwrap();

    let response = app
        .oneshot(request)
        .await
        .expect("Failed to execute request");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_bearer_token_without_validation_returns_401() {
    // Create app without test auth enabled
    let auth_config = AuthConfig::default();
    let app = create_test_app(auth_config);

    // Make a request with a bearer token (but validation is not implemented)
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/test")
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::AUTHORIZATION, "Bearer some-token")
        .body(Body::from("{}"))
        .unwrap();

    let response = app
        .oneshot(request)
        .await
        .expect("Failed to execute request");

    // Should return 401 since JWT validation is not implemented yet
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_api_key_without_validation_returns_401() {
    // Create app without test auth enabled
    let auth_config = AuthConfig::default();
    let app = create_test_app(auth_config);

    // Make a request with an API key (but validation is not implemented)
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/test")
        .header(header::CONTENT_TYPE, "application/json")
        .header("X-API-Key", "some-api-key")
        .body(Body::from("{}"))
        .unwrap();

    let response = app
        .oneshot(request)
        .await
        .expect("Failed to execute request");

    // Should return 401 since API key validation is not implemented yet
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_public_endpoint_accessible_without_auth() {
    let auth_config = AuthConfig::default();
    let app = create_test_app(auth_config);

    let request = Request::builder()
        .method(Method::GET)
        .uri("/health")
        .body(Body::empty())
        .unwrap();

    let response = app
        .oneshot(request)
        .await
        .expect("Failed to execute request");

    assert_eq!(response.status(), StatusCode::OK);
}

#[cfg(feature = "test-auth")]
mod test_auth_mode {
    use super::*;
    use axum::body::to_bytes;

    /// Create a test app with debug endpoint support
    fn create_debug_endpoint_test_app(auth_config: AuthConfig, enable_debug_route: bool) -> Router {
        let state = Arc::new(TestAppState {
            event_store: Arc::new(InMemoryEventStore::new()),
        });

        let auth_config = Arc::new(auth_config);
        let tenant_id = "test-tenant".to_string();

        let auth_config_clone = auth_config.clone();
        let tenant_id_clone = tenant_id.clone();
        let authn_layer = middleware::from_fn(move |request: Request<Body>, next: Next| {
            let auth_config = auth_config_clone.clone();
            let tenant_id = tenant_id_clone.clone();
            async move { authn_middleware(auth_config, tenant_id, request, next).await }
        });

        // Handler simulating /debug/whoami
        async fn debug_whoami(Extension(principal): Extension<Principal>) -> impl IntoResponse {
            Json(json!({
                "tenantId": principal.tenant_id,
                "principalId": principal.id,
                "principalType": principal.principal_type,
                "claims": principal.claims
            }))
        }

        let mut routes = Router::new();
        if enable_debug_route {
            routes = routes.route("/debug/whoami", get(debug_whoami));
        }

        routes.layer(authn_layer).with_state(state)
    }

    #[tokio::test]
    async fn test_debug_whoami_endpoint_returns_principal_info() {
        // Create app with test auth enabled and debug route registered
        let auth_config = AuthConfig::new().with_test_auth(true).with_debug_endpoint(true);
        let app = create_debug_endpoint_test_app(auth_config, true);

        let request = Request::builder()
            .method(Method::GET)
            .uri("/debug/whoami")
            .header(DEBUG_PRINCIPAL_HEADER, "user:debug-user-456:debug-tenant")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.expect("Failed to execute request");
        assert_eq!(response.status(), StatusCode::OK);

        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body_json: serde_json::Value = serde_json::from_slice(&body).unwrap();

        assert_eq!(body_json["principalId"], "debug-user-456");
        assert_eq!(body_json["principalType"], "user");
        assert_eq!(body_json["tenantId"], "debug-tenant");
    }

    #[tokio::test]
    async fn test_debug_whoami_endpoint_returns_401_without_auth() {
        let auth_config = AuthConfig::new().with_test_auth(true).with_debug_endpoint(true);
        let app = create_debug_endpoint_test_app(auth_config, true);

        // Request without any auth credentials
        let request = Request::builder()
            .method(Method::GET)
            .uri("/debug/whoami")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.expect("Failed to execute request");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_debug_whoami_endpoint_not_registered_when_disabled() {
        // Debug endpoint NOT registered (simulating DEBUG_AUTH_ENDPOINT_ENABLED=false)
        let auth_config = AuthConfig::new().with_test_auth(true);
        let app = create_debug_endpoint_test_app(auth_config, false);

        let request = Request::builder()
            .method(Method::GET)
            .uri("/debug/whoami")
            .header(DEBUG_PRINCIPAL_HEADER, "user:test-user")
            .body(Body::empty())
            .unwrap();

        let response = app.oneshot(request).await.expect("Failed to execute request");
        // Should return 404 because the route is not registered
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_debug_principal_header_works_when_enabled() {
        // Create app WITH test auth enabled
        let auth_config = AuthConfig::new().with_test_auth(true);
        let app = create_test_app(auth_config);

        // Make a request with X-Debug-Principal header
        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/test")
            .header(header::CONTENT_TYPE, "application/json")
            .header(DEBUG_PRINCIPAL_HEADER, "user:test-user-123")
            .body(Body::from("{}"))
            .unwrap();

        let response = app
            .oneshot(request)
            .await
            .expect("Failed to execute request");

        assert_eq!(response.status(), StatusCode::OK);

        // Parse response body to verify principal was extracted
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("Failed to read response body");
        let body_json: serde_json::Value =
            serde_json::from_slice(&body).expect("Failed to parse response body");

        assert_eq!(body_json["principal_id"], "test-user-123");
        assert_eq!(body_json["principal_type"], "user");
        assert_eq!(body_json["tenant_id"], "test-tenant");
    }

    #[tokio::test]
    async fn test_debug_principal_header_with_custom_tenant() {
        let auth_config = AuthConfig::new().with_test_auth(true);
        let app = create_test_app(auth_config);

        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/test")
            .header(header::CONTENT_TYPE, "application/json")
            .header(DEBUG_PRINCIPAL_HEADER, "service:batch-worker:custom-tenant")
            .body(Body::from("{}"))
            .unwrap();

        let response = app
            .oneshot(request)
            .await
            .expect("Failed to execute request");

        assert_eq!(response.status(), StatusCode::OK);

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("Failed to read response body");
        let body_json: serde_json::Value =
            serde_json::from_slice(&body).expect("Failed to parse response body");

        assert_eq!(body_json["principal_id"], "batch-worker");
        assert_eq!(body_json["principal_type"], "service");
        assert_eq!(body_json["tenant_id"], "custom-tenant");
    }

    #[tokio::test]
    async fn test_debug_principal_header_ignored_when_disabled() {
        // Create app with test auth DISABLED (even though feature is enabled)
        let auth_config = AuthConfig::new().with_test_auth(false);
        let app = create_test_app(auth_config);

        // Make a request with X-Debug-Principal header
        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/test")
            .header(header::CONTENT_TYPE, "application/json")
            .header(DEBUG_PRINCIPAL_HEADER, "user:test-user-123")
            .body(Body::from("{}"))
            .unwrap();

        let response = app
            .oneshot(request)
            .await
            .expect("Failed to execute request");

        // Should return 401 because test auth is disabled at runtime
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_invalid_debug_principal_format_returns_401() {
        let auth_config = AuthConfig::new().with_test_auth(true);
        let app = create_test_app(auth_config);

        // Invalid format - missing type
        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/test")
            .header(header::CONTENT_TYPE, "application/json")
            .header(DEBUG_PRINCIPAL_HEADER, "invalid-format")
            .body(Body::from("{}"))
            .unwrap();

        let response = app
            .oneshot(request)
            .await
            .expect("Failed to execute request");

        // Should return 401 because the header format is invalid
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn test_unknown_principal_type_returns_401() {
        let auth_config = AuthConfig::new().with_test_auth(true);
        let app = create_test_app(auth_config);

        // Unknown principal type
        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/test")
            .header(header::CONTENT_TYPE, "application/json")
            .header(DEBUG_PRINCIPAL_HEADER, "unknown:123")
            .body(Body::from("{}"))
            .unwrap();

        let response = app
            .oneshot(request)
            .await
            .expect("Failed to execute request");

        // Should return 401 because "unknown" is not a valid principal type
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}

#[tokio::test]
async fn test_principal_attributes_for_policy() {
    let principal = Principal::user("user-123", "tenant-001")
        .with_claim("role", json!("admin"))
        .with_claim("department", json!("engineering"));

    let attrs = principal.to_policy_attributes();

    // Verify all expected attributes are present
    assert_eq!(attrs.get("id"), Some(&json!("user-123")));
    assert_eq!(attrs.get("type"), Some(&json!("user")));
    assert_eq!(attrs.get("tenant_id"), Some(&json!("tenant-001")));
    assert_eq!(attrs.get("role"), Some(&json!("admin")));
    assert_eq!(attrs.get("department"), Some(&json!("engineering")));
}

#[tokio::test]
async fn test_policy_evaluation_with_principal() {
    // Create a policy that requires a specific principal attribute
    let policies = vec![Policy {
        policy_id: "test-policy".to_string(),
        tenant_id: "tenant-001".to_string(),
        rules: vec![PolicyRule {
            rule_id: "require-role".to_string(),
            effect: PolicyEffect::Allow,
            // Allow if principal has the "role" attribute
            conditions: Condition::Attribute {
                path: "role".to_string(),
                source: AttributeSource::Principal,
            },
        }],
        version: 1,
        status: PolicyStatus::Active,
    }];

    let policy_engine = PolicyEngine::new();

    // Principal WITH role claim should be allowed
    let principal_with_role = Principal::user("user-123", "tenant-001")
        .with_claim("role", json!("admin"));

    let context = atlas_core::policy::PolicyEvaluationContext {
        principal_attributes: principal_with_role.to_policy_attributes(),
        resource_attributes: std::collections::HashMap::new(),
        environment_attributes: std::collections::HashMap::new(),
    };

    let decision = policy_engine.evaluate(&policies, &context);
    assert_eq!(decision.decision, atlas_core::policy::Decision::Allow);

    // Principal WITHOUT role claim should be denied
    let principal_without_role = Principal::user("user-456", "tenant-001");

    let context = atlas_core::policy::PolicyEvaluationContext {
        principal_attributes: principal_without_role.to_policy_attributes(),
        resource_attributes: std::collections::HashMap::new(),
        environment_attributes: std::collections::HashMap::new(),
    };

    let decision = policy_engine.evaluate(&policies, &context);
    assert_eq!(decision.decision, atlas_core::policy::Decision::Deny);
}

// ============================================================================
// Tenant Isolation Tests
// ============================================================================

#[tokio::test]
async fn test_tenant_match_validation_success() {
    let principal = Principal::user("user-123", "tenant-A");
    let result = validate_tenant_match(&principal, "tenant-A");
    assert!(result.is_ok());
}

#[tokio::test]
async fn test_tenant_match_validation_failure() {
    let principal = Principal::user("user-123", "tenant-A");
    let result = validate_tenant_match(&principal, "tenant-B");

    assert!(result.is_err());
    let err = result.unwrap_err();
    assert_eq!(err.principal_tenant, "tenant-A");
    assert_eq!(err.request_tenant, "tenant-B");
}

#[tokio::test]
async fn test_principal_allowed_in_own_tenant() {
    // Create a policy that allows actions in tenant-A
    let policies = vec![Policy {
        policy_id: "tenant-a-policy".to_string(),
        tenant_id: "tenant-A".to_string(),
        rules: vec![PolicyRule {
            rule_id: "allow-all-in-tenant".to_string(),
            effect: PolicyEffect::Allow,
            conditions: Condition::Literal { value: true },
        }],
        version: 1,
        status: PolicyStatus::Active,
    }];

    let policy_engine = PolicyEngine::new();
    let principal = Principal::user("user-123", "tenant-A");

    // Create authorization request with specific action
    let authz_request = IntentAuthzRequest {
        action_id: "ContentPages.Page.Create".to_string(),
        resource_type: "Page".to_string(),
        resource_id: None,
    };
    let authz_ctx = AuthorizationContext::new(authz_request, "tenant-A");

    let decision = authorize(&principal, &authz_ctx, &policies, &policy_engine);
    assert_eq!(decision.decision, atlas_core::policy::Decision::Allow);
}

#[tokio::test]
async fn test_principal_denied_in_other_tenant() {
    // Even with allow-all policy, tenant mismatch should be caught
    // by validate_tenant_match() before authorization
    let principal = Principal::user("user-123", "tenant-A");

    // Attempting to access tenant-B should fail at tenant validation
    let result = validate_tenant_match(&principal, "tenant-B");
    assert!(result.is_err());
}

// ============================================================================
// Intent Authorization Request Mapping Tests
// ============================================================================

#[tokio::test]
async fn test_intent_authz_request_from_valid_payload() {
    let payload = json!({
        "actionId": "ContentPages.Page.Create",
        "resourceType": "Page",
        "resourceId": null,
        "payload": {
            "pageId": "page-001",
            "title": "Welcome"
        }
    });

    let request = IntentAuthzRequest::from_payload(&payload).unwrap();

    assert_eq!(request.action_id, "ContentPages.Page.Create");
    assert_eq!(request.resource_type, "Page");
    assert!(request.resource_id.is_none());
}

#[tokio::test]
async fn test_intent_authz_request_with_resource_id() {
    let payload = json!({
        "actionId": "ContentPages.Page.Update",
        "resourceType": "Page",
        "resourceId": "page-123"
    });

    let request = IntentAuthzRequest::from_payload(&payload).unwrap();

    assert_eq!(request.action_id, "ContentPages.Page.Update");
    assert_eq!(request.resource_type, "Page");
    assert_eq!(request.resource_id, Some("page-123".to_string()));
}

#[tokio::test]
async fn test_intent_authz_request_missing_action_id() {
    let payload = json!({
        "resourceType": "Page",
        "payload": {}
    });

    let result = IntentAuthzRequest::from_payload(&payload);
    assert!(matches!(
        result,
        Err(AuthzRequestError::MissingField { field: "actionId" })
    ));
}

#[tokio::test]
async fn test_intent_authz_request_missing_resource_type() {
    let payload = json!({
        "actionId": "ContentPages.Page.Create",
        "payload": {}
    });

    let result = IntentAuthzRequest::from_payload(&payload);
    assert!(matches!(
        result,
        Err(AuthzRequestError::MissingField { field: "resourceType" })
    ));
}

#[tokio::test]
async fn test_intent_authz_request_invalid_action_id() {
    // Single segment is invalid
    let payload = json!({
        "actionId": "Create",
        "resourceType": "Page"
    });

    let result = IntentAuthzRequest::from_payload(&payload);
    assert!(matches!(result, Err(AuthzRequestError::InvalidActionId { .. })));
}

#[tokio::test]
async fn test_intent_authz_request_invalid_resource_type() {
    // Resource type with spaces is invalid
    let payload = json!({
        "actionId": "ContentPages.Page.Create",
        "resourceType": "Page Instance"
    });

    let result = IntentAuthzRequest::from_payload(&payload);
    assert!(matches!(result, Err(AuthzRequestError::InvalidResourceType { .. })));
}

// ============================================================================
// Different Actions Map to Different Contexts
// ============================================================================

#[tokio::test]
async fn test_different_actions_same_principal_produce_different_contexts() {
    let principal = Principal::user("user-123", "tenant-001");
    let policy_engine = PolicyEngine::new();

    // Allow-all policy for testing
    let policies = vec![Policy {
        policy_id: "allow-all".to_string(),
        tenant_id: "tenant-001".to_string(),
        rules: vec![PolicyRule {
            rule_id: "allow-all".to_string(),
            effect: PolicyEffect::Allow,
            conditions: Condition::Literal { value: true },
        }],
        version: 1,
        status: PolicyStatus::Active,
    }];

    // Create action - Page creation
    let create_request = IntentAuthzRequest {
        action_id: "ContentPages.Page.Create".to_string(),
        resource_type: "Page".to_string(),
        resource_id: None,
    };
    let create_ctx = AuthorizationContext::new(create_request, "tenant-001");
    let create_attrs = create_ctx.to_resource_attributes();

    // Search action - Page search
    let search_request = IntentAuthzRequest {
        action_id: "ContentPages.Page.Search".to_string(),
        resource_type: "Page".to_string(),
        resource_id: None,
    };
    let search_ctx = AuthorizationContext::new(search_request, "tenant-001");
    let search_attrs = search_ctx.to_resource_attributes();

    // Verify actions differ
    assert_ne!(create_attrs.get("action_id"), search_attrs.get("action_id"));
    assert_eq!(create_attrs.get("action_id"), Some(&json!("ContentPages.Page.Create")));
    assert_eq!(search_attrs.get("action_id"), Some(&json!("ContentPages.Page.Search")));

    // Verify resource type is the same
    assert_eq!(create_attrs.get("resource_type"), search_attrs.get("resource_type"));

    // Both should be allowed with allow-all policy
    let create_decision = authorize(&principal, &create_ctx, &policies, &policy_engine);
    let search_decision = authorize(&principal, &search_ctx, &policies, &policy_engine);

    assert_eq!(create_decision.decision, atlas_core::policy::Decision::Allow);
    assert_eq!(search_decision.decision, atlas_core::policy::Decision::Allow);
}

#[tokio::test]
async fn test_different_resources_produce_different_contexts() {
    // Page resource
    let page_request = IntentAuthzRequest {
        action_id: "ContentPages.Page.Create".to_string(),
        resource_type: "Page".to_string(),
        resource_id: None,
    };

    // WidgetInstance resource
    let widget_request = IntentAuthzRequest {
        action_id: "ContentPages.WidgetInstance.Create".to_string(),
        resource_type: "WidgetInstance".to_string(),
        resource_id: None,
    };

    let page_ctx = AuthorizationContext::new(page_request, "tenant-001");
    let widget_ctx = AuthorizationContext::new(widget_request, "tenant-001");

    let page_attrs = page_ctx.to_resource_attributes();
    let widget_attrs = widget_ctx.to_resource_attributes();

    // Both action and resource type should differ
    assert_ne!(page_attrs.get("action_id"), widget_attrs.get("action_id"));
    assert_ne!(page_attrs.get("resource_type"), widget_attrs.get("resource_type"));

    assert_eq!(page_attrs.get("resource_type"), Some(&json!("Page")));
    assert_eq!(widget_attrs.get("resource_type"), Some(&json!("WidgetInstance")));
}

// ============================================================================
// Authorization Context Tests
// ============================================================================

#[tokio::test]
async fn test_authorization_context_builds_correct_attributes() {
    let authz_request = IntentAuthzRequest {
        action_id: "ContentPages.Page.Update".to_string(),
        resource_type: "Page".to_string(),
        resource_id: Some("page-123".to_string()),
    };
    let authz_ctx = AuthorizationContext::new(authz_request, "tenant-001");

    let resource_attrs = authz_ctx.to_resource_attributes();
    assert_eq!(resource_attrs.get("action_id"), Some(&json!("ContentPages.Page.Update")));
    assert_eq!(resource_attrs.get("resource_type"), Some(&json!("Page")));
    assert_eq!(resource_attrs.get("resource_id"), Some(&json!("page-123")));

    let env_attrs = authz_ctx.to_environment_attributes();
    assert_eq!(env_attrs.get("tenant_id"), Some(&json!("tenant-001")));
    assert!(env_attrs.contains_key("timestamp"));
}

#[tokio::test]
async fn test_authorize_with_deny_all_policy() {
    let policies = vec![Policy {
        policy_id: "deny-all".to_string(),
        tenant_id: "tenant-001".to_string(),
        rules: vec![PolicyRule {
            rule_id: "deny-all-rule".to_string(),
            effect: PolicyEffect::Deny,
            conditions: Condition::Literal { value: true },
        }],
        version: 1,
        status: PolicyStatus::Active,
    }];

    let policy_engine = PolicyEngine::new();
    let principal = Principal::user("user-123", "tenant-001");
    let authz_request = IntentAuthzRequest {
        action_id: "ContentPages.Page.Create".to_string(),
        resource_type: "Page".to_string(),
        resource_id: None,
    };
    let authz_ctx = AuthorizationContext::new(authz_request, "tenant-001");

    let decision = authorize(&principal, &authz_ctx, &policies, &policy_engine);
    assert_eq!(decision.decision, atlas_core::policy::Decision::Deny);
}

#[tokio::test]
async fn test_authorize_with_no_policies_returns_deny() {
    let policies: Vec<Policy> = vec![];
    let policy_engine = PolicyEngine::new();
    let principal = Principal::user("user-123", "tenant-001");
    let authz_request = IntentAuthzRequest {
        action_id: "ContentPages.Page.Create".to_string(),
        resource_type: "Page".to_string(),
        resource_id: None,
    };
    let authz_ctx = AuthorizationContext::new(authz_request, "tenant-001");

    let decision = authorize(&principal, &authz_ctx, &policies, &policy_engine);
    assert_eq!(decision.decision, atlas_core::policy::Decision::Deny);
    assert_eq!(decision.reason, "no matching policies");
}

#[tokio::test]
async fn test_deny_overrides_allow() {
    // Create both allow and deny rules - deny should win
    let policies = vec![Policy {
        policy_id: "mixed-policy".to_string(),
        tenant_id: "tenant-001".to_string(),
        rules: vec![
            PolicyRule {
                rule_id: "allow-rule".to_string(),
                effect: PolicyEffect::Allow,
                conditions: Condition::Literal { value: true },
            },
            PolicyRule {
                rule_id: "deny-rule".to_string(),
                effect: PolicyEffect::Deny,
                conditions: Condition::Literal { value: true },
            },
        ],
        version: 1,
        status: PolicyStatus::Active,
    }];

    let policy_engine = PolicyEngine::new();
    let principal = Principal::user("user-123", "tenant-001");
    let authz_request = IntentAuthzRequest {
        action_id: "ContentPages.Page.Create".to_string(),
        resource_type: "Page".to_string(),
        resource_id: None,
    };
    let authz_ctx = AuthorizationContext::new(authz_request, "tenant-001");

    let decision = authorize(&principal, &authz_ctx, &policies, &policy_engine);
    assert_eq!(decision.decision, atlas_core::policy::Decision::Deny);
    assert!(decision.matched_rules.contains(&"deny-rule".to_string()));
}

// ============================================================================
// Tenant ID Header Tests
// ============================================================================

#[cfg(feature = "test-auth")]
mod tenant_header_tests {
    use super::*;
    use axum::body::to_bytes;

    fn create_test_app_with_tenant(auth_config: AuthConfig, default_tenant: &str) -> Router {
        let state = Arc::new(TestAppState {
            event_store: Arc::new(InMemoryEventStore::new()),
        });

        let auth_config = Arc::new(auth_config);
        let tenant_id = default_tenant.to_string();

        let auth_config_clone = auth_config.clone();
        let tenant_id_clone = tenant_id.clone();
        let authn_layer = middleware::from_fn(move |request: Request<Body>, next: Next| {
            let auth_config = auth_config_clone.clone();
            let tenant_id = tenant_id_clone.clone();
            async move { authn_middleware(auth_config, tenant_id, request, next).await }
        });

        async fn authenticated_handler(
            Extension(principal): Extension<Principal>,
        ) -> impl IntoResponse {
            Json(json!({
                "principal_id": principal.id,
                "principal_type": principal.principal_type,
                "tenant_id": principal.tenant_id
            }))
        }

        Router::new()
            .route("/api/v1/test", post(authenticated_handler))
            .layer(authn_layer)
            .with_state(state)
    }

    #[tokio::test]
    async fn test_x_tenant_id_header_overrides_default() {
        let auth_config = AuthConfig::new().with_test_auth(true);
        let app = create_test_app_with_tenant(auth_config, "default-tenant");

        // Use X-Debug-Principal without tenant, but provide X-Tenant-ID header
        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/test")
            .header(header::CONTENT_TYPE, "application/json")
            .header(DEBUG_PRINCIPAL_HEADER, "user:test-user")
            .header(TENANT_ID_HEADER, "custom-tenant")
            .body(Body::from("{}"))
            .unwrap();

        let response = app
            .oneshot(request)
            .await
            .expect("Failed to execute request");

        assert_eq!(response.status(), StatusCode::OK);

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("Failed to read response body");
        let body_json: serde_json::Value =
            serde_json::from_slice(&body).expect("Failed to parse response body");

        // X-Tenant-ID should be used when X-Debug-Principal doesn't have tenant
        assert_eq!(body_json["tenant_id"], "custom-tenant");
    }

    #[tokio::test]
    async fn test_debug_principal_tenant_takes_precedence() {
        let auth_config = AuthConfig::new().with_test_auth(true);
        let app = create_test_app_with_tenant(auth_config, "default-tenant");

        // X-Debug-Principal with tenant should take precedence over X-Tenant-ID
        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/test")
            .header(header::CONTENT_TYPE, "application/json")
            .header(DEBUG_PRINCIPAL_HEADER, "user:test-user:debug-tenant")
            .header(TENANT_ID_HEADER, "header-tenant")
            .body(Body::from("{}"))
            .unwrap();

        let response = app
            .oneshot(request)
            .await
            .expect("Failed to execute request");

        assert_eq!(response.status(), StatusCode::OK);

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("Failed to read response body");
        let body_json: serde_json::Value =
            serde_json::from_slice(&body).expect("Failed to parse response body");

        // X-Debug-Principal tenant should win
        assert_eq!(body_json["tenant_id"], "debug-tenant");
    }

    #[tokio::test]
    async fn test_invalid_tenant_id_format_rejected() {
        let auth_config = AuthConfig::new().with_test_auth(true);
        let app = create_test_app_with_tenant(auth_config, "default-tenant");

        // Invalid tenant ID format (contains space)
        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/test")
            .header(header::CONTENT_TYPE, "application/json")
            .header(DEBUG_PRINCIPAL_HEADER, "user:test-user")
            .header(TENANT_ID_HEADER, "invalid tenant")
            .body(Body::from("{}"))
            .unwrap();

        let response = app
            .oneshot(request)
            .await
            .expect("Failed to execute request");

        // Should return 400 Bad Request for invalid tenant format
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
