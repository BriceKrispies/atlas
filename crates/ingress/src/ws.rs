//! WebSocket endpoint for bidirectional real-time communication.
//!
//! `GET /ws/messaging` upgrades to a WebSocket connection for the Comms module.
//!
//! Security:
//! - Requires authentication (same authn middleware as all protected routes)
//! - Tenant-isolated: clients only receive events matching their principal's tenant_id
//! - Auth is validated BEFORE the WebSocket upgrade happens
//!
//! Protocol:
//! - Server → Client: `{"type":"event","payload":{...}}`
//! - Client → Server: `{"type":"intent","payload":{...}}` (future)

use crate::authn::Principal;
use crate::events::ServerEvent;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    Extension,
};
use futures::{SinkExt, StreamExt};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tracing::{debug, info, warn};

/// Handle WebSocket upgrade requests.
///
/// Auth is already validated by the authn middleware layer before this handler
/// runs. The Principal is extracted from request extensions.
pub async fn handle_ws(
    State(state): State<Arc<crate::AppState>>,
    Extension(principal): Extension<Principal>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let tenant_id = principal.tenant_id.clone();
    let principal_id = principal.id.clone();

    debug!(
        tenant_id = %tenant_id,
        principal_id = %principal_id,
        "WebSocket upgrade requested"
    );

    ws.on_upgrade(move |socket| {
        handle_socket(socket, state.event_sender.subscribe(), tenant_id, principal_id)
    })
}

async fn handle_socket(
    socket: WebSocket,
    rx: broadcast::Receiver<ServerEvent>,
    tenant_id: String,
    principal_id: String,
) {
    info!(
        tenant_id = %tenant_id,
        principal_id = %principal_id,
        "WebSocket client connected"
    );

    crate::metrics::WS_CONNECTIONS_ACTIVE.inc();

    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Server → Client: forward broadcast events filtered by tenant
    let tenant_for_send = tenant_id.clone();
    let mut send_task = tokio::spawn(async move {
        let mut stream = BroadcastStream::new(rx);
        let mut ping_interval = tokio::time::interval(Duration::from_secs(30));

        loop {
            tokio::select! {
                Some(result) = stream.next() => {
                    match result {
                        Ok(event) if event.tenant_id == tenant_for_send => {
                            let msg = serde_json::json!({
                                "type": "event",
                                "payload": {
                                    "eventType": event.event_type,
                                    "resourceType": event.resource_type,
                                    "resourceId": event.resource_id,
                                    "correlationId": event.correlation_id,
                                    "occurredAt": event.occurred_at,
                                }
                            });
                            if ws_sender.send(Message::Text(msg.to_string().into())).await.is_err() {
                                break; // Client disconnected
                            }
                        }
                        Ok(_) => {} // Different tenant, skip
                        Err(_) => {
                            warn!("WebSocket broadcast lagged, skipping events");
                        }
                    }
                }
                _ = ping_interval.tick() => {
                    if ws_sender.send(Message::Ping(vec![].into())).await.is_err() {
                        break; // Client disconnected
                    }
                }
            }
        }
    });

    // Client → Server: handle incoming messages
    let mut recv_task = tokio::spawn(async move {
        while let Some(result) = ws_receiver.next().await {
            match result {
                Ok(Message::Text(text)) => {
                    debug!(
                        tenant_id = %tenant_id,
                        "WebSocket received: {}",
                        text
                    );
                    // Future: parse and dispatch messaging intents
                }
                Ok(Message::Close(_)) => break,
                Ok(Message::Pong(_)) => {} // Keepalive response, ignore
                Err(e) => {
                    warn!("WebSocket receive error: {}", e);
                    break;
                }
                _ => {}
            }
        }
    });

    // Wait for either task to finish, then abort the other
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    crate::metrics::WS_CONNECTIONS_ACTIVE.dec();
    info!(principal_id = %principal_id, "WebSocket client disconnected");
}
