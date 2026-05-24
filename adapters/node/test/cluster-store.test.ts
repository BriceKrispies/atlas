/**
 * PostgresClusterStore — runs the cross-adapter `ClusterStore` contract
 * from `@atlas/contract-tests` against the Postgres adapter.
 *
 * Like the custom-domain suite this drives `control_plane.*`, so it opens
 * a dedicated connection and runs `runMigrations(sql, 'control-plane')`.
 * Each factory call truncates `control_plane.clusters` so cases don't
 * cross-contaminate. Silently skipped when `TEST_TENANT_DB_URL` is unset.
 */
import { afterAll } from '@atlas/test';
import postgres from 'postgres';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { clusterStoreContract } from '@atlas/contract-tests';
import { PostgresClusterStore, runMigrations } from '../src/index.ts';
import { TEST_DB_URL, HAS_DB } from './_setup.ts';

// TEST_TENANT_DB_URL not set — Postgres cluster-store contract suite registers nothing.
if (HAS_DB) {
  let sql: postgres.Sql | null = null;

  async function ensureSql(): Promise<postgres.Sql> {
    if (!sql) {
      sql = postgres(
        assertDefined(TEST_DB_URL, 'HAS_DB guard ensures TEST_DB_URL is set'),
        { max: 2, prepare: false },
      );
      await runMigrations(sql, 'control-plane');
    }
    return sql;
  }

  clusterStoreContract({
    factory: async function () {
      const conn = await ensureSql();
      await conn`TRUNCATE TABLE control_plane.clusters`;
      return { store: new PostgresClusterStore(conn) };
    },
  });

  afterAll(async function () {
    if (sql) {
      await sql.end({ timeout: 1 });
      sql = null;
    }
  });
}
