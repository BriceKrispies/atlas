//! Ingress HTTP service - single entry point chokepoint.
//!
//! Implements Invariant I1: Single Ingress Enforcement
//! All external requests enter through this service which performs:
//! - Authentication (Principal extraction or rejection)
//! - Request validation
//! - Authorization (before execution) - Invariant I2
//! - Tenant validation - Invariant I5
//! - Idempotency checking - Invariant I3
//! - Routing to domain handlers
//!
//! # Authentication Architecture
//!
//! Every request passes through the `authn_middleware` which:
//! 1. Attempts to authenticate the request (Bearer token, API key, or test header)
//! 2. On success: stores the `Principal` in request extensions
//! 3. On failure: returns 401 Unauthorized immediately
//!
//! Handlers can then extract the `Principal` via `Extension<Principal>`.
//!
//! # Authorization Architecture
//!
//! After authentication, handlers perform authorization via `authz::authorize()`:
//! 1. Build `AuthorizationContext` with action, resource_type, tenant_id
//! 2. Call policy engine for decision
//! 3. On DENY: return 403 Forbidden
//! 4. On ALLOW: proceed to business logic
//!
//! # Tenant Isolation
//!
//! Request body tenant_id is validated against Principal's tenant_id.
//! Mismatch results in 403 Forbidden.
//!
//! # Test Auth Mode
//!
//! When compiled with `test-auth` feature AND `TEST_AUTH_ENABLED=true`:
//! - The `X-Debug-Principal` header can inject a principal for testing
//! - Format: `type:id` or `type:id:tenant_id` (e.g., `user:123`, `service:worker:tenant-001`)
//!
//! This is NEVER available in production builds.
//!
//! # Debug Auth Endpoint
//!
//! When compiled with `test-auth` feature AND `DEBUG_AUTH_ENDPOINT_ENABLED=true`:
//! - GET `/debug/whoami` returns the authenticated principal as JSON
//! - Useful for validating OAuth2/OIDC token parsing locally
//! - Response includes: tenantId, principalId, principalType, claims
//! - If not authenticated, returns 401 (same as other protected endpoints)
//!
//! This endpoint is NEVER registered in production builds.

pub mod authn;
pub mod authz;
mod bootstrap;
mod errors;
mod metrics;
mod schema;

use authn::{authn_middleware, AuthConfig, Principal};
use authz::{authorize, validate_tenant_match, AuthorizationContext, IntentAuthzRequest};
use atlas_core::policy::Decision;
use errors::AppError;
use schema::SchemaValidationResult;
use atlas_core::types::EventEnvelope;
use atlas_platform_adapters::InMemoryEventStore;
use atlas_platform_runtime::ports::EventStore;
use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::IntoResponse,
    routing::{get, post},
    Extension, Json, Router,
};
use bootstrap::RuntimeConfig;
use std::sync::Arc;
use std::time::Instant;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{error, info};

struct AppState {
    event_store: Arc<dyn EventStore>,
    runtime_config: Arc<RuntimeConfig>,
    #[allow(dead_code)] // Used for potential future auth-related operations
    auth_config: Arc<AuthConfig>,
}

#[tokio::main]
async fn main() {
    atlas_core::init_logging();

    info!("Starting ingress service...");

    // Bootstrap runtime configuration from Control Plane or in-memory
    let runtime_config = match bootstrap::bootstrap_runtime().await {
        Ok(config) => {
            info!("✓ Runtime configuration loaded successfully");
            info!("  Tenant: {}", config.tenant_id);
            info!("  Policies loaded: {}", config.policies.len());
            Arc::new(config)
        }
        Err(e) => {
            error!("Failed to bootstrap runtime: {}", e);
            error!("Exiting...");
            std::process::exit(1);
        }
    };

    let event_store = Arc::new(InMemoryEventStore::new());
    let auth_config = Arc::new(runtime_config.auth_config.clone());
    let tenant_id_for_middleware = runtime_config.tenant_id.clone();
    let state = Arc::new(AppState {
        event_store,
        runtime_config,
        auth_config: auth_config.clone(),
    });

    // Create authn middleware closure that captures auth_config and tenant_id
    let auth_config_clone = auth_config.clone();
    let tenant_id_clone = tenant_id_for_middleware.clone();
    let authn_layer = middleware::from_fn(move |request: Request<Body>, next: Next| {
        let auth_config = auth_config_clone.clone();
        let tenant_id = tenant_id_clone.clone();
        async move { authn_middleware(auth_config, tenant_id, request, next).await }
    });

    // Routes that require authentication
    let mut authenticated_routes = Router::new()
        .route("/api/v1/intents", post(handle_intent));

    // Conditionally add debug endpoint (only when enabled via feature + env var)
    // The route is only registered when DEBUG_AUTH_ENDPOINT_ENABLED=true
    // AND the binary was compiled with the test-auth feature.
    if auth_config.is_debug_endpoint_enabled() {
        info!("Registering /debug/whoami endpoint (DEBUG_AUTH_ENDPOINT_ENABLED=true)");
        authenticated_routes = authenticated_routes.route("/debug/whoami", get(debug_whoami));
    }

    let authenticated_routes = authenticated_routes.layer(authn_layer);

    // Routes that don't require authentication (health, metrics)
    let public_routes = Router::new()
        .route("/", get(health_check))
        .route("/healthz", get(liveness_check))
        .route("/readyz", get(readiness_check))
        .route("/metrics", get(metrics_handler));

    // CORS configuration for local development
    // Allows browser-based frontend to call the ingress API
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .merge(authenticated_routes)
        .merge(public_routes)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    info!("✓ ingress ready on http://0.0.0.0:3000");
    info!("  Metrics endpoint: http://0.0.0.0:3000/metrics");
    axum::serve(listener, app).await.unwrap();
}

