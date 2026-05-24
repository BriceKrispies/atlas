import { eventStoreContract } from '@atlas/contract-tests';
import { PostgresEventStore } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';
// TEST_TENANT_DB_URL not set — Postgres event store contract suite registers nothing.
if (HAS_DB) {
    eventStoreContract(async function () {
        const sql = await freshSql();
        return new PostgresEventStore(sql);
    });
}
