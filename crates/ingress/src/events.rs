//! Server event types for the broadcast fan-out channel.
//!
//! `ServerEvent` is the lightweight struct published by the worker loop
//! and consumed by SSE/WebSocket handlers. It contains only metadata —
//! never full payloads — to prevent data leakage across tenant boundaries.

/// A server-side event published to connected clients via SSE or WebSocket.
///
/// This is intentionally minimal: clients receive the event type and resource
/// identifiers, then query the API for full data if needed.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ServerEvent {
    /// Domain event type (e.g., "projection.updated", "cache.invalidated")
    pub event_type: String,
    /// Tenant this event belongs to — used for filtering, never sent to client
    #[serde(skip)]
    pub tenant_id: String,
    /// Resource type affected (e.g., "page", "badge")
    pub resource_type: String,
    /// Resource identifier
    pub resource_id: String,
    /// Correlation ID linking to the originating user action
    pub correlation_id: String,
    /// ISO 8601 timestamp
    pub occurred_at: String,
}
