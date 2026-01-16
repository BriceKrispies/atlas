//! Error handling for ingress service.
//!
//! Implements Failure Semantics spec (specs/crosscut/errors.md):
//! - INV-ERR-01: Correlation preservation (correlationId/supportId in responses)
//! - INV-ERR-02: Boundary normalization (errors normalized before returning to clients)
//! - INV-ERR-03: Redaction (no stack traces, internal paths, or raw errors)
//! - INV-ERR-04: Structured response (all errors conform to error envelope)
//! - INV-ERR-05: Exactly-once boundary logging

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use tracing::error;
use uuid::Uuid;

/// Public error response conforming to the error envelope contract.
///
/// This is the only error format returned to external clients.
/// Internal error details are redacted per INV-ERR-03.
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: ErrorBody,
}

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    /// Machine-readable error code from error_taxonomy.json
    pub code: String,
    /// Human-readable message (safe for external display)
    pub message: String,
    /// Request correlation ID for tracing (INV-ERR-01)
    #[serde(rename = "correlationId")]
    pub correlation_id: String,
    /// Opaque support identifier for internal log correlation (INV-ERR-01)
    #[serde(rename = "supportId")]
    pub support_id: String,
}

/// Application error type for ingress boundary.
///
/// Captures internal context for logging while ensuring
/// only safe information reaches external clients.
#[derive(Debug)]
pub struct AppError {
    /// HTTP status code to return
    pub status: StatusCode,
    /// Error code from taxonomy
    pub code: &'static str,
    /// Safe message for external clients
    pub message: String,
    /// Correlation ID from request (if available)
    pub correlation_id: Option<String>,
    /// Internal details for logging only (never exposed)
    internal_details: Option<String>,
}

impl AppError {
    pub fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code,
            message: message.into(),
            correlation_id: None,
            internal_details: None,
        }
    }

    pub fn forbidden(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code,
            message: message.into(),
            correlation_id: None,
            internal_details: None,
        }
    }

    pub fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::CONFLICT,
            code,
            message: message.into(),
            correlation_id: None,
            internal_details: None,
        }
    }

    pub fn internal(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code,
            message: message.into(),
            correlation_id: None,
            internal_details: None,
        }
    }

    /// Set correlation ID from request context
    pub fn with_correlation_id(mut self, correlation_id: impl Into<String>) -> Self {
        self.correlation_id = Some(correlation_id.into());
        self
    }

    /// Set internal details for logging (never exposed to clients)
    pub fn with_internal_details(mut self, details: impl Into<String>) -> Self {
        self.internal_details = Some(details.into());
        self
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // Generate support ID for this error instance
        let support_id = Uuid::new_v4().to_string();
        let correlation_id = self.correlation_id.clone().unwrap_or_else(|| "unknown".to_string());

        // INV-ERR-05: Exactly-once boundary logging
        // Log internal details here (redacted from response)
        error!(
            support_id = %support_id,
            correlation_id = %correlation_id,
            error_code = %self.code,
            status = %self.status.as_u16(),
            internal_details = ?self.internal_details,
            "Request failed at ingress boundary"
        );

        // INV-ERR-04: Structured response
        let body = ErrorResponse {
            error: ErrorBody {
                code: self.code.to_string(),
                message: self.message,
                correlation_id,
                support_id,
            },
        };

        (self.status, Json(body)).into_response()
    }
}

// Common error constructors for taxonomy codes

impl AppError {
    /// INVALID_IDEMPOTENCY_KEY - missing or malformed idempotency key
    pub fn invalid_idempotency_key() -> Self {
        Self::bad_request(
            "INVALID_IDEMPOTENCY_KEY",
            "Idempotency key is missing or empty",
        )
    }

    /// IDEMPOTENCY_CONFLICT - same key used with different payload/event
    pub fn idempotency_conflict(existing_event_id: &str) -> Self {
        Self::conflict(
            "IDEMPOTENCY_CONFLICT",
            "A different request with this idempotency key has already been processed",
        )
        .with_internal_details(format!("Existing event: {}", existing_event_id))
    }

    /// UNAUTHORIZED - principal not authorized for action
    pub fn unauthorized(reason: &str) -> Self {
        Self::forbidden("UNAUTHORIZED", "Not authorized to perform this action")
            .with_internal_details(reason.to_string())
    }

    /// TENANT_MISMATCH - request tenant doesn't match principal tenant
    pub fn tenant_mismatch() -> Self {
        Self::forbidden(
            "TENANT_MISMATCH",
            "Request tenant does not match authenticated principal",
        )
    }

    /// MISSING_REQUIRED_FIELDS - payload missing required authorization fields
    pub fn missing_authz_fields(details: &str) -> Self {
        Self::bad_request(
            "MISSING_REQUIRED_FIELDS",
            "Request payload missing required authorization fields",
        )
        .with_internal_details(details.to_string())
    }

    /// TRANSACTION_FAILED - storage operation failed
    pub fn storage_failed(internal_error: &str) -> Self {
        Self::internal(
            "TRANSACTION_FAILED",
            "Unable to process request due to an internal error",
        )
        .with_internal_details(internal_error.to_string())
    }

    /// UNKNOWN_SCHEMA - schema_id not found in registry
    pub fn unknown_schema(schema_id: &str, version: u32) -> Self {
        Self::bad_request(
            "UNKNOWN_SCHEMA",
            format!("Unknown schema: {} version {}", schema_id, version),
        )
    }

    /// SCHEMA_VALIDATION_FAILED - payload does not conform to schema
    pub fn schema_validation_failed(errors: &[String]) -> Self {
        Self::bad_request(
            "SCHEMA_VALIDATION_FAILED",
            "Request payload does not conform to the declared schema",
        )
        .with_internal_details(errors.join("; "))
    }
}
