import { projectionStoreContract } from '@atlas/contract-tests';
import { PostgresProjectionStore } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';
// TEST_TENANT_DB_URL not set — Postgres projection store contract suite registers nothing.
if (HAS_DB) {
    projectionStoreContract(async function () {
        const sql = await freshSql();
        return new PostgresProjectionStore(sql);
    });
}
