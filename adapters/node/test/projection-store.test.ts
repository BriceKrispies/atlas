import { describe, it } from 'vitest';
import { projectionStoreContract } from '@atlas/contract-tests';
import { PostgresProjectionStore } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';

if (HAS_DB) {
  projectionStoreContract(async () => {
    const sql = await freshSql();
    return new PostgresProjectionStore(sql);
  });
} else {
  describe('PostgresProjectionStore (skipped)', () => {
    it.skip('TEST_TENANT_DB_URL not set — skipping Postgres projection store contract', () => {
      // intentionally empty
    });
  });
}
