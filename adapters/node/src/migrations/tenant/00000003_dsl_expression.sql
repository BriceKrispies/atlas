-- DSL artifact storage tables for the expression DSL.
--
-- Per ADR 0007 §3 + revised ADR 0005 db-per-tenant: every DSL kind ships
-- a `public._atlas_dsl_<kind>` (current) + `public._atlas_dsl_<kind>_versions`
-- (history) pair inside the tenant database.
--
-- The provisioner (atlas_platform) runs migrations; the runtime role
-- (atlas_t_<tenant>_runtime) inherits SELECT/INSERT/UPDATE/DELETE on these
-- tables via the `ALTER DEFAULT PRIVILEGES IN SCHEMA public` grant set up
-- in tenant-db-provider.ts. The runtime role has NO CREATE on public — the
-- lazy `ensureKindRegistered()` path in PostgresDslArtifactStore is now a
-- no-op for the runtime role; migrations own table creation.
--
-- Adding a new DSL kind (template, query, formula, …) lands as a new
-- migration file modelled on this one.

CREATE TABLE IF NOT EXISTS public._atlas_dsl_expression (
    artifact_id        UUID PRIMARY KEY,
    api_name           TEXT NOT NULL,
    tenant_id          TEXT NOT NULL,
    version            BIGINT NOT NULL,
    substrate_version  TEXT NOT NULL,
    source             TEXT NOT NULL,
    ast                JSONB NOT NULL,
    source_map         JSONB NOT NULL,
    dependencies       JSONB NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by         TEXT NOT NULL,
    updated_by         TEXT NOT NULL,
    UNIQUE (tenant_id, api_name)
);

CREATE TABLE IF NOT EXISTS public._atlas_dsl_expression_versions (
    artifact_id        UUID NOT NULL,
    version            BIGINT NOT NULL,
    api_name           TEXT NOT NULL,
    tenant_id          TEXT NOT NULL,
    substrate_version  TEXT NOT NULL,
    source             TEXT NOT NULL,
    ast                JSONB NOT NULL,
    source_map         JSONB NOT NULL,
    dependencies       JSONB NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL,
    created_by         TEXT NOT NULL,
    updated_by         TEXT NOT NULL,
    PRIMARY KEY (artifact_id, version)
);
