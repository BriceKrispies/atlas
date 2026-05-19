import { describe, it } from '@atlas/test';
import { catalogStateStoreContract } from '@atlas/contract-tests';
import { PostgresCatalogStateStore } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';
if (HAS_DB) {
    catalogStateStoreContract(async function () {
        const sql = await freshSql();
        return new PostgresCatalogStateStore(sql);
    });
}
else {
    describe('PostgresCatalogStateStore (skipped)', function () {
        it.skip('TEST_TENANT_DB_URL not set — skipping Postgres catalog state contract', function () {
            // intentionally empty
        });
    });
}
