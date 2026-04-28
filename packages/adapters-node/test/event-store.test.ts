import { describe, it } from 'vitest';
import { eventStoreContract } from '@atlas/contract-tests';
import { PostgresEventStore } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';

if (HAS_DB) {
  eventStoreContract(async () => {
    const sql = await freshSql();
    return new PostgresEventStore(sql);
  });
} else {
  describe('PostgresEventStore (skipped)', () => {
    it.skip('TEST_TENANT_DB_URL not set — skipping Postgres event store contract', () => {
      // intentionally empty
    });
  });
}
