//! Server-Sent Events (SSE) endpoint for real-time server-push.
//!
//! `GET /api/v1/events` streams domain events to authenticated frontend clients.
//!
//! Security:
//! - Requires authentication (same authn middleware as all protected routes)
//! - Tenant-isolated: clients only receive events matching their principal's tenant_id
//! - No payload leakage: events contain metadata only (type, resource ID, correlation ID)
//!
//! Reconnection:
//! - Supports `Last-Event-ID` header for automatic browser reconnection
//! - Sends keepalive comments every 15 seconds to prevent proxy timeouts

use crate::authn::Principal;
use axum::{
    extract::State,
    http::HeaderMap,
    response::{
        sse::{Event, KeepAlive},
        Sse,
    },
    Extension,
};
use futures::stream::Stream;
use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tracing::{debug, warn};

/// Handle SSE connections.
///
/// Subscribes to the broadcast channel and streams tenant-filtered events
/// as `text/event-stream` responses.
pub async fn handle_sse(
    State(state): State<Arc<crate::AppState>>,
    Extension(principal): Extension<Principal>,
    headers: HeaderMap,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let tenant_id = principal.tenant_id.clone();

    // Parse Last-Event-ID for reconnection support
    let last_event_id: u64 = headers
        .get("Last-Event-ID")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    debug!(
        tenant_id = %tenant_id,
        principal_id = %principal.id,
        last_event_id = last_event_id,
        "SSE client connected"
    );

    crate::metrics::SSE_CONNECTIONS_ACTIVE.inc();

    // Subscribe to broadcast channel
    let rx = state.event_sender.subscribe();
    let mut counter = last_event_id;

    let stream = BroadcastStream::new(rx)
        .filter_map(move |result| {
            match result {
                Ok(event) if event.tenant_id == tenant_id => {
                    counter += 1;
                    let data = serde_json::json!({
                        "eventType": event.event_type,
                        "resourceType": event.resource_type,
                        "resourceId": event.resource_id,
                        "correlationId": event.correlation_id,
                        "occurredAt": event.occurred_at,
                    });
                    Some(Ok(
                        Event::default()
                            .event(&event.event_type)
                            .id(counter.to_string())
                            .data(data.to_string()),
                    ))
                }
                Ok(_) => None, // Different tenant, skip
                Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n)) => {
                    warn!(skipped = n, "SSE client lagged, skipped events");
                    None
                }
            }
        });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    )
}
