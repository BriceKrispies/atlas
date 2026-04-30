-- Tenants table
CREATE TABLE IF NOT EXISTS control_plane.tenants (
    tenant_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    region TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Modules table (tracks module metadata)
CREATE TABLE IF NOT EXISTS control_plane.modules (
    module_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    latest_version TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Module versions table (stores versioned manifests)
CREATE TABLE IF NOT EXISTS control_plane.module_versions (
    module_id TEXT NOT NULL,
    version TEXT NOT NULL,
    manifest_json JSONB NOT NULL,
    schema_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (module_id, version),
    FOREIGN KEY (module_id) REFERENCES control_plane.modules(module_id) ON DELETE CASCADE
);

-- Tenant-module associations (which modules are enabled for which tenants)
CREATE TABLE IF NOT EXISTS control_plane.tenant_modules (
    tenant_id TEXT NOT NULL,
    module_id TEXT NOT NULL,
    enabled_version TEXT NOT NULL,
    enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    config_json JSONB,
    PRIMARY KEY (tenant_id, module_id),
    FOREIGN KEY (tenant_id) REFERENCES control_plane.tenants(tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (module_id, enabled_version) REFERENCES control_plane.module_versions(module_id, version) ON DELETE RESTRICT
);

-- Schema registry (stores JSON schemas with versioning)
CREATE TABLE IF NOT EXISTS control_plane.schema_registry (
    schema_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    json_schema JSONB NOT NULL,
    compat_mode TEXT NOT NULL DEFAULT 'BACKWARD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (schema_id, version)
);

-- Policies table (stores tenant-specific policy bundles)
CREATE TABLE IF NOT EXISTS control_plane.policies (
    tenant_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    policy_json JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, version),
    FOREIGN KEY (tenant_id) REFERENCES control_plane.tenants(tenant_id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tenant_modules_tenant_id ON control_plane.tenant_modules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_module_versions_module_id ON control_plane.module_versions(module_id);
CREATE INDEX IF NOT EXISTS idx_schema_registry_schema_id ON control_plane.schema_registry(schema_id);
CREATE INDEX IF NOT EXISTS idx_policies_tenant_id ON control_plane.policies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_policies_status ON control_plane.policies(tenant_id, status) WHERE status = 'active';