async fn metrics_handler() -> impl IntoResponse {
    metrics::gather_metrics()
}

async fn health_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "healthy",
        "service": "ingress",
        "tenant": state.runtime_config.tenant_id
    }))
}

/// Liveness probe endpoint for Kubernetes.
///
/// Returns 200 OK if the process is running and can serve HTTP requests.
/// This check does NOT verify external dependencies - it only confirms
/// the HTTP server is responsive.
///
/// # Response
/// - 200 OK: `{"status": "ok"}`
async fn liveness_check() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok"
    }))
}

/// Readiness probe endpoint for Kubernetes.
///
/// Returns 200 OK only when the service is ready to receive traffic.
/// Checks minimal required dependencies:
/// - Schema registry has schemas loaded (required for validation)
/// - Policy engine has policies loaded (required for authorization)
///
/// # Response
/// - 200 OK: `{"status": "ok", "checks": {...}}` when all checks pass
/// - 503 Service Unavailable: `{"status": "unavailable", "checks": {...}}` with failing check details
async fn readiness_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let mut checks = serde_json::Map::new();
    let mut all_ready = true;

    // Check 1: Schema registry has schemas loaded
    let schema_count = state.runtime_config.schema_registry.len();
    if schema_count > 0 {
        checks.insert(
            "schema_registry".to_string(),
            serde_json::json!({
                "status": "ok",
                "schema_count": schema_count
            }),
        );
    } else {
        all_ready = false;
        checks.insert(
            "schema_registry".to_string(),
            serde_json::json!({
                "status": "unavailable",
                "error": "no schemas loaded"
            }),
        );
    }

    // Check 2: Policies are loaded
    let policy_count = state.runtime_config.policies.len();
    if policy_count > 0 {
        checks.insert(
            "policies".to_string(),
            serde_json::json!({
                "status": "ok",
                "policy_count": policy_count
            }),
        );
    } else {
        all_ready = false;
        checks.insert(
            "policies".to_string(),
            serde_json::json!({
                "status": "unavailable",
                "error": "no policies loaded"
            }),
        );
    }

    if all_ready {
        (
            StatusCode::OK,
            Json(serde_json::json!({
                "status": "ok",
                "checks": checks
            })),
        )
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "status": "unavailable",
                "checks": checks
            })),
        )
    }
}

/// Debug endpoint that returns the authenticated principal.
///
/// This endpoint is ONLY available when:
/// 1. Compiled with `test-auth` feature
/// 2. `DEBUG_AUTH_ENDPOINT_ENABLED=true` env var is set
///
/// It exists to validate OAuth2/OIDC locally without guessing what the auth
/// pipeline derived from a token.
///
/// # Response
///
/// Returns 200 with JSON containing:
/// - `tenantId`: The principal's tenant
/// - `principalId`: The principal's ID
/// - `principalType`: user, service, or anonymous
/// - `claims`: Additional attributes/claims from the token
///
/// If authentication fails, returns 401/403 just like any other protected endpoint.
async fn debug_whoami(Extension(principal): Extension<Principal>) -> impl IntoResponse {
    // Build response with principal info useful for debugging
    // Note: We intentionally do NOT include raw tokens or sensitive data
    let response = serde_json::json!({
        "tenantId": principal.tenant_id,
        "principalId": principal.id,
        "principalType": principal.principal_type,
        "claims": principal.claims,
        // Note: raw token metadata (iss, aud, sub, exp) would be included here
        // if we had JWT validation implemented. Currently these come from claims.
        "_debug": {
            "note": "This endpoint is for local OAuth2/OIDC validation only",
            "claimsCount": principal.claims.len()
        }
    });

    (StatusCode::OK, Json(response))
}

