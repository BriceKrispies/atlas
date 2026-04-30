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
 *   pnpm --filter @atlas/adapter-node test
 *
 * Schema is installed by the bundled `runMigrations(sql, 'tenant')` —
 * same code path that production `apps/server` uses, so test and prod
 * share a single migrations source of truth.
 *
 * Each `freshSql()` call returns a `postgres.Sql` connected to the same DB
 * with all relevant tables truncated, so test cases don't cross-contaminate.
 */

import postgres from 'postgres';
import { afterAll, beforeAll } from 'vitest';
import { runMigrations } from '../src/index.ts';

export const TEST_DB_URL = process.env['TEST_TENANT_DB_URL'];
export const HAS_DB = typeof TEST_DB_URL === 'string' && TEST_DB_URL.length > 0;

let sharedSql: postgres.Sql | null = null;

async function ensureSql(): Promise<postgres.Sql> {
  if (!HAS_DB) {
    throw new Error('TEST_TENANT_DB_URL not set');
  }
  if (!sharedSql) {
    sharedSql = postgres(TEST_DB_URL!, { max: 4, prepare: false });
    await runMigrations(sharedSql, 'tenant');
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
