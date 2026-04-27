//! In-process event worker loop for building projections and invalidating cache.
//!
//! Runs inside the ingress binary, sharing the same `Arc<dyn EventStore>`,
//! `Arc<dyn Cache>`, and `Arc<dyn ProjectionStore>` so that events appended
//! by the HTTP handler are immediately visible to the worker.

use crate::events::ServerEvent;
use crate::render_tree_store::RenderTreeStore;
use atlas_platform_runtime::ports::{Cache, EventStore, ProjectionStore, TenantDbProvider};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::time::{interval, Duration};
use tracing::{debug, error, info, warn};

/// Run the event-processing loop.
///
/// Polls `EventStore::read_events("*")` every 2 seconds, processes new events
/// (those beyond `cursor`), builds projections, and invalidates cache tags.
pub async fn run_event_loop(
    event_store: Arc<dyn EventStore>,
    cache: Arc<dyn Cache>,
    projection_store: Arc<dyn ProjectionStore>,
    render_tree_store: Arc<RenderTreeStore>,
    tenant_db_provider: Arc<dyn TenantDbProvider>,
    event_sender: broadcast::Sender<ServerEvent>,
) {
    let cursor = AtomicUsize::new(0);
    let mut tick = interval(Duration::from_secs(2));

    info!(
        "In-process worker loop started (poll interval 2s, postgres={})",
        render_tree_store.is_connected()
    );

    loop {
        tick.tick().await;

        let events = match event_store.read_events("*").await {
            Ok(e) => e,
            Err(e) => {
                error!("Worker: failed to read events: {}", e);
                continue;
            }
        };

        let prev = cursor.load(Ordering::Relaxed);
        if events.len() <= prev {
            continue;
        }

        for event in events.iter().skip(prev) {
            debug!(
                event_id = %event.event_id,
                event_type = %event.event_type,
                "Worker processing event"
            );

            // Build projection for page-create events
            if event.event_type == "ContentPages.PageCreateRequested" {
                let page_id = event
                    .payload
                    .get("pageId")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let title = event
                    .payload
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let slug = event
                    .payload
                    .get("slug")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();

                if !page_id.is_empty() {
                    let key = format!(
                        "RenderPageModel:{}:{}",
                        event.tenant_id, page_id
                    );
                    let model = serde_json::json!({
                        "pageId": page_id,
                        "title": title,
                        "slug": slug,
                        "tenantId": event.tenant_id,
                        "createdAt": event.occurred_at.to_rfc3339(),
                        "pluginRef": "demo-transform",
                    });

                    if let Err(e) = projection_store.set(&key, model.clone()).await {
                        error!("Worker: failed to store projection {}: {}", key, e);
                    } else {
                        crate::metrics::PROJECTIONS_BUILT_TOTAL
                            .with_label_values(&["RenderPageModel"])
                            .inc();
                        debug!(key = %key, "Projection stored");
                    }

                    // Build render tree from WASM plugin or default
                    let render_tree = build_render_tree(&model).await;

                    // 1. Write to in-memory projection store (fast path)
                    let render_key = format!(
                        "RenderTree:{}:{}",
                        event.tenant_id, page_id
                    );
                    if let Err(e) = projection_store.set(&render_key, render_tree.clone()).await {
                        error!("Worker: failed to store render tree {}: {}", render_key, e);
                    } else {
                        crate::metrics::PROJECTIONS_BUILT_TOTAL
                            .with_label_values(&["RenderTree"])
                            .inc();
                        debug!(render_key = %render_key, "Render tree stored (in-memory)");
                    }

                    // Publish server event to connected SSE/WS clients
                    let _ = event_sender.send(ServerEvent {
                        event_type: "projection.updated".to_string(),
                        tenant_id: event.tenant_id.clone(),
                        resource_type: "page".to_string(),
                        resource_id: page_id.to_string(),
                        correlation_id: event.correlation_id.clone(),
                        occurred_at: event.occurred_at.to_rfc3339(),
                    });

                    // 2. Write-through to Postgres (durable)
                    let plugin_ref = model.get("pluginRef").and_then(|v| v.as_str());
                    if let Err(e) = render_tree_store
                        .upsert(
                            &event.tenant_id,
                            page_id,
                            &render_tree,
                            plugin_ref,
                            None, // plugin_version not tracked yet
                        )
                        .await
                    {
                        error!(
                            tenant_id = %event.tenant_id,
                            page_id = %page_id,
                            error = %e,
                            "Worker: failed to persist render tree to Postgres (in-memory copy is fine)"
                        );
                    }
                }
            }

            // Catalog projections: rebuild on any structured-catalog event
            if event.event_type.starts_with("StructuredCatalog.") {
                match tenant_db_provider.get_pool(&event.tenant_id).await {
                    Ok(pool) => {
                        if let Err(e) = atlas_platform_catalog::projections::rebuild_taxonomy_navigation(
                            &pool,
                            &event.tenant_id,
                        )
                        .await
                        {
                            error!("Worker: taxonomy_navigation projection failed: {}", e);
                        } else {
                            crate::metrics::PROJECTIONS_BUILT_TOTAL
                                .with_label_values(&["CatalogTaxonomyNavigation"])
                                .inc();
                        }
                        if let Err(e) = atlas_platform_catalog::projections::rebuild_family_detail(
                            &pool,
                            &event.tenant_id,
                        )
                        .await
                        {
                            error!("Worker: family_detail projection failed: {}", e);
                        } else {
                            crate::metrics::PROJECTIONS_BUILT_TOTAL
                                .with_label_values(&["CatalogFamilyDetail"])
                                .inc();
                        }
                        if let Err(e) = atlas_platform_catalog::projections::rebuild_variant_matrix(
                            &pool,
                            &event.tenant_id,
                        )
                        .await
                        {
                            error!("Worker: variant_matrix projection failed: {}", e);
                        } else {
                            crate::metrics::PROJECTIONS_BUILT_TOTAL
                                .with_label_values(&["CatalogVariantMatrix"])
                                .inc();
                        }
                    }
                    Err(e) => {
                        error!(
                            tenant_id = %event.tenant_id,
                            error = %e,
                            "Worker: tenant DB unavailable, cannot rebuild catalog projections"
                        );
                    }
                }
            }

            // Cache invalidation from event tags
            if let Some(tags) = &event.cache_invalidation_tags {
                if !tags.is_empty() {
                    match cache.invalidate_by_tags(tags).await {
                        Ok(n) => {
                            debug!(count = n, "Cache entries invalidated by event tags");
                            let _ = event_sender.send(ServerEvent {
                                event_type: "cache.invalidated".to_string(),
                                tenant_id: event.tenant_id.clone(),
                                resource_type: "cache".to_string(),
                                resource_id: tags.join(","),
                                correlation_id: event.correlation_id.clone(),
                                occurred_at: event.occurred_at.to_rfc3339(),
                            });
                        }
                        Err(e) => {
                            error!("Worker: cache invalidation failed: {}", e);
                        }
                    }
                }
            }
        }

        cursor.store(events.len(), Ordering::Relaxed);
    }
}

