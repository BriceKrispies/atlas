/**
 * Test harness for the Postgres-backed adapters.
 *
 * Strategy (matches the Rust `crates/adapters/src/postgres_search.rs` test
 * pattern): a real Postgres must be reachable at `TEST_TENANT_DB_URL`. The
 * suite is **silently skipped** when the env var isn't set, so CI without
 * Postgres still passes — just like the Rust suite.
 *
 * Provision locally (Podman):
 *   make db-up                       # starts the postgres container
 *   psql ... -c 'CREATE DATABASE adapters_node_test'
 *   export TEST_TENANT_DB_URL=postgres://atlas_platform:local_dev_password@localhost:5433/adapters_node_test
 *   pnpm --filter @atlas/adapters-node test
 *
 * Each `freshSql()` call returns a `postgres.Sql` connected to the same DB
 * but with all relevant tables truncated/recreated, so test cases don't
 * cross-contaminate.
 */

import postgres from 'postgres';
import { afterAll, beforeAll } from 'vitest';
import {
  ensureCacheSchema,
  ensureCatalogStateSchema,
  ensureEventStoreSchema,
  ensureProjectionStoreSchema,
} from '../src/index.ts';

const TENANT_MIGRATION = `
CREATE TABLE IF NOT EXISTS catalog_search_documents (
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
CREATE INDEX IF NOT EXISTS idx_catalog_search_vector
    ON catalog_search_documents USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_catalog_search_filter
    ON catalog_search_documents USING gin (filter_values);
CREATE INDEX IF NOT EXISTS idx_catalog_search_tenant_type
    ON catalog_search_documents (tenant_id, document_type);
`;

export const TEST_DB_URL = process.env['TEST_TENANT_DB_URL'];
export const HAS_DB = typeof TEST_DB_URL === 'string' && TEST_DB_URL.length > 0;

let sharedSql: postgres.Sql | null = null;

async function ensureSql(): Promise<postgres.Sql> {
  if (!HAS_DB) {
    throw new Error('TEST_TENANT_DB_URL not set');
  }
  if (!sharedSql) {
    sharedSql = postgres(TEST_DB_URL!, { max: 4, prepare: false });
    await ensureEventStoreSchema(sharedSql);
    await ensureCacheSchema(sharedSql);
    await ensureProjectionStoreSchema(sharedSql);
    await ensureCatalogStateSchema(sharedSql);
    await sharedSql.unsafe(TENANT_MIGRATION);
  }
  return sharedSql;
}

/**
 * Truncate every table this suite touches and return the shared `Sql`.
 * Sharing a single connection across tests is fine because each test gets
 * a clean slate via the truncation step.
 */
export async function freshSql(): Promise<postgres.Sql> {
  const sql = await ensureSql();
  await sql.unsafe(`
    TRUNCATE TABLE
      events,
      cache_entries,
      projections,
      catalog_search_documents,
      catalog_state
    RESTART IDENTITY
  `);
  return sql;
}

// Hook test lifecycle so the shared connection is opened before any test
// runs and closed at the end. Without an open DB we just fall through.
beforeAll(async () => {
  if (!HAS_DB) return;
  await ensureSql();
});

afterAll(async () => {
  if (sharedSql) {
    await sharedSql.end({ timeout: 1 });
    sharedSql = null;
  }
});
