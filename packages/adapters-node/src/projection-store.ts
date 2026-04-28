/**
 * PostgresProjectionStore — Postgres-backed `ProjectionStore` adapter.
 *
 * Schema (created by `ensureProjectionStoreSchema`):
 *
 *   CREATE TABLE projections (
 *     projection_key text PRIMARY KEY,
 *     value          jsonb NOT NULL,
 *     updated_at     timestamptz NOT NULL DEFAULT now()
 *   );
 *
 * `value` is `jsonb` — the contract requires "values can be primitives";
 * `jsonb` accepts numbers, strings, booleans, arrays, objects, and SQL
 * `null`. The `null` value contract is "may return null in either case
 * (stored or missing)" so we don't need a sentinel.
 */

import type { ProjectionStore } from '@atlas/ports';
import type postgres from 'postgres';

export async function ensureProjectionStoreSchema(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS projections (
      projection_key text PRIMARY KEY,
      value          jsonb,
      updated_at     timestamptz NOT NULL DEFAULT now()
    );
  `);
}

export class PostgresProjectionStore implements ProjectionStore {
  constructor(private readonly sql: postgres.Sql) {}

  async get(key: string): Promise<unknown | null> {
    const rows = await this.sql<Array<{ value: unknown }>>`
      SELECT value FROM projections WHERE projection_key = ${key} LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return row.value as unknown;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.sql`
      INSERT INTO projections (projection_key, value, updated_at)
      VALUES (${key}, ${this.sql.json(value as never)}, now())
      ON CONFLICT (projection_key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = now()
    `;
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM projections WHERE projection_key = ${key}
    `;
    return result.count > 0;
  }
}
