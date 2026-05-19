/**
 * PostgresRepositoryStore + PostgresRepositoryRevisionStore — runs the
 * cross-adapter contract suite from `@atlas/contract-tests` against the
 * Postgres adapter. Mirrors the pattern in `event-store.test.ts`:
 * silently skipped when `TEST_TENANT_DB_URL` is unset.
 *
 * The contract's cross-tenant isolation test is documented as a parity
 * statement only on this factory — per-tenant DBs enforce isolation at
 * the connection level, and this test harness shares a single SQL
 * connection. The contract's skip path (no `freshOtherTenant`) is
 * intentional here; see the suite's file-level docblock.
 */
import { describe, it } from 'vitest';
import { runRepositoryStoreContract } from '@atlas/contract-tests';
import { PostgresRepositoryStore, PostgresRepositoryRevisionStore, } from '../src/index.ts';
import { freshSql, HAS_DB } from './_setup.ts';
if (HAS_DB) {
    runRepositoryStoreContract({
        factory: async function () {
            const sql = await freshSql();
            return {
                store: new PostgresRepositoryStore(sql),
                revisions: new PostgresRepositoryRevisionStore(sql),
                // No `freshOtherTenant` — see the suite docblock. The Postgres
                // adapter binds to a single per-tenant DB at the connection
                // level, and this harness shares one connection. Cross-tenant
                // isolation is delivered by the tenant-db provider in
                // production, not by an in-test assertion here.
            };
        },
    });
}
else {
    describe('PostgresRepositoryStore (skipped)', function () {
        it.skip('TEST_TENANT_DB_URL not set — skipping Postgres repository-store contract', function () {
            // intentionally empty
        });
    });
}
