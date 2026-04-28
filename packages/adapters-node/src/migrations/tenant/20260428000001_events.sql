CREATE TABLE IF NOT EXISTS events (
    event_id                text PRIMARY KEY,
    event_type              text NOT NULL,
    schema_id               text NOT NULL,
    schema_version          integer NOT NULL,
    tenant_id               text NOT NULL,
    idempotency_key         text NOT NULL,
    occurred_at             timestamptz NOT NULL,
    correlation_id          text NOT NULL,
    causation_id            text,
    principal_id            text,
    user_id                 text,
    payload                 jsonb NOT NULL,
    cache_invalidation_tags text[]
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_events_tenant_idempotency
    ON events (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_events_tenant_occurred
    ON events (tenant_id, occurred_at, event_id);
