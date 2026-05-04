-- Initial tenant-DB schema (Phase A consolidation).
--
-- One file. Every per-tenant table the platform currently uses, in the
-- final shape — no historical ALTERs to follow. Future schema changes
-- add new files; this one stays the canonical "what the substrate
-- looks like at v0."
--
-- Tables:
--   events                     — append-only event log (with seq + LISTEN/NOTIFY trigger for the projection worker)
--   worker_cursors             — per-(tenant, module) projection cursor
--   cache_entries              — KV cache with tag-based invalidation
--   projections                — generic JSONB read-model store
--   catalog_search_documents   — full-text catalog search (legacy; will move to entities-backed search in Phase B.2)
--   catalog_state              — JSONB blob per tenant for the catalog seed (legacy; Phase B.2 → entities)
--   entities                   — generic JSONB entity store (the L3 substrate)
--   relations                  — typed edges between entities (the L3 substrate)
--
-- Spec references: specs/architecture.md, specs/worker.md, and the L3
-- plan in ~/.claude/plans/yes-mossy-galaxy.md.

-- =============================================================
-- events + worker plumbing
-- =============================================================

CREATE TABLE events (
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
    cache_invalidation_tags text[],
    seq                     bigserial NOT NULL
);

CREATE UNIQUE INDEX uniq_events_tenant_idempotency
    ON events (tenant_id, idempotency_key);

CREATE INDEX idx_events_tenant_occurred
    ON events (tenant_id, occurred_at, event_id);

CREATE INDEX idx_events_tenant_seq
    ON events (tenant_id, seq);

CREATE TABLE worker_cursors (
    tenant_id   text   NOT NULL,
    module_id   text   NOT NULL,
    last_seq    bigint NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, module_id)
);

-- LISTEN/NOTIFY: worker subscribes to `atlas_events_appended_<tenant_id>`
-- and gets the new event's `seq` as the payload. Channel name uses
-- underscores rather than colons because Postgres channel names follow
-- identifier rules. tenant_id is sanitised for channel safety.
CREATE OR REPLACE FUNCTION notify_event_appended() RETURNS trigger
    LANGUAGE plpgsql AS $$
DECLARE
    channel text;
BEGIN
    channel := 'atlas_events_appended_' || regexp_replace(NEW.tenant_id, '[^a-zA-Z0-9_]', '_', 'g');
    PERFORM pg_notify(channel, NEW.seq::text);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_events_notify
    AFTER INSERT ON events
    FOR EACH ROW
    EXECUTE FUNCTION notify_event_appended();

-- =============================================================
-- cache + projections
-- =============================================================

CREATE TABLE cache_entries (
    cache_key   text PRIMARY KEY,
    value       jsonb,
    tags        text[] NOT NULL DEFAULT '{}',
    expires_at  timestamptz,
    set_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cache_entries_tags_idx
    ON cache_entries USING gin (tags);

CREATE TABLE projections (
    projection_key text PRIMARY KEY,
    value          jsonb,
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- =============================================================
-- catalog (legacy; Phase B will migrate onto `entities`)
-- =============================================================

CREATE TABLE catalog_state (
    tenant_id            text PRIMARY KEY,
    seed_package_key     text NOT NULL,
    seed_package_version text NOT NULL,
    payload              jsonb NOT NULL,
    published_revisions  jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog_search_documents (
    search_document_id     uuid primary key default gen_random_uuid(),
    tenant_id              text not null,
    document_type          text not null,
    document_id            text not null,
    title                  text not null,
    summary                text,
    body_text              text,
    taxonomy_path          text,
    permission_attributes  jsonb,
    filter_values          jsonb not null default '{}'::jsonb,
    sort_values            jsonb not null default '{}'::jsonb,
    search_vector          tsvector
        generated always as (
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(body_text, '')), 'C') ||
            setweight(to_tsvector('english', coalesce(taxonomy_path, '')), 'D')
        ) stored,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    unique (tenant_id, document_type, document_id)
);

CREATE INDEX idx_catalog_search_vector ON catalog_search_documents USING gin (search_vector);
CREATE INDEX idx_catalog_search_filter ON catalog_search_documents USING gin (filter_values);
CREATE INDEX idx_catalog_search_tenant_type ON catalog_search_documents (tenant_id, document_type);

-- =============================================================
-- L3 substrate: entities + relations
-- =============================================================

CREATE TABLE entities (
    tenant_id      text        NOT NULL,
    entity_type    text        NOT NULL,
    entity_id      text        NOT NULL,
    schema_version integer     NOT NULL,
    attrs          jsonb       NOT NULL,
    status         text        NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'archived', 'deleted')),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, entity_type, entity_id)
);

CREATE INDEX entities_tenant_type_status_idx
    ON entities(tenant_id, entity_type, status);

CREATE INDEX entities_attrs_gin_idx
    ON entities USING GIN (attrs jsonb_path_ops);

CREATE TABLE relations (
    tenant_id    text        NOT NULL,
    edge_type    text        NOT NULL,
    from_id      text        NOT NULL,
    to_id        text        NOT NULL,
    attrs        jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, edge_type, from_id, to_id)
);

CREATE INDEX relations_tenant_edge_to_idx
    ON relations(tenant_id, edge_type, to_id);
