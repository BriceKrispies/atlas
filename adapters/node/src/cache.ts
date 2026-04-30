/**
 * PostgresCache — Postgres-backed `Cache` adapter.
 *
 * Schema is installed by the bundled migration
 * `migrations/tenant/20260428000002_cache_entries.sql` (run via the
 * @atlas/adapter-node migration runner).
 *
 * Behaviour:
 * - `set` upserts on `cache_key`. `ttlSeconds=0` stores `expires_at = NULL`
 *   meaning "no expiry".
 * - `get` deletes-on-read entries whose `expires_at < now()` and returns
 *   `null` for them.
 * - `invalidateByTags` does `DELETE ... WHERE tags && $1`, returning the
 *   deleted row count.
 *
 * Rationale for jsonb (rather than `bytea`): every value the domain code
 * stores in this cache is JSON-serialisable, mirroring the IDB adapter's
 * round-trip semantics. Switch to `bytea` only if a non-JSON value ever
 * needs to be cached (none today).
 */

import type { CacheSetOptions } from '@atlas/platform-core';
import type { Cache } from '@atlas/ports';
import type postgres from 'postgres';

export class PostgresCache implements Cache {
  constructor(private readonly sql: postgres.Sql) {}

  async get(key: string): Promise<unknown | null> {
    // Delete-on-read for expired rows.
    const rows = await this.sql<
      Array<{ value: unknown; expires_at: Date | null }>
    >`
      SELECT value, expires_at
      FROM cache_entries
      WHERE cache_key = ${key}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
      await this.sql`DELETE FROM cache_entries WHERE cache_key = ${key}`;
      return null;
    }
    return row.value as unknown;
  }

  async set(key: string, value: unknown, opts: CacheSetOptions): Promise<void> {
    const expires =
      opts.ttlSeconds > 0 ? new Date(Date.now() + opts.ttlSeconds * 1000) : null;
    const tags = [...opts.tags];
    await this.sql`
      INSERT INTO cache_entries (cache_key, value, tags, expires_at, set_at)
      VALUES (
        ${key},
        ${this.sql.json(value as never)},
        ${tags},
        ${expires},
        now()
      )
      ON CONFLICT (cache_key) DO UPDATE SET
        value = EXCLUDED.value,
        tags = EXCLUDED.tags,
        expires_at = EXCLUDED.expires_at,
        set_at = EXCLUDED.set_at
    `;
  }

  async invalidateByKey(key: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM cache_entries WHERE cache_key = ${key}
    `;
    // postgres.js exposes affected count via `result.count`.
    return result.count > 0;
  }

  async invalidateByTags(tags: ReadonlyArray<string>): Promise<number> {
    if (tags.length === 0) return 0;
    const tagArr = [...tags];
    const result = await this.sql`
      DELETE FROM cache_entries
      WHERE tags && ${tagArr}::text[]
    `;
    return result.count;
  }
}
