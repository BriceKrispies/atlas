import { describe, it } from '@atlas/test';
import { eventStoreContract } from '@atlas/contract-tests';
import { PostgresEventStore } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';
if (HAS_DB) {
    eventStoreContract(async function () {
        const sql = await freshSql();
        return new PostgresEventStore(sql);
    });
}
else {
    describe('PostgresEventStore (skipped)', function () {
        it.skip('TEST_TENANT_DB_URL not set — skipping Postgres event store contract', function () {
            // intentionally empty
        });
    });
}
