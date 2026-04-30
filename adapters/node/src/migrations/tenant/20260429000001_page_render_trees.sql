-- Render-tree projection persistence (Chunk 7).
--
-- Mirrors the Rust upsert in `crates/ingress/src/render_tree_store.rs`. The
-- Rust schema lives in `control_plane.page_render_trees`, but in the TS
-- adapters the tenant DB is the natural home (catalog_state, projections,
-- and events are all tenant-scoped). The `(tenant_id, page_id)` PK
-- preserves the same upsert key used by the Rust adapter so downstream
-- diagnostics that grep the column shape behave identically.

CREATE TABLE IF NOT EXISTS page_render_trees (
    tenant_id        text        NOT NULL,
    page_id          text        NOT NULL,
    render_tree_json jsonb       NOT NULL,
    plugin_id        text,
    plugin_version   text,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, page_id)
);
