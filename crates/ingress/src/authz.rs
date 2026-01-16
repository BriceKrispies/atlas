//! Authorization module for ingress.
//!
//! This module provides the authorization gate that runs AFTER authentication
//! and BEFORE dispatch to handlers.
//!
//! # Invariant I2: Authorization Before Execution
//!
//! Every non-public ingress request MUST perform a primary authorization decision
//! before dispatch. No handler logic executes until authorization allows.
//!
//! # Action/Resource Model
//!
//! Actions and resources are derived from the intent payload, NOT hardcoded:
//!
//! - **Action**: The `actionId` from the intent payload (e.g., `ContentPages.Page.Create`)
//!   This matches the action declarations in module manifests.
//!
//! - **Resource**: The `resourceType` and optional `resourceId` from the payload.
//!   Resource type must be declared in a module manifest.
//!
//! - **Context**: Includes tenant_id (from Principal), action, resource, and environment.
//!
//! # Tenant Isolation
//!
//! Tenant is determined solely by the authenticated Principal. The request body's
//! `tenant_id` is validated to match the Principal's tenant - mismatch = 403.

use crate::authn::Principal;
use atlas_core::policy::{Decision, PolicyDecision, PolicyEngine, PolicyEvaluationContext};
use atlas_core::types::Policy;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
use tracing::info;

/// Error types for authorization request validation.
#[derive(Debug, Error)]
pub enum AuthzRequestError {
    /// The intent payload is missing required authorization fields.
    #[error("missing required field '{field}' in intent payload")]
    MissingField { field: &'static str },

    /// The action ID format is invalid.
    #[error("invalid action_id format: {reason}")]
    InvalidActionId { reason: String },

    /// The resource type format is invalid.
    #[error("invalid resource_type format: {reason}")]
    InvalidResourceType { reason: String },
}

/// Authorization request extracted from an intent payload.
///
/// This is the canonical representation of "what action on what resource"
/// for authorization decisions at ingress.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntentAuthzRequest {
    /// The action being performed (from payload.actionId).
    /// Format: `{Module}.{Resource}.{Verb}` (e.g., `ContentPages.Page.Create`)
    pub action_id: String,

    /// The type of resource being acted upon (from payload.resourceType).
    /// Must match a resource declaration in a module manifest.
    pub resource_type: String,

    /// The specific resource ID, if applicable (from payload.resourceId).
    /// Present for operations on existing resources (update, delete, read).
    /// Absent for creation operations.
    pub resource_id: Option<String>,
}

impl IntentAuthzRequest {
    /// Extract authorization request from an intent payload.
    ///
    /// The payload must contain `actionId` and `resourceType` fields.
    /// The `resourceId` field is optional.
    ///
    /// # Errors
    ///
    /// Returns `AuthzRequestError` if required fields are missing or invalid.
    pub fn from_payload(payload: &serde_json::Value) -> Result<Self, AuthzRequestError> {
        // Extract actionId (required)
        let action_id = payload
            .get("actionId")
            .and_then(|v| v.as_str())
            .ok_or(AuthzRequestError::MissingField { field: "actionId" })?;

        // Validate actionId format: at least Module.Resource.Verb (3 segments)
        validate_action_id(action_id)?;

        // Extract resourceType (required)
        let resource_type = payload
            .get("resourceType")
            .and_then(|v| v.as_str())
            .ok_or(AuthzRequestError::MissingField {
                field: "resourceType",
            })?;

        // Validate resourceType format
        validate_resource_type(resource_type)?;

        // Extract resourceId (optional)
        let resource_id = payload
            .get("resourceId")
            .and_then(|v| {
                if v.is_null() {
                    None
                } else {
                    v.as_str().map(|s| s.to_string())
                }
            });

        Ok(Self {
            action_id: action_id.to_string(),
            resource_type: resource_type.to_string(),
            resource_id,
        })
    }

    /// Convert to resource attributes for policy evaluation.
    pub fn to_resource_attributes(&self) -> HashMap<String, serde_json::Value> {
        let mut attrs = HashMap::new();
        attrs.insert(
            "action_id".to_string(),
            serde_json::Value::String(self.action_id.clone()),
        );
        attrs.insert(
            "resource_type".to_string(),
            serde_json::Value::String(self.resource_type.clone()),
        );
        if let Some(ref id) = self.resource_id {
            attrs.insert(
                "resource_id".to_string(),
                serde_json::Value::String(id.clone()),
            );
        }
        attrs
    }
}

