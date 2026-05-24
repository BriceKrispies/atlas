/**
 * PostgresCustomDomainStore tests.
 *
 * Runs against the same Postgres as the tenant-DB tests (TEST_TENANT_DB_URL).
 * The control_plane schema lives in the same physical DB so a single
 * connection covers both. Migrations are idempotent so re-running the
 * suite is safe.
 *
 * Skipped silently when TEST_TENANT_DB_URL is unset (matches the rest of
 * the @atlas/adapter-node test suite).
 */
import { describe, it, expect, beforeAll, beforeEach } from '@atlas/test';
import postgres from 'postgres';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { PostgresCustomDomainStore, runMigrations } from '../src/index.ts';
import { TEST_DB_URL, HAS_DB } from './_setup.ts';
// TEST_TENANT_DB_URL not set — Postgres custom-domain contract suite registers nothing.
if (HAS_DB) {
    describe('PostgresCustomDomainStore', function () {
        let sql: postgres.Sql;
        let store: PostgresCustomDomainStore;
        const TENANT_A = 'cd-test-a';
        const TENANT_B = 'cd-test-b';
        beforeAll(async function () {
            // Dedicated connection for this suite (the shared `freshSql` setup
            // truncates tenant tables, but we want to drive control_plane.* on
            // the same DB).
            sql = postgres(assertDefined(TEST_DB_URL, 'HAS_DB guard ensures TEST_DB_URL is set'), { max: 2, prepare: false });
            await runMigrations(sql, 'control-plane');
        });
        beforeEach(async function () {
            // Clear custom_domains for our test tenants. Using DELETE ... WHERE
            // (rather than TRUNCATE) is fine — the table stays small.
            await sql `DELETE FROM control_plane.custom_domains WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
            await sql `DELETE FROM control_plane.tenants WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
            await sql `INSERT INTO control_plane.tenants (tenant_id, name, status) VALUES (${TENANT_A}, 'A', 'active'), (${TENANT_B}, 'B', 'active')`;
            store = new PostgresCustomDomainStore(sql);
        });
        it('returns null for an unknown hostname', async function () {
            const got = await store.getByHostname('nope.example.test');
            expect(got).toBeNull();
        });
        it('add → getByHostname round-trip', async function () {
            const added = await store.add({
                hostname: 'community.acme.test',
                tenantId: TENANT_A,
                isPrimary: false,
            });
            expect(added.hostname).toBe('community.acme.test');
            expect(added.tenantId).toBe(TENANT_A);
            expect(added.status).toBe('active');
            expect(added.isPrimary).toBe(false);
            const got = await store.getByHostname('community.acme.test');
            expect(assertDefined(got, 'community.acme.test was just added').tenantId).toBe(TENANT_A);
        });
        it('getByHostname does not return disabled rows', async function () {
            await store.add({
                hostname: 'soon.acme.test',
                tenantId: TENANT_A,
                isPrimary: false,
            });
            await store.disable('soon.acme.test');
            const got = await store.getByHostname('soon.acme.test');
            expect(got).toBeNull();
        });
        it('getPrimary returns the primary row only', async function () {
            await store.add({ hostname: 'a1.acme.test', tenantId: TENANT_A, isPrimary: false });
            const noPrimary = await store.getPrimary(TENANT_A);
            expect(noPrimary).toBeNull();
            await store.add({ hostname: 'a2.acme.test', tenantId: TENANT_A, isPrimary: true });
            const primary = await store.getPrimary(TENANT_A);
            expect(assertDefined(primary, 'a2.acme.test was just promoted to primary').hostname).toBe('a2.acme.test');
        });
        it('add with isPrimary=true demotes the previous primary', async function () {
            await store.add({ hostname: 'old.acme.test', tenantId: TENANT_A, isPrimary: true });
            await store.add({ hostname: 'new.acme.test', tenantId: TENANT_A, isPrimary: true });
            const primary = await store.getPrimary(TENANT_A);
            expect(assertDefined(primary, 'new.acme.test is the latest primary').hostname).toBe('new.acme.test');
            const old = await store.getByHostname('old.acme.test');
            expect(assertDefined(old, 'old.acme.test row stays for audit even after demotion').isPrimary).toBe(false);
        });
        it('list returns rows for one tenant only', async function () {
            await store.add({ hostname: 'one.acme.test', tenantId: TENANT_A, isPrimary: true });
            await store.add({ hostname: 'two.acme.test', tenantId: TENANT_A, isPrimary: false });
            await store.add({ hostname: 'one.b.test', tenantId: TENANT_B, isPrimary: false });
            const a = await store.list(TENANT_A);
            const b = await store.list(TENANT_B);
            expect(a).toHaveLength(2);
            // Primary first
            expect(assertDefined(a[0], 'list(A) has 2 rows so [0] exists').isPrimary).toBe(true);
            expect(a.map(function (r) {
                return r.hostname;
            }).sort()).toEqual(['one.acme.test', 'two.acme.test']);
            expect(b).toHaveLength(1);
            expect(assertDefined(b[0], 'list(B) has 1 row so [0] exists').hostname).toBe('one.b.test');
        });
        it('disable clears the primary flag', async function () {
            await store.add({ hostname: 'primary.acme.test', tenantId: TENANT_A, isPrimary: true });
            await store.disable('primary.acme.test');
            const primary = await store.getPrimary(TENANT_A);
            expect(primary).toBeNull();
            // The row stays for audit. list() still surfaces it (any status).
            const all = await store.list(TENANT_A);
            expect(all).toHaveLength(1);
            const only = assertDefined(all[0], 'list(A) has 1 row so [0] exists');
            expect(only.status).toBe('disabled');
            expect(only.isPrimary).toBe(false);
        });
    });
}
