import { catalogStateStoreContract } from '@atlas/contract-tests';
import { PostgresCatalogStateStore } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';
// TEST_TENANT_DB_URL not set — Postgres catalog state contract suite registers nothing.
if (HAS_DB) {
    catalogStateStoreContract(async function () {
        const sql = await freshSql();
        return new PostgresCatalogStateStore(sql);
    });
}