/// Validate action ID format.
///
/// Valid format: `{Module}.{Resource}.{Verb}`
/// - At least 3 dot-separated segments
/// - Each segment must be non-empty and alphanumeric (with underscores allowed)
///
/// Examples:
/// - `ContentPages.Page.Create` ✓
/// - `Analytics.Query` ✗ (only 2 segments - missing verb)
/// - `Page.Create` ✗ (only 2 segments - missing module)
fn validate_action_id(action_id: &str) -> Result<(), AuthzRequestError> {
    let segments: Vec<&str> = action_id.split('.').collect();

    if segments.len() < 2 {
        return Err(AuthzRequestError::InvalidActionId {
            reason: format!(
                "expected at least 2 segments (Module.Verb or Module.Resource.Verb), got {}",
                segments.len()
            ),
        });
    }

    for (i, segment) in segments.iter().enumerate() {
        if segment.is_empty() {
            return Err(AuthzRequestError::InvalidActionId {
                reason: format!("segment {} is empty", i + 1),
            });
        }

        // Each segment should be alphanumeric with underscores
        if !segment.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(AuthzRequestError::InvalidActionId {
                reason: format!(
                    "segment '{}' contains invalid characters (only alphanumeric and underscore allowed)",
                    segment
                ),
            });
        }
    }

    Ok(())
}

/// Validate resource type format.
///
/// Valid format: PascalCase identifier
/// - Non-empty
/// - Alphanumeric characters only
///
/// Examples:
/// - `Page` ✓
/// - `WidgetInstance` ✓
/// - `page` ✓ (we don't enforce casing)
/// - `Page Instance` ✗ (contains space)
fn validate_resource_type(resource_type: &str) -> Result<(), AuthzRequestError> {
    if resource_type.is_empty() {
        return Err(AuthzRequestError::InvalidResourceType {
            reason: "resource type cannot be empty".to_string(),
        });
    }

    if !resource_type.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AuthzRequestError::InvalidResourceType {
            reason: "resource type must be alphanumeric".to_string(),
        });
    }

    Ok(())
}

/// Context for an authorization decision.
///
/// This captures the action being performed, the resource being accessed,
/// and the tenant scope. Built from an IntentAuthzRequest plus tenant info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorizationContext {
    /// The authorization request (action, resource_type, resource_id).
    pub request: IntentAuthzRequest,

    /// The tenant scope for this authorization check.
    /// This comes from the authenticated Principal, NOT from the request body.
    pub tenant_id: String,
}

impl AuthorizationContext {
    /// Create a new authorization context from an intent request and principal.
    pub fn new(request: IntentAuthzRequest, tenant_id: impl Into<String>) -> Self {
        Self {
            request,
            tenant_id: tenant_id.into(),
        }
    }

    /// Convert to resource attributes for policy evaluation.
    pub fn to_resource_attributes(&self) -> HashMap<String, serde_json::Value> {
        self.request.to_resource_attributes()
    }

    /// Convert to environment attributes for policy evaluation.
    pub fn to_environment_attributes(&self) -> HashMap<String, serde_json::Value> {
        let mut attrs = HashMap::new();
        attrs.insert(
            "tenant_id".to_string(),
            serde_json::Value::String(self.tenant_id.clone()),
        );
        attrs.insert(
            "timestamp".to_string(),
            serde_json::Value::String(Utc::now().to_rfc3339()),
        );
        attrs
    }
}

/// Perform an authorization check.
///
/// This is the primary authorization function that should be called for every
/// protected route before executing business logic.
///
/// # Arguments
///
/// * `principal` - The authenticated principal making the request
/// * `authz_ctx` - The authorization context (action, resource, tenant)
/// * `policies` - The active policies to evaluate
/// * `policy_engine` - The policy engine to use for evaluation
///
/// # Returns
///
/// A `PolicyDecision` indicating whether the request is allowed or denied.
pub fn authorize(
    principal: &Principal,
    authz_ctx: &AuthorizationContext,
    policies: &[Policy],
    policy_engine: &PolicyEngine,
) -> PolicyDecision {
    // Build the policy evaluation context
    let context = PolicyEvaluationContext {
        principal_attributes: principal.to_policy_attributes(),
        resource_attributes: authz_ctx.to_resource_attributes(),
        environment_attributes: authz_ctx.to_environment_attributes(),
    };

    // Evaluate policies
    let decision = policy_engine.evaluate(policies, &context);

    // Log the decision
    match decision.decision {
        Decision::Allow => {
            // Allow is implicit - we don't log success at INFO level to reduce noise
        }
        Decision::Deny => {
            info!(
                principal_id = %principal.id,
                action_id = %authz_ctx.request.action_id,
                resource_type = %authz_ctx.request.resource_type,
                resource_id = ?authz_ctx.request.resource_id,
                tenant_id = %authz_ctx.tenant_id,
                reason = %decision.reason,
                matched_rules = ?decision.matched_rules,
                "Authorization denied"
            );
        }
    }

    decision
}

