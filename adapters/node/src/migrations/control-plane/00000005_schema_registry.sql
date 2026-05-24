-- Control-plane schema & action registry (registry-as-data).
--
-- Moves the platform intent-schema set and the action catalog from
-- compile-time static (`@atlas/schemas` `SCHEMAS` array + `moduleManifests()`)
-- to control-plane data. The bundled `@atlas/schemas` set SEEDS these tables
-- on first boot (idempotent, `source='seed'`); thereafter the tables are the
-- live source of truth. A schema registered at runtime is resolvable on the
-- next request, same process, stable bootId (I20).
--
-- PUBLIC (not tenant-scoped): platform intent schemas apply across all tenants
-- (the I9 PUBLIC carve-out). Distinct from tenant `custom-schema` (ADR 0005).
--
-- @spec specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#control-plane-storage-shape

SET search_path TO control_plane, public;

-- Platform intent-schema documents. Keyed by (schema_id, schema_version).
CREATE TABLE control_plane.intent_schemas (
    schema_id       TEXT        NOT NULL,
    schema_version  INTEGER     NOT NULL,
    document        JSONB       NOT NULL,                       -- ajv-compilable JSON Schema doc
    source          TEXT        NOT NULL DEFAULT 'seed'
                    CHECK (source IN ('seed', 'registered')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (schema_id, schema_version)
);

-- Action catalog entries. Keyed by action_id. resource_type + the derived
-- schema ref mirror the `ActionEntry` port shape.
CREATE TABLE control_plane.action_entries (
    action_id       TEXT        NOT NULL PRIMARY KEY,
    resource_type   TEXT        NOT NULL,
    schema_id       TEXT        NOT NULL,
    schema_version  INTEGER     NOT NULL,
    module_id       TEXT,                                       -- provenance for dup diagnostics
    source          TEXT        NOT NULL DEFAULT 'seed'
                    CHECK (source IN ('seed', 'registered')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Single-row monotonic change cursor. Any write to the registry tables bumps
-- `version`; the adapter compares its loaded-snapshot version against this and
-- refreshes (+ drops stale compiled validators) when it advances. Cheaper than
-- LISTEN/NOTIFY and mirrors identically to the idb in-memory counter.
CREATE TABLE control_plane.registry_version (
    singleton  BOOLEAN     NOT NULL DEFAULT TRUE,
    version    BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (singleton),
    CONSTRAINT registry_version_singleton CHECK (singleton = TRUE)
);

-- Seed the single counter row so writers can always `UPDATE ... SET version = version + 1`.
INSERT INTO control_plane.registry_version (singleton, version) VALUES (TRUE, 0);
