-- Initial control-plane schema (Phase A consolidation).
--
-- One file. The full set of control-plane tables in their final shape —
-- no historical ALTERs to follow. Future schema changes add new files;
-- this one is the canonical "what the control plane looks like at v0."
--
-- Tables:
--   tenants               — tenant registry, includes per-tenant DB connection info
--   modules               — module metadata (display name, latest version)
--   module_versions       — versioned module manifests
--   tenant_modules        — which modules each tenant has enabled
--   schema_registry       — JSON schemas (event payloads, action payloads)
--   policies              — Cedar policy bundles per tenant
--   custom_domains        — host header → tenant resolution (stub mode)
--   entity_type_registry  — L3 substrate: entity-type metadata
--   field_registry        — L3 substrate: per-field metadata
--   index_registry        — L3 substrate: declared expression indexes on entities.attrs
--
-- Spec references: specs/architecture.md, the L3 plan in
-- ~/.claude/plans/yes-mossy-galaxy.md, and the custom-domains capability
-- spec at specs/domains/tenancy/capabilities/custom-domains/README.md.

CREATE SCHEMA IF NOT EXISTS control_plane;

SET search_path TO control_plane, public;

-- =============================================================
-- tenants + modules
-- =============================================================

CREATE TABLE control_plane.tenants (
    tenant_id   TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    region      TEXT,
    -- Per-tenant DB connection info. Resolved by `PostgresTenantDbProvider`
    -- when looking up a tenant's pool.
    db_host     TEXT,
    db_port     INTEGER,
    db_name     TEXT,
    db_user     TEXT,
    db_password TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_db_name ON control_plane.tenants(db_name);

CREATE TABLE control_plane.modules (
    module_id      TEXT PRIMARY KEY,
    display_name   TEXT NOT NULL,
    latest_version TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE control_plane.module_versions (
    module_id     TEXT NOT NULL,
    version       TEXT NOT NULL,
    manifest_json JSONB NOT NULL,
    schema_hash   TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (module_id, version),
    FOREIGN KEY (module_id) REFERENCES control_plane.modules(module_id) ON DELETE CASCADE
);

CREATE INDEX idx_module_versions_module_id ON control_plane.module_versions(module_id);

CREATE TABLE control_plane.tenant_modules (
    tenant_id       TEXT NOT NULL,
    module_id       TEXT NOT NULL,
    enabled_version TEXT NOT NULL,
    enabled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    config_json     JSONB,
    PRIMARY KEY (tenant_id, module_id),
    FOREIGN KEY (tenant_id) REFERENCES control_plane.tenants(tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (module_id, enabled_version) REFERENCES control_plane.module_versions(module_id, version) ON DELETE RESTRICT
);

CREATE INDEX idx_tenant_modules_tenant_id ON control_plane.tenant_modules(tenant_id);

-- =============================================================
-- schema registry + policies
-- =============================================================

CREATE TABLE control_plane.schema_registry (
    schema_id   TEXT NOT NULL,
    version     INTEGER NOT NULL,
    json_schema JSONB NOT NULL,
    compat_mode TEXT NOT NULL DEFAULT 'BACKWARD',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (schema_id, version)
);

CREATE INDEX idx_schema_registry_schema_id ON control_plane.schema_registry(schema_id);

CREATE TABLE control_plane.policies (
    tenant_id   TEXT NOT NULL,
    version     INTEGER NOT NULL,
    policy_json JSONB NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, version),
    FOREIGN KEY (tenant_id) REFERENCES control_plane.tenants(tenant_id) ON DELETE CASCADE
);

CREATE INDEX idx_policies_tenant_id ON control_plane.policies(tenant_id);

-- "Exactly one active row per tenant" enforced at the DB level. The
-- application's activation flow demotes the previous active row and
-- promotes the new one in the same transaction; this index guarantees
-- no race can leave two `status='active'` rows for the same tenant.
CREATE UNIQUE INDEX uniq_policies_active_per_tenant
    ON control_plane.policies(tenant_id)
    WHERE status = 'active';

-- =============================================================
-- custom domains (stub)
-- =============================================================

CREATE TABLE control_plane.custom_domains (
    hostname    TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES control_plane.tenants(tenant_id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'disabled')),
    is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX custom_domains_tenant_idx ON control_plane.custom_domains(tenant_id);

CREATE UNIQUE INDEX custom_domains_tenant_primary_idx
    ON control_plane.custom_domains(tenant_id)
    WHERE is_primary = TRUE;

-- =============================================================
-- L3 substrate: metadata registries
-- =============================================================

CREATE TABLE control_plane.entity_type_registry (
    entity_type    TEXT NOT NULL,
    tenant_id      TEXT REFERENCES control_plane.tenants(tenant_id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL DEFAULT 1,
    json_schema    JSONB NOT NULL,
    origin         TEXT NOT NULL DEFAULT 'platform'
                   CHECK (origin IN ('platform', 'tenant', 'package')),
    package_id     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (entity_type, tenant_id)
);

CREATE INDEX entity_type_registry_tenant_idx
    ON control_plane.entity_type_registry(tenant_id);

CREATE TABLE control_plane.field_registry (
    entity_type   TEXT NOT NULL,
    tenant_id     TEXT REFERENCES control_plane.tenants(tenant_id) ON DELETE CASCADE,
    field_path    TEXT NOT NULL,
    data_type     TEXT NOT NULL,
    label         TEXT,
    help_text     TEXT,
    is_required   BOOLEAN NOT NULL DEFAULT FALSE,
    default_value JSONB,
    constraints   JSONB,
    origin        TEXT NOT NULL DEFAULT 'platform'
                  CHECK (origin IN ('platform', 'tenant', 'package')),
    package_id    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (entity_type, tenant_id, field_path)
);

CREATE INDEX field_registry_type_idx
    ON control_plane.field_registry(entity_type, tenant_id);

CREATE TABLE control_plane.index_registry (
    entity_type  TEXT NOT NULL,
    tenant_id    TEXT REFERENCES control_plane.tenants(tenant_id) ON DELETE CASCADE,
    index_name   TEXT NOT NULL,
    field_paths  JSONB NOT NULL,
    is_unique    BOOLEAN NOT NULL DEFAULT FALSE,
    where_clause JSONB,
    origin       TEXT NOT NULL DEFAULT 'platform'
                 CHECK (origin IN ('platform', 'tenant', 'package')),
    package_id   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (entity_type, tenant_id, index_name)
);

CREATE INDEX index_registry_type_idx
    ON control_plane.index_registry(entity_type, tenant_id);