/// Validate that the principal's tenant matches the request tenant.
///
/// This enforces tenant isolation by ensuring a principal cannot access
/// resources in a different tenant.
///
/// # Arguments
///
/// * `principal` - The authenticated principal
/// * `request_tenant_id` - The tenant ID from the request (e.g., from body)
///
/// # Returns
///
/// `Ok(())` if tenants match, `Err(TenantMismatchError)` otherwise.
pub fn validate_tenant_match(
    principal: &Principal,
    request_tenant_id: &str,
) -> Result<(), TenantMismatchError> {
    if principal.tenant_id != request_tenant_id {
        info!(
            principal_id = %principal.id,
            principal_tenant = %principal.tenant_id,
            request_tenant = %request_tenant_id,
            "Tenant mismatch: principal tenant does not match request tenant"
        );
        return Err(TenantMismatchError {
            principal_tenant: principal.tenant_id.clone(),
            request_tenant: request_tenant_id.to_string(),
        });
    }
    Ok(())
}

/// Error returned when principal's tenant doesn't match request tenant.
#[derive(Debug)]
pub struct TenantMismatchError {
    pub principal_tenant: String,
    pub request_tenant: String,
}

impl std::fmt::Display for TenantMismatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "tenant mismatch: principal belongs to '{}' but request targets '{}'",
            self.principal_tenant, self.request_tenant
        )
    }
}

impl std::error::Error for TenantMismatchError {}

#[cfg(test)]
mod tests {
    use super::*;
    use atlas_core::types::{Condition, PolicyEffect, PolicyRule, PolicyStatus};
    use serde_json::json;

    fn create_test_principal(id: &str, tenant_id: &str) -> Principal {
        Principal::user(id, tenant_id)
    }

    fn create_allow_all_policy(tenant_id: &str) -> Policy {
        Policy {
            policy_id: "allow-all".to_string(),
            tenant_id: tenant_id.to_string(),
            rules: vec![PolicyRule {
                rule_id: "allow-all-rule".to_string(),
                effect: PolicyEffect::Allow,
                conditions: Condition::Literal { value: true },
            }],
            version: 1,
            status: PolicyStatus::Active,
        }
    }

    fn create_deny_all_policy(tenant_id: &str) -> Policy {
        Policy {
            policy_id: "deny-all".to_string(),
            tenant_id: tenant_id.to_string(),
            rules: vec![PolicyRule {
                rule_id: "deny-all-rule".to_string(),
                effect: PolicyEffect::Deny,
                conditions: Condition::Literal { value: true },
            }],
            version: 1,
            status: PolicyStatus::Active,
        }
    }

    // ========================================================================
    // IntentAuthzRequest Tests
    // ========================================================================

    #[test]
    fn test_intent_authz_request_from_valid_payload() {
        let payload = json!({
            "actionId": "ContentPages.Page.Create",
            "resourceType": "Page",
            "resourceId": null,
            "payload": { "title": "Test" }
        });

        let request = IntentAuthzRequest::from_payload(&payload).unwrap();

        assert_eq!(request.action_id, "ContentPages.Page.Create");
        assert_eq!(request.resource_type, "Page");
        assert!(request.resource_id.is_none());
    }

    #[test]
    fn test_intent_authz_request_with_resource_id() {
        let payload = json!({
            "actionId": "ContentPages.Page.Update",
            "resourceType": "Page",
            "resourceId": "page-123",
            "payload": { "title": "Updated" }
        });

        let request = IntentAuthzRequest::from_payload(&payload).unwrap();

        assert_eq!(request.action_id, "ContentPages.Page.Update");
        assert_eq!(request.resource_type, "Page");
        assert_eq!(request.resource_id, Some("page-123".to_string()));
    }

