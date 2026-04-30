CREATE TABLE IF NOT EXISTS cache_entries (
    cache_key   text PRIMARY KEY,
    value       jsonb,
    tags        text[] NOT NULL DEFAULT '{}',
    expires_at  timestamptz,
    set_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cache_entries_tags_idx
    ON cache_entries USING gin (tags);
