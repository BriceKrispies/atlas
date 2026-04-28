CREATE TABLE IF NOT EXISTS catalog_state (
    tenant_id            text PRIMARY KEY,
    seed_package_key     text NOT NULL,
    seed_package_version text NOT NULL,
    payload              jsonb NOT NULL,
    published_revisions  jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at           timestamptz NOT NULL DEFAULT now()
);