    #[test]
    fn test_intent_authz_request_missing_action_id() {
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

    #[test]
    fn test_intent_authz_request_missing_resource_type() {
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

    #[test]
    fn test_intent_authz_request_invalid_action_id_single_segment() {
        let payload = json!({
            "actionId": "Create",
            "resourceType": "Page"
        });

        let result = IntentAuthzRequest::from_payload(&payload);
        assert!(matches!(
            result,
            Err(AuthzRequestError::InvalidActionId { .. })
        ));
    }

    #[test]
    fn test_intent_authz_request_invalid_action_id_empty_segment() {
        let payload = json!({
            "actionId": "ContentPages..Create",
            "resourceType": "Page"
        });

        let result = IntentAuthzRequest::from_payload(&payload);
        assert!(matches!(
            result,
            Err(AuthzRequestError::InvalidActionId { .. })
        ));
    }

    #[test]
    fn test_intent_authz_request_invalid_resource_type_empty() {
        let payload = json!({
            "actionId": "ContentPages.Page.Create",
            "resourceType": ""
        });

        let result = IntentAuthzRequest::from_payload(&payload);
        assert!(matches!(
            result,
            Err(AuthzRequestError::InvalidResourceType { .. })
        ));
    }

    #[test]
    fn test_intent_authz_request_invalid_resource_type_with_space() {
        let payload = json!({
            "actionId": "ContentPages.Page.Create",
            "resourceType": "Page Instance"
        });

        let result = IntentAuthzRequest::from_payload(&payload);
        assert!(matches!(
            result,
            Err(AuthzRequestError::InvalidResourceType { .. })
        ));
    }

    // ========================================================================
    // Action ID Validation Tests
    // ========================================================================

    #[test]
    fn test_validate_action_id_valid_three_segments() {
        assert!(validate_action_id("ContentPages.Page.Create").is_ok());
        assert!(validate_action_id("Org.User.Invite").is_ok());
        assert!(validate_action_id("Points.Balance.Query").is_ok());
    }

    #[test]
    fn test_validate_action_id_valid_two_segments() {
        // Two segments is valid (e.g., Analytics.Query)
        assert!(validate_action_id("Analytics.Query").is_ok());
        assert!(validate_action_id("Module.Action").is_ok());
    }

    #[test]
    fn test_validate_action_id_with_underscores() {
        assert!(validate_action_id("Content_Pages.Page_Type.Create").is_ok());
    }

    #[test]
    fn test_validate_action_id_invalid_special_chars() {
        assert!(validate_action_id("Content-Pages.Page.Create").is_err());
        assert!(validate_action_id("Content@Pages.Page.Create").is_err());
    }

    // ========================================================================
    // Resource Type Validation Tests
    // ========================================================================

    #[test]
    fn test_validate_resource_type_valid() {
        assert!(validate_resource_type("Page").is_ok());
        assert!(validate_resource_type("WidgetInstance").is_ok());
        assert!(validate_resource_type("User123").is_ok());
    }

    #[test]
    fn test_validate_resource_type_invalid() {
        assert!(validate_resource_type("").is_err());
        assert!(validate_resource_type("Page Instance").is_err());
        assert!(validate_resource_type("Page-Type").is_err());
    }

    // ========================================================================
    // Authorization Context Tests
    // ========================================================================

    #[test]
    fn test_authorization_context_creation() {
        let request = IntentAuthzRequest {
            action_id: "ContentPages.Page.Create".to_string(),
            resource_type: "Page".to_string(),
            resource_id: None,
        };

        let ctx = AuthorizationContext::new(request, "tenant-001");

        assert_eq!(ctx.request.action_id, "ContentPages.Page.Create");
        assert_eq!(ctx.request.resource_type, "Page");
        assert_eq!(ctx.tenant_id, "tenant-001");
    }

    #[test]
    fn test_authorization_context_resource_attributes() {
        let request = IntentAuthzRequest {
            action_id: "ContentPages.Page.Update".to_string(),
            resource_type: "Page".to_string(),
            resource_id: Some("page-123".to_string()),
        };

        let ctx = AuthorizationContext::new(request, "tenant-001");
        let attrs = ctx.to_resource_attributes();

        assert_eq!(
            attrs.get("action_id"),
            Some(&json!("ContentPages.Page.Update"))
        );
        assert_eq!(attrs.get("resource_type"), Some(&json!("Page")));
        assert_eq!(attrs.get("resource_id"), Some(&json!("page-123")));
    }

    #[test]
    fn test_authorization_context_environment_attributes() {
        let request = IntentAuthzRequest {
            action_id: "ContentPages.Page.Create".to_string(),
            resource_type: "Page".to_string(),
            resource_id: None,
        };

        let ctx = AuthorizationContext::new(request, "tenant-001");
        let attrs = ctx.to_environment_attributes();

        assert_eq!(attrs.get("tenant_id"), Some(&json!("tenant-001")));
        assert!(attrs.contains_key("timestamp"));
    }

    // ========================================================================
    // Authorization Function Tests
    // ========================================================================

    #[test]
    fn test_authorize_allow() {
        let principal = create_test_principal("user-123", "tenant-001");
        let request = IntentAuthzRequest {
            action_id: "ContentPages.Page.Create".to_string(),
            resource_type: "Page".to_string(),
            resource_id: None,
        };
        let authz_ctx = AuthorizationContext::new(request, "tenant-001");
        let policies = vec![create_allow_all_policy("tenant-001")];
        let policy_engine = PolicyEngine::new();

        let decision = authorize(&principal, &authz_ctx, &policies, &policy_engine);

        assert_eq!(decision.decision, Decision::Allow);
    }

    #[test]
    fn test_authorize_deny() {
        let principal = create_test_principal("user-123", "tenant-001");
        let request = IntentAuthzRequest {
            action_id: "ContentPages.Page.Create".to_string(),
            resource_type: "Page".to_string(),
            resource_id: None,
        };
        let authz_ctx = AuthorizationContext::new(request, "tenant-001");
        let policies = vec![create_deny_all_policy("tenant-001")];
        let policy_engine = PolicyEngine::new();

        let decision = authorize(&principal, &authz_ctx, &policies, &policy_engine);

        assert_eq!(decision.decision, Decision::Deny);
    }

    #[test]
    fn test_authorize_default_deny_no_policies() {
        let principal = create_test_principal("user-123", "tenant-001");
        let request = IntentAuthzRequest {
            action_id: "ContentPages.Page.Create".to_string(),
            resource_type: "Page".to_string(),
            resource_id: None,
        };
        let authz_ctx = AuthorizationContext::new(request, "tenant-001");
        let policies: Vec<Policy> = vec![];
        let policy_engine = PolicyEngine::new();

        let decision = authorize(&principal, &authz_ctx, &policies, &policy_engine);

        assert_eq!(decision.decision, Decision::Deny);
        assert_eq!(decision.reason, "no matching policies");
    }

    // ========================================================================
    // Tenant Validation Tests
    // ========================================================================

    #[test]
    fn test_validate_tenant_match_success() {
        let principal = create_test_principal("user-123", "tenant-001");

        let result = validate_tenant_match(&principal, "tenant-001");

        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_tenant_match_failure() {
        let principal = create_test_principal("user-123", "tenant-001");

        let result = validate_tenant_match(&principal, "tenant-002");

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.principal_tenant, "tenant-001");
        assert_eq!(err.request_tenant, "tenant-002");
    }

    // ========================================================================
    // Different Actions/Resources Map Differently
    // ========================================================================

    #[test]
    fn test_different_actions_produce_different_contexts() {
        let create_request = IntentAuthzRequest {
            action_id: "ContentPages.Page.Create".to_string(),
            resource_type: "Page".to_string(),
            resource_id: None,
        };

        let search_request = IntentAuthzRequest {
            action_id: "ContentPages.Page.Search".to_string(),
            resource_type: "Page".to_string(),
            resource_id: None,
        };

        let create_ctx = AuthorizationContext::new(create_request, "tenant-001");
        let search_ctx = AuthorizationContext::new(search_request, "tenant-001");

        let create_attrs = create_ctx.to_resource_attributes();
        let search_attrs = search_ctx.to_resource_attributes();

        // Actions should differ
        assert_ne!(
            create_attrs.get("action_id"),
            search_attrs.get("action_id")
        );

        // Resource type should be the same
        assert_eq!(
            create_attrs.get("resource_type"),
            search_attrs.get("resource_type")
        );
    }

    #[test]
    fn test_different_resources_produce_different_contexts() {
        let page_request = IntentAuthzRequest {
            action_id: "ContentPages.Page.Create".to_string(),
            resource_type: "Page".to_string(),
            resource_id: None,
        };

        let widget_request = IntentAuthzRequest {
            action_id: "ContentPages.WidgetInstance.Create".to_string(),
            resource_type: "WidgetInstance".to_string(),
            resource_id: None,
        };

        let page_ctx = AuthorizationContext::new(page_request, "tenant-001");
        let widget_ctx = AuthorizationContext::new(widget_request, "tenant-001");

        let page_attrs = page_ctx.to_resource_attributes();
        let widget_attrs = widget_ctx.to_resource_attributes();

        // Actions should differ
        assert_ne!(page_attrs.get("action_id"), widget_attrs.get("action_id"));

        // Resource types should differ
        assert_ne!(
            page_attrs.get("resource_type"),
            widget_attrs.get("resource_type")
        );
    }
}
