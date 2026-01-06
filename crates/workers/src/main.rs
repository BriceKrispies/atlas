//! Workers service - background job runner.
//!
//! Processes:
//! - Projection updates (Invariant I12: rebuildable from event stream)
//! - Analytics event derivation
//! - Cache invalidation on domain events (Invariant I10)
//! - Scheduled jobs

mod metrics;

use atlas_core::mvp_shortcut;
use atlas_platform_adapters::{InMemoryCache, InMemoryEventStore};
use atlas_platform_runtime::ports::{Cache, EventStore};
use axum::{response::IntoResponse, routing::get, Router};
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};

/// Process events and trigger cache invalidation
async fn process_events(event_store: Arc<dyn EventStore>, cache: Arc<dyn Cache>) {
    mvp_shortcut!(
        id: "process_events",
        component: "workers",
        message: "Processing events is not implemented"
    );
    info!("Starting event processing loop");

    // In a real implementation, this would:
    // 1. Subscribe to event stream (polling or pub/sub)
    // 2. Track last processed event
    // 3. Process new events incrementally
    //
    // For now, we demonstrate the pattern with periodic polling
    loop {
        tokio::time::sleep(Duration::from_secs(10)).await;

        // Fetch recent events (in production, use cursor/offset)
        // For demo purposes, get all events for all tenants
        let events_result = event_store.read_events("*").await;

        match events_result {
            Ok(events) => {
                for event in events {
                    // Check if event has cache invalidation tags
                    if let Some(tags) = &event.cache_invalidation_tags {
                        if !tags.is_empty() {
                            info!(
                                event_id = %event.event_id,
                                event_type = %event.event_type,
                                tags = ?tags,
                                "Processing cache invalidation"
                            );

                            // Invalidate cache entries by tags
                            match cache.invalidate_by_tags(tags).await {
                                Ok(count) => {
                                    info!(
                                        event_id = %event.event_id,
                                        invalidated_count = count,
                                        "Cache invalidated successfully"
                                    );
                                }
                                Err(e) => {
                                    warn!(
                                        event_id = %event.event_id,
                                        error = ?e,
                                        "Failed to invalidate cache"
                                    );
                                }
                            }
                        }
                    }

                    // TODO: Apply event to projections
                    // TODO: Trigger derived analytics events
                    // TODO: Trigger scheduled jobs
                }
            }
            Err(e) => {
                warn!(error = ?e, "Failed to read events");
            }
        }
    }
}

#[tokio::main]
async fn main() {
    atlas_core::init_logging();

    info!("workers ready");

    // Initialize in-memory adapters (in production, use persistent implementations)
    let event_store = Arc::new(InMemoryEventStore::new()) as Arc<dyn EventStore>;
    let cache = Arc::new(InMemoryCache::new()) as Arc<dyn Cache>;

    // Start metrics HTTP server in background
    tokio::spawn(async {
        let app = Router::new().route("/metrics", get(metrics_handler));

        let listener = tokio::net::TcpListener::bind("0.0.0.0:9101").await.unwrap();
        info!("  Metrics endpoint: http://0.0.0.0:9101/metrics");
        axum::serve(listener, app).await.unwrap();
    });

    // Start event processing loop
    let _event_processor = tokio::spawn(async move {
        process_events(event_store, cache).await;
    });

    // Heartbeat loop
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
        info!("workers heartbeat");
        metrics::WORKER_HEARTBEATS_TOTAL.inc();
    }
}

async fn metrics_handler() -> impl IntoResponse {
    metrics::gather_metrics()
}