async fn handle_intent(
    State(state): State<Arc<AppState>>,
    Extension(principal): Extension<Principal>,
    Json(envelope): Json<EventEnvelope>,
) -> Result<impl IntoResponse, AppError> {
    let start = Instant::now();
    let route = "/api/v1/intents";
    let method = "POST";
    let correlation_id = envelope.correlation_id.clone();

    // Schema validation: Validate payload against declared schema
    // This must happen early to reject malformed requests before processing
    match state.runtime_config.schema_registry.validate(
        &envelope.schema_id,
        envelope.schema_version,
        &envelope.payload,
    ) {
        SchemaValidationResult::Valid => {
            // Payload conforms to schema, continue processing
        }
        SchemaValidationResult::UnknownSchema { schema_id, version } => {
            info!(
                schema_id = %schema_id,
                version = version,
                "Unknown schema in intent"
            );
            metrics::HTTP_REQUESTS_TOTAL
                .with_label_values(&[route, method, "400"])
                .inc();
            metrics::HTTP_REQUEST_DURATION_SECONDS
                .with_label_values(&[route, method])
                .observe(start.elapsed().as_secs_f64());
            return Err(AppError::unknown_schema(&schema_id, version)
                .with_correlation_id(&correlation_id));
        }
        SchemaValidationResult::ValidationFailed { errors } => {
            info!(
                schema_id = %envelope.schema_id,
                error_count = errors.len(),
                "Schema validation failed for intent payload"
            );
            metrics::HTTP_REQUESTS_TOTAL
                .with_label_values(&[route, method, "400"])
                .inc();
            metrics::HTTP_REQUEST_DURATION_SECONDS
                .with_label_values(&[route, method])
                .observe(start.elapsed().as_secs_f64());
            return Err(AppError::schema_validation_failed(&errors)
                .with_correlation_id(&correlation_id));
        }
    }

    // Invariant I3: Validate idempotency key exists
    if envelope.idempotency_key.is_empty() {
        metrics::HTTP_REQUESTS_TOTAL
            .with_label_values(&[route, method, "400"])
            .inc();
        metrics::HTTP_REQUEST_DURATION_SECONDS
            .with_label_values(&[route, method])
            .observe(start.elapsed().as_secs_f64());
        return Err(AppError::invalid_idempotency_key()
            .with_correlation_id(&correlation_id));
    }

    // Invariant I5: Validate tenant isolation
    // Principal's tenant must match request body tenant_id
    if let Err(_) = validate_tenant_match(&principal, &envelope.tenant_id) {
        metrics::HTTP_REQUESTS_TOTAL
            .with_label_values(&[route, method, "403"])
            .inc();
        metrics::HTTP_REQUEST_DURATION_SECONDS
            .with_label_values(&[route, method])
            .observe(start.elapsed().as_secs_f64());
        return Err(AppError::tenant_mismatch()
            .with_correlation_id(&correlation_id));
    }

    // Extract action/resource from intent payload for authorization
    // The payload must contain actionId and resourceType fields
    let authz_request = match IntentAuthzRequest::from_payload(&envelope.payload) {
        Ok(req) => req,
        Err(e) => {
            info!(
                error = %e,
                event_type = %envelope.event_type,
                "Invalid intent payload: missing or invalid authorization fields"
            );
            metrics::HTTP_REQUESTS_TOTAL
                .with_label_values(&[route, method, "400"])
                .inc();
            metrics::HTTP_REQUEST_DURATION_SECONDS
                .with_label_values(&[route, method])
                .observe(start.elapsed().as_secs_f64());
            return Err(AppError::missing_authz_fields(&e.to_string())
                .with_correlation_id(&correlation_id));
        }
    };

    // Invariant I2: Authorization before execution
    // Build authorization context from extracted action/resource
    let authz_ctx = AuthorizationContext::new(authz_request, principal.tenant_id.clone());

    let decision = authorize(
        &principal,
        &authz_ctx,
        &state.runtime_config.policies,
        &state.runtime_config.policy_engine,
    );

    metrics::POLICY_EVALUATIONS_TOTAL
        .with_label_values(&[match decision.decision {
            Decision::Allow => "allow",
            Decision::Deny => "deny",
        }])
        .inc();

    if !matches!(decision.decision, Decision::Allow) {
        info!("Request denied by policy: {}", decision.reason);
        metrics::HTTP_REQUESTS_TOTAL
            .with_label_values(&[route, method, "403"])
            .inc();
        metrics::HTTP_REQUEST_DURATION_SECONDS
            .with_label_values(&[route, method])
            .observe(start.elapsed().as_secs_f64());
        return Err(AppError::unauthorized(&decision.reason)
            .with_correlation_id(&correlation_id));
    }

    // Append to event store (returns event_id - either new or existing for idempotent replay)
    let stored_event_id = match state.event_store.append(&envelope).await {
        Ok(event_id) => event_id,
        Err(e) => {
            metrics::HTTP_REQUESTS_TOTAL
                .with_label_values(&[route, method, "500"])
                .inc();
            metrics::HTTP_REQUEST_DURATION_SECONDS
                .with_label_values(&[route, method])
                .observe(start.elapsed().as_secs_f64());
            return Err(AppError::storage_failed(&e.to_string())
                .with_correlation_id(&correlation_id));
        }
    };

    // Record successful event append
    metrics::EVENTS_APPENDED_TOTAL
        .with_label_values(&[&envelope.tenant_id, &envelope.event_type])
        .inc();

    metrics::HTTP_REQUESTS_TOTAL
        .with_label_values(&[route, method, "202"])
        .inc();
    metrics::HTTP_REQUEST_DURATION_SECONDS
        .with_label_values(&[route, method])
        .observe(start.elapsed().as_secs_f64());

    Ok((
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "event_id": stored_event_id,
            "tenant_id": principal.tenant_id,
            "principal_id": principal.id
        })),
    ))
}
