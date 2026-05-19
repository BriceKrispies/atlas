import { describe, it } from '@atlas/test';
import { searchEngineContract } from '@atlas/contract-tests';
import { PostgresSearchEngine } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';
if (HAS_DB) {
    searchEngineContract(async function () {
        const sql = await freshSql();
        return new PostgresSearchEngine(sql);
    });
}
else {
    describe('PostgresSearchEngine (skipped)', function () {
        it.skip('TEST_TENANT_DB_URL not set — skipping Postgres search engine contract', function () {
            // intentionally empty
        });
    });
}
