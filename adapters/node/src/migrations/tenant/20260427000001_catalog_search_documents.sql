CREATE TABLE catalog_search_documents (
    search_document_id uuid primary key default gen_random_uuid(),
    tenant_id text not null,
    document_type text not null,
    document_id text not null,
    title text not null,
    summary text,
    body_text text,
    taxonomy_path text,
    permission_attributes jsonb,
    filter_values jsonb not null default '{}'::jsonb,
    sort_values jsonb not null default '{}'::jsonb,
    search_vector tsvector
        generated always as (
            setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
            setweight(to_tsvector('english', coalesce(body_text, '')), 'C') ||
            setweight(to_tsvector('english', coalesce(taxonomy_path, '')), 'D')
        ) stored,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (tenant_id, document_type, document_id)
);

CREATE INDEX idx_catalog_search_vector ON catalog_search_documents USING gin (search_vector);

CREATE INDEX idx_catalog_search_filter ON catalog_search_documents USING gin (filter_values);

CREATE INDEX idx_catalog_search_tenant_type ON catalog_search_documents (tenant_id, document_type);
