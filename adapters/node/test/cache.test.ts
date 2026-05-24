import { cacheContract } from '@atlas/contract-tests';
import { PostgresCache } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';
// TEST_TENANT_DB_URL not set — Postgres cache contract suite registers nothing.
if (HAS_DB) {
    cacheContract(async function () {
        const sql = await freshSql();
        return new PostgresCache(sql);
    });
}