/// Build a render tree for a page model.
///
/// If the model has a `pluginRef`, executes the WASM plugin and validates the output.
/// Otherwise, generates a default render tree with heading(title) + paragraph(slug).
/// On any failure, returns a JSON object with `renderError`.
async fn build_render_tree(model: &serde_json::Value) -> serde_json::Value {
    let plugin_ref = model.get("pluginRef").and_then(|v| v.as_str());

    match plugin_ref {
        Some(plugin_ref) => {
            let wasm_dir = std::env::var("WASM_PLUGIN_DIR")
                .unwrap_or_else(|_| "./plugins".to_string());
            let wasm_path = format!("{}/{}.wasm", wasm_dir, plugin_ref);

            match tokio::fs::read(&wasm_path).await {
                Ok(wasm_bytes) => {
                    match atlas_wasm_runtime::execute_plugin(&wasm_bytes, model).await {
                        Ok(tree) => {
                            crate::metrics::WASM_EXECUTIONS_TOTAL
                                .with_label_values(&[plugin_ref, "ok"])
                                .inc();
                            debug!(plugin = %plugin_ref, "WASM plugin produced render tree");
                            tree
                        }
                        Err(e) => {
                            crate::metrics::WASM_EXECUTIONS_TOTAL
                                .with_label_values(&[plugin_ref, "error"])
                                .inc();
                            warn!(plugin = %plugin_ref, error = %e, "WASM plugin failed");
                            serde_json::json!({
                                "renderError": e.to_string()
                            })
                        }
                    }
                }
                Err(e) => {
                    crate::metrics::WASM_EXECUTIONS_TOTAL
                        .with_label_values(&[plugin_ref, "error"])
                        .inc();
                    warn!(plugin = %plugin_ref, path = %wasm_path, "WASM plugin file not found");
                    serde_json::json!({
                        "renderError": format!("plugin not found: {}", e)
                    })
                }
            }
        }
        None => {
            // No plugin — generate default render tree
            let title = model.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled");
            let slug = model.get("slug").and_then(|v| v.as_str()).unwrap_or("");
            default_render_tree(title, slug)
        }
    }
}

/// Generate a trivial default render tree: heading(title) + paragraph(slug).
fn default_render_tree(title: &str, slug: &str) -> serde_json::Value {
    serde_json::json!({
        "version": 1,
        "nodes": [
            {
                "type": "heading",
                "props": { "level": 1 },
                "children": [
                    { "type": "text", "props": { "content": title } }
                ]
            },
            {
                "type": "paragraph",
                "children": [
                    { "type": "text", "props": { "content": format!("/{}", slug) } }
                ]
            }
        ]
    })
}
