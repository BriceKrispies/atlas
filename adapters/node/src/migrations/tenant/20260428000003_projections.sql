CREATE TABLE IF NOT EXISTS projections (
    projection_key text PRIMARY KEY,
    value          jsonb,
    updated_at     timestamptz NOT NULL DEFAULT now()
);
