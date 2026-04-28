import { describe, it } from 'vitest';
import { cacheContract } from '@atlas/contract-tests';
import { PostgresCache } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';

if (HAS_DB) {
  cacheContract(async () => {
    const sql = await freshSql();
    return new PostgresCache(sql);
  });
} else {
  describe('PostgresCache (skipped)', () => {
    it.skip('TEST_TENANT_DB_URL not set — skipping Postgres cache contract', () => {
      // intentionally empty
    });
  });
}
