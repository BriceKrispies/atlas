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
pub mod events;
mod metrics;
mod render_tree_store;
mod schema;
mod sse;
mod worker;
mod ws;

use authn::{authn_middleware, AuthConfig, Principal};
use authz::{authorize, validate_tenant_match, AuthorizationContext, IntentAuthzRequest};
use atlas_core::policy::Decision;
use errors::AppError;
use events::ServerEvent;
use schema::SchemaValidationResult;
use atlas_core::types::EventEnvelope;
use atlas_platform_adapters::{
    InMemoryCache, InMemoryEventStore, InMemoryProjectionStore, InMemoryTenantDbProvider,
    PostgresTenantDbProvider,
};
use atlas_platform_runtime::ports::{
    Cache, EventStore, ProjectionStore, SetOptions, TenantDbProvider,
};
use axum::{
    body::Body,
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::IntoResponse,
    routing::{get, post},
    Extension, Json, Router,
};
use bootstrap::RuntimeConfig;
use render_tree_store::RenderTreeStore;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::broadcast;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{debug, error, info, warn};

struct AppState {
    event_store: Arc<dyn EventStore>,
    cache: Arc<dyn Cache>,
    projection_store: Arc<dyn ProjectionStore>,
    render_tree_store: Arc<RenderTreeStore>,
    runtime_config: Arc<RuntimeConfig>,
    #[allow(dead_code)]
    auth_config: Arc<AuthConfig>,
    #[allow(dead_code)]
    tenant_db_provider: Arc<dyn TenantDbProvider>,
    event_sender: broadcast::Sender<ServerEvent>,
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

    let event_store: Arc<dyn EventStore> = Arc::new(InMemoryEventStore::new());
    let cache: Arc<dyn Cache> = Arc::new(InMemoryCache::new());
    let projection_store: Arc<dyn ProjectionStore> = Arc::new(InMemoryProjectionStore::new());
    let auth_config = Arc::new(runtime_config.auth_config.clone());
    let tenant_id_for_middleware = runtime_config.tenant_id.clone();

    // Build a shared control-plane Postgres pool (used by both the render tree
    // store and the per-tenant DB provider). Falls back to None when
    // CONTROL_PLANE_DB_URL is not set or the connection fails — both downstream
    // consumers handle that gracefully.
    let control_plane_pool = {
        use atlas_config::get_env_optional;
        use sqlx::postgres::PgPoolOptions;

        if let Some(db_url) = get_env_optional("CONTROL_PLANE_DB_URL") {
            match PgPoolOptions::new()
                .max_connections(5)
                .connect(&db_url)
                .await
            {
                Ok(pool) => {
                    info!("✓ Control plane Postgres pool ready");
                    Some(pool)
                }
                Err(e) => {
                    warn!(
                        "Control plane Postgres pool unavailable (in-memory fallbacks): {}",
                        e
                    );
                    None
                }
            }
        } else {
            info!(
                "CONTROL_PLANE_DB_URL not set — render trees in-memory only, \
                 tenant_db_provider will reject all calls"
            );
            None
        }
    };

    // Render tree store: persists projection trees to Postgres for durability
    // across restarts. Falls back to in-memory only when no pool is available.
    let render_tree_store = Arc::new(RenderTreeStore::new(control_plane_pool.clone()));

    // Per-tenant DB provider. With a control-plane pool we use the real Postgres
    // implementation; without one (in-memory bootstrap path) we install the
    // no-op variant that returns Misconfigured for any request — this keeps
    // AppState constructible while ensuring real per-tenant access fails loud.
    let tenant_db_provider: Arc<dyn TenantDbProvider> = match &control_plane_pool {
        Some(pool) => {
            info!("✓ PostgresTenantDbProvider ready");
            Arc::new(PostgresTenantDbProvider::new(pool.clone()))
        }
        None => {
            warn!("Using InMemoryTenantDbProvider — per-tenant DB access will error");
            Arc::new(InMemoryTenantDbProvider::new())
        }
    };

    // Broadcast channel for server-push (SSE + WebSocket)
    let (event_sender, _) = broadcast::channel::<ServerEvent>(256);

    // Spawn in-process worker loop sharing the same stores
    tokio::spawn(worker::run_event_loop(
        event_store.clone(),
        cache.clone(),
        projection_store.clone(),
        render_tree_store.clone(),
        event_sender.clone(),
    ));

