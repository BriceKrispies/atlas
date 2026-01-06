//! Ingress HTTP service - single entry point chokepoint.
//!
//! Implements Invariant I1: Single Ingress Enforcement
//! All external requests enter through this service which performs:
//! - Request validation
//! - Authorization (before execution)
//! - Idempotency checking
//! - Routing to domain handlers

mod bootstrap;
mod metrics;

use atlas_core::policy::PolicyEvaluationContext;
use atlas_core::types::EventEnvelope;
use atlas_platform_adapters::InMemoryEventStore;
use atlas_platform_runtime::ports::EventStore;
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use bootstrap::RuntimeConfig;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tower_http::trace::TraceLayer;
use tracing::{error, info};

struct AppState {
    event_store: Arc<dyn EventStore>,
    runtime_config: Arc<RuntimeConfig>,
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
    let state = Arc::new(AppState {
        event_store,
        runtime_config,
    });

    let app = Router::new()
        .route("/", get(health_check))
        .route("/api/v1/intents", post(handle_intent))
        .route("/metrics", get(metrics_handler))
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

async fn handle_intent(
    State(state): State<Arc<AppState>>,
    Json(envelope): Json<EventEnvelope>,
) -> Result<impl IntoResponse, StatusCode> {
    let start = Instant::now();
    let route = "/api/v1/intents";
    let method = "POST";

    // Invariant I3: Validate idempotency key exists
    if envelope.idempotency_key.is_empty() {
        metrics::HTTP_REQUESTS_TOTAL
            .with_label_values(&[route, method, "400"])
            .inc();
        metrics::HTTP_REQUEST_DURATION_SECONDS
            .with_label_values(&[route, method])
            .observe(start.elapsed().as_secs_f64());
        return Err(StatusCode::BAD_REQUEST);
    }

    // Invariant I2: Authorization before execution
    let context = PolicyEvaluationContext {
        principal_attributes: HashMap::new(),
        resource_attributes: HashMap::new(),
        environment_attributes: HashMap::new(),
    };

    let decision = state
        .runtime_config
        .policy_engine
        .evaluate(&state.runtime_config.policies, &context);

    metrics::POLICY_EVALUATIONS_TOTAL
        .with_label_values(&[match decision.decision {
            atlas_core::policy::Decision::Allow => "allow",
            atlas_core::policy::Decision::Deny => "deny",
        }])
        .inc();

    if !matches!(decision.decision, atlas_core::policy::Decision::Allow) {
        info!("Request denied by policy: {}", decision.reason);
        metrics::HTTP_REQUESTS_TOTAL
            .with_label_values(&[route, method, "403"])
            .inc();
        metrics::HTTP_REQUEST_DURATION_SECONDS
            .with_label_values(&[route, method])
            .observe(start.elapsed().as_secs_f64());
        return Err(StatusCode::FORBIDDEN);
    }

    // Append to event store
    state.event_store.append(&envelope).await.map_err(|_| {
        metrics::HTTP_REQUESTS_TOTAL
            .with_label_values(&[route, method, "500"])
            .inc();
        metrics::HTTP_REQUEST_DURATION_SECONDS
            .with_label_values(&[route, method])
            .observe(start.elapsed().as_secs_f64());
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

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
            "event_id": envelope.event_id,
            "tenant_id": state.runtime_config.tenant_id
        })),
    ))
}
