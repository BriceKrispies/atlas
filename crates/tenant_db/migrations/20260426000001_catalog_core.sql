CREATE TABLE IF NOT EXISTS catalog_taxonomy_trees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    purpose TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS catalog_taxonomy_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    tree_id UUID NOT NULL REFERENCES catalog_taxonomy_trees(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES catalog_taxonomy_nodes(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    UNIQUE (tree_id, key)
);

CREATE INDEX IF NOT EXISTS idx_catalog_taxonomy_nodes_tree ON catalog_taxonomy_nodes (tree_id);
CREATE INDEX IF NOT EXISTS idx_catalog_taxonomy_nodes_parent ON catalog_taxonomy_nodes (parent_id);

CREATE TABLE IF NOT EXISTS catalog_unit_dimensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    key TEXT NOT NULL,
    base_unit TEXT NOT NULL,
    UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS catalog_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    dimension_id UUID NOT NULL REFERENCES catalog_unit_dimensions(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    to_base_multiplier DOUBLE PRECISION NOT NULL,
    UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS catalog_attribute_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    key TEXT NOT NULL,
    data_type TEXT NOT NULL,
    unit_dimension_id UUID REFERENCES catalog_unit_dimensions(id),
    filterable_default BOOLEAN NOT NULL DEFAULT FALSE,
    sortable_default BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS catalog_attribute_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    attribute_id UUID NOT NULL REFERENCES catalog_attribute_definitions(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    UNIQUE (attribute_id, key)
);

CREATE TABLE IF NOT EXISTS catalog_families (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    key TEXT NOT NULL,
    family_type TEXT NOT NULL,
    name TEXT NOT NULL,
    canonical_slug TEXT NOT NULL,
    default_taxonomy_node_id UUID REFERENCES catalog_taxonomy_nodes(id),
    current_revision_number INTEGER NOT NULL DEFAULT 1,
    published_revision_number INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS catalog_family_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    family_id UUID NOT NULL REFERENCES catalog_families(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    published_at TIMESTAMPTZ,
    UNIQUE (family_id, revision_number)
);

CREATE TABLE IF NOT EXISTS catalog_family_taxonomy_nodes (
    family_id UUID NOT NULL REFERENCES catalog_families(id) ON DELETE CASCADE,
    taxonomy_node_id UUID NOT NULL REFERENCES catalog_taxonomy_nodes(id) ON DELETE CASCADE,
    PRIMARY KEY (family_id, taxonomy_node_id)
);

CREATE TABLE IF NOT EXISTS catalog_family_attributes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    family_id UUID NOT NULL REFERENCES catalog_families(id) ON DELETE CASCADE,
    attribute_id UUID NOT NULL REFERENCES catalog_attribute_definitions(id),
    role TEXT NOT NULL,
    required BOOLEAN NOT NULL DEFAULT FALSE,
    filterable BOOLEAN NOT NULL DEFAULT FALSE,
    sortable BOOLEAN NOT NULL DEFAULT FALSE,
    is_variant_axis BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (family_id, attribute_id)
);

CREATE TABLE IF NOT EXISTS catalog_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    family_id UUID NOT NULL REFERENCES catalog_families(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    revision_number INTEGER NOT NULL DEFAULT 1,
    UNIQUE (family_id, key)
);

CREATE TABLE IF NOT EXISTS catalog_variant_attribute_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    variant_id UUID NOT NULL REFERENCES catalog_variants(id) ON DELETE CASCADE,
    attribute_id UUID NOT NULL REFERENCES catalog_attribute_definitions(id),
    raw_value JSONB NOT NULL,
    normalized_value JSONB,
    display_value TEXT,
    UNIQUE (variant_id, attribute_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_variant_attr_values_attr ON catalog_variant_attribute_values (attribute_id);

CREATE TABLE IF NOT EXISTS catalog_family_filter_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    family_id UUID NOT NULL REFERENCES catalog_families(id) ON DELETE CASCADE,
    attribute_id UUID NOT NULL REFERENCES catalog_attribute_definitions(id),
    filter_type TEXT NOT NULL,
    operator_set TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (family_id, attribute_id)
);

CREATE TABLE IF NOT EXISTS catalog_family_sort_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    family_id UUID NOT NULL REFERENCES catalog_families(id) ON DELETE CASCADE,
    sort_key TEXT NOT NULL,
    attribute_id UUID NOT NULL REFERENCES catalog_attribute_definitions(id),
    direction TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (family_id, sort_key)
);

CREATE TABLE IF NOT EXISTS catalog_family_display_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    family_id UUID NOT NULL REFERENCES catalog_families(id) ON DELETE CASCADE,
    surface TEXT NOT NULL,
    attribute_id UUID NOT NULL REFERENCES catalog_attribute_definitions(id),
    role TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (family_id, surface, attribute_id)
);

CREATE TABLE IF NOT EXISTS catalog_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    asset_key TEXT NOT NULL,
    media_type TEXT,
    uri TEXT,
    metadata JSONB,
    UNIQUE (tenant_id, asset_key)
);

CREATE TABLE IF NOT EXISTS catalog_asset_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    asset_id UUID NOT NULL REFERENCES catalog_assets(id) ON DELETE CASCADE,
    family_id UUID REFERENCES catalog_families(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES catalog_variants(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_catalog_asset_attachments_family ON catalog_asset_attachments (family_id);
CREATE INDEX IF NOT EXISTS idx_catalog_asset_attachments_variant ON catalog_asset_attachments (variant_id);

CREATE TABLE IF NOT EXISTS catalog_family_detail_projection (
    tenant_id TEXT NOT NULL,
    family_key TEXT NOT NULL,
    family_id UUID NOT NULL,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, family_key)
);

CREATE TABLE IF NOT EXISTS catalog_variant_matrix_projection (
    tenant_id TEXT NOT NULL,
    family_key TEXT NOT NULL,
    family_id UUID NOT NULL,
    payload JSONB NOT NULL,
    filter_facets_json JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, family_key)
);

CREATE TABLE IF NOT EXISTS catalog_taxonomy_navigation_projection (
    tenant_id TEXT NOT NULL,
    tree_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, tree_key)
);