    let state = Arc::new(AppState {
        event_store,
        cache,
        projection_store,
        render_tree_store,
        runtime_config,
        auth_config: auth_config.clone(),
        tenant_db_provider,
        event_sender,
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
        .route("/api/v1/intents", post(handle_intent))
        .route("/api/v1/pages/:page_id", get(handle_query_page))
        .route("/api/v1/pages/:page_id/render", get(handle_render_tree))
        .route("/api/v1/events", get(sse::handle_sse))
        .route("/ws/messaging", get(ws::handle_ws));

    // Conditionally add debug endpoint (only when enabled via feature + env var)
    // The route is only registered when DEBUG_AUTH_ENDPOINT_ENABLED=true
    // AND the binary was compiled with the test-auth feature.
    if auth_config.is_debug_endpoint_enabled() {
        info!("Registering /debug/whoami endpoint (DEBUG_AUTH_ENDPOINT_ENABLED=true)");
        authenticated_routes = authenticated_routes.route("/debug/whoami", get(debug_whoami));
        // Test-only: clear in-memory render tree cache for a page (simulates restart)
        authenticated_routes = authenticated_routes.route(
            "/debug/clear-render-tree-cache/:page_id",
            post(debug_clear_render_tree_cache),
        );
    }

    let authenticated_routes = authenticated_routes.layer(authn_layer);

    // Routes that don't require authentication (health, metrics, viewer)
    let public_routes = Router::new()
        .route("/", get(health_check))
        .route("/healthz", get(liveness_check))
        .route("/readyz", get(readiness_check))
        .route("/metrics", get(metrics_handler))
        .route("/pages/:page_id", get(serve_viewer));

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

    // Validate action is registered
    if state
        .runtime_config
        .action_registry
        .get(&authz_request.action_id)
        .is_err()
    {
        metrics::HTTP_REQUESTS_TOTAL
            .with_label_values(&[route, method, "400"])
            .inc();
        metrics::HTTP_REQUEST_DURATION_SECONDS
            .with_label_values(&[route, method])
            .observe(start.elapsed().as_secs_f64());
        return Err(
            AppError::unknown_action(&authz_request.action_id)
                .with_correlation_id(&correlation_id),
        );
    }

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

    // Populate cache invalidation tags for cache-aware events
    let mut envelope = envelope;
    if let Some(page_id) = envelope.payload.get("pageId").and_then(|v| v.as_str()) {
        envelope.cache_invalidation_tags = Some(vec![
            format!("Tenant:{}", envelope.tenant_id),
            format!("Page:{}", page_id),
        ]);
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

async fn handle_query_page(
    State(state): State<Arc<AppState>>,
    Extension(principal): Extension<Principal>,
    Path(page_id): Path<String>,
) -> impl IntoResponse {
    let start = Instant::now();
    let route = "/api/v1/pages/:page_id";
    let method = "GET";
    let tenant_id = &principal.tenant_id;
    let cache_key = format!("page:{}:{}", tenant_id, page_id);

    // Check cache first
    if let Ok(Some(cached)) = state.cache.get(&cache_key).await {
        if let Ok(body) = serde_json::from_slice::<serde_json::Value>(&cached) {
            metrics::CACHE_HITS_TOTAL
                .with_label_values(&[route])
                .inc();
            metrics::HTTP_REQUESTS_TOTAL
                .with_label_values(&[route, method, "200"])
                .inc();
            metrics::HTTP_REQUEST_DURATION_SECONDS
                .with_label_values(&[route, method])
                .observe(start.elapsed().as_secs_f64());
            debug!(page_id = %page_id, "Cache HIT");
            return (
                StatusCode::OK,
                [("X-Cache", "HIT")],
                Json(body),
            )
                .into_response();
        }
    }

    metrics::CACHE_MISSES_TOTAL
        .with_label_values(&[route])
        .inc();

    // Read from projection store
    let projection_key = format!("RenderPageModel:{}:{}", tenant_id, page_id);
    match state.projection_store.get(&projection_key).await {
        Ok(Some(mut model)) => {
            // Run WASM plugin if projection has a pluginRef
            if let Some(plugin_ref) = model.get("pluginRef").and_then(|v| v.as_str()).map(String::from) {
                let wasm_dir = std::env::var("WASM_PLUGIN_DIR")
                    .unwrap_or_else(|_| "./plugins".to_string());
                let wasm_path = format!("{}/{}.wasm", wasm_dir, plugin_ref);

                match tokio::fs::read(&wasm_path).await {
                    Ok(wasm_bytes) => {
                        match atlas_wasm_runtime::execute_plugin(&wasm_bytes, &model).await {
                            Ok(output) => {
                                model.as_object_mut().unwrap().insert(
                                    "rendered".to_string(),
                                    output,
                                );
                                metrics::WASM_EXECUTIONS_TOTAL
                                    .with_label_values(&[&plugin_ref, "ok"])
                                    .inc();
                                debug!(plugin = %plugin_ref, "WASM plugin executed successfully");
                            }
                            Err(e) => {
                                let obj = model.as_object_mut().unwrap();
                                obj.insert("rendered".to_string(), serde_json::Value::Null);
                                obj.insert("renderError".to_string(), serde_json::Value::String(e.to_string()));
                                let label = if matches!(e, atlas_wasm_runtime::PluginError::Timeout) {
                                    "timeout"
                                } else {
                                    "error"
                                };
                                metrics::WASM_EXECUTIONS_TOTAL
                                    .with_label_values(&[&plugin_ref, label])
                                    .inc();
                                warn!(plugin = %plugin_ref, error = %e, "WASM plugin failed");
                            }
                        }
                    }
                    Err(e) => {
                        let obj = model.as_object_mut().unwrap();
                        obj.insert("rendered".to_string(), serde_json::Value::Null);
                        obj.insert("renderError".to_string(),
                            serde_json::Value::String(format!("plugin not found: {}", e)));
                        metrics::WASM_EXECUTIONS_TOTAL
                            .with_label_values(&[&plugin_ref, "error"])
                            .inc();
                        warn!(plugin = %plugin_ref, path = %wasm_path, "WASM plugin file not found");
                    }
                }
            }

            // Cache the merged result
            let serialized = serde_json::to_vec(&model).unwrap_or_default();
            let tags = vec![
                format!("Tenant:{}", tenant_id),
                format!("Page:{}", page_id),
            ];
            let _ = state
                .cache
                .set(&cache_key, serialized, SetOptions::new(300, tags))
                .await;

            metrics::HTTP_REQUESTS_TOTAL
                .with_label_values(&[route, method, "200"])
                .inc();
            metrics::HTTP_REQUEST_DURATION_SECONDS
                .with_label_values(&[route, method])
                .observe(start.elapsed().as_secs_f64());
            debug!(page_id = %page_id, "Cache MISS, projection found");

            (
                StatusCode::OK,
                [("X-Cache", "MISS")],
                Json(model),
            )
                .into_response()
        }
        _ => {
            metrics::HTTP_REQUESTS_TOTAL
                .with_label_values(&[route, method, "404"])
                .inc();
            metrics::HTTP_REQUEST_DURATION_SECONDS
                .with_label_values(&[route, method])
                .observe(start.elapsed().as_secs_f64());

            (
                StatusCode::NOT_FOUND,
                [("X-Cache", "MISS")],
                Json(serde_json::json!({
                    "error": {
                        "code": "NOT_FOUND",
                        "message": format!("Page '{}' not found", page_id)
                    }
                })),
            )
                .into_response()
        }
    }
}

/// GET /api/v1/pages/:page_id/render — return the pre-built render tree.
///
/// Read path: in-memory projection store first, then Postgres fallback.
/// Tenant isolation via authenticated principal.
async fn handle_render_tree(
    State(state): State<Arc<AppState>>,
    Extension(principal): Extension<Principal>,
    Path(page_id): Path<String>,
) -> impl IntoResponse {
    let tenant_id = &principal.tenant_id;
    let render_key = format!("RenderTree:{}:{}", tenant_id, page_id);

    // 1. Try in-memory projection store (fast path)
    if let Ok(Some(tree)) = state.projection_store.get(&render_key).await {
        return (StatusCode::OK, Json(tree)).into_response();
    }

    // 2. Fallback to Postgres
    match state.render_tree_store.get(tenant_id, &page_id).await {
        Ok(Some(tree)) => {
            // Repopulate in-memory store for remainder of process lifetime
            let _ = state
                .projection_store
                .set(&render_key, tree.clone())
                .await;
            debug!(page_id = %page_id, "Render tree loaded from Postgres (repopulated in-memory)");
            (StatusCode::OK, Json(tree)).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": {
                    "code": "NOT_FOUND",
                    "message": format!("Render tree for page '{}' not found", page_id)
                }
            })),
        )
            .into_response(),
        Err(e) => {
            error!(page_id = %page_id, error = %e, "Postgres render tree lookup failed");
            (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({
                    "error": {
                        "code": "NOT_FOUND",
                        "message": format!("Render tree for page '{}' not found", page_id)
                    }
                })),
            )
                .into_response()
        }
    }
}

/// GET /pages/:page_id — serve the render tree viewer HTML.
///
/// Public route (no auth). The viewer fetches the render tree API with auth headers.
async fn serve_viewer(Path(_page_id): Path<String>) -> impl IntoResponse {
    (
        StatusCode::OK,
        [("content-type", "text/html; charset=utf-8")],
        include_str!("../static/viewer.html"),
    )
}

/// POST /debug/clear-render-tree-cache/:page_id — test-only hook to simulate restart.
///
/// Deletes the in-memory render tree projection for a page so the read path
/// must fall back to Postgres. Only available when compiled with `test-auth`
/// feature AND `DEBUG_AUTH_ENDPOINT_ENABLED=true`.
async fn debug_clear_render_tree_cache(
    State(state): State<Arc<AppState>>,
    Extension(principal): Extension<Principal>,
    Path(page_id): Path<String>,
) -> impl IntoResponse {
    let tenant_id = &principal.tenant_id;
    let render_key = format!("RenderTree:{}:{}", tenant_id, page_id);

    let deleted = state
        .projection_store
        .delete(&render_key)
        .await
        .unwrap_or(false);

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "cleared": deleted,
            "key": render_key
        })),
    )
}
