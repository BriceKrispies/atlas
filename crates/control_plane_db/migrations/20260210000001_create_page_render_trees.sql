-- Persistent storage for render trees produced by WASM plugins.
-- Survives process restarts. The in-memory projection store is the fast path.

CREATE TABLE IF NOT EXISTS control_plane.page_render_trees (
    tenant_id          TEXT        NOT NULL,
    page_id            TEXT        NOT NULL,
    render_tree_version TEXT,
    render_tree_json   JSONB       NOT NULL,
    plugin_id          TEXT,
    plugin_version     TEXT,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (tenant_id, page_id)
);

-- Index for tenant-scoped lookups (PK already covers this, but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_page_render_trees_tenant
    ON control_plane.page_render_trees (tenant_id);
