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

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { PostgresCustomDomainStore, runMigrations } from '../src/index.ts';
import { TEST_DB_URL, HAS_DB } from './_setup.ts';

if (!HAS_DB) {
  describe('PostgresCustomDomainStore (skipped)', () => {
    it.skip('TEST_TENANT_DB_URL not set — skipping Postgres custom-domain contract', () => {
      // intentionally empty
    });
  });
} else {
  describe('PostgresCustomDomainStore', () => {
    let sql: postgres.Sql;
    let store: PostgresCustomDomainStore;
    const TENANT_A = 'cd-test-a';
    const TENANT_B = 'cd-test-b';

    beforeAll(async () => {
      // Dedicated connection for this suite (the shared `freshSql` setup
      // truncates tenant tables, but we want to drive control_plane.* on
      // the same DB).
      sql = postgres(TEST_DB_URL!, { max: 2, prepare: false });
      await runMigrations(sql, 'control-plane');
    });

    beforeEach(async () => {
      // Clear custom_domains for our test tenants. Using DELETE ... WHERE
      // (rather than TRUNCATE) is fine — the table stays small.
      await sql`DELETE FROM control_plane.custom_domains WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
      await sql`DELETE FROM control_plane.tenants WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
      await sql`INSERT INTO control_plane.tenants (tenant_id, name, status) VALUES (${TENANT_A}, 'A', 'active'), (${TENANT_B}, 'B', 'active')`;
      store = new PostgresCustomDomainStore(sql);
    });

    it('returns null for an unknown hostname', async () => {
      const got = await store.getByHostname('nope.example.test');
      expect(got).toBeNull();
    });

    it('add → getByHostname round-trip', async () => {
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
      expect(got).not.toBeNull();
      expect(got!.tenantId).toBe(TENANT_A);
    });

    it('getByHostname does not return disabled rows', async () => {
      await store.add({
        hostname: 'soon.acme.test',
        tenantId: TENANT_A,
        isPrimary: false,
      });
      await store.disable('soon.acme.test');
      const got = await store.getByHostname('soon.acme.test');
      expect(got).toBeNull();
    });

    it('getPrimary returns the primary row only', async () => {
      await store.add({ hostname: 'a1.acme.test', tenantId: TENANT_A, isPrimary: false });
      const noPrimary = await store.getPrimary(TENANT_A);
      expect(noPrimary).toBeNull();

      await store.add({ hostname: 'a2.acme.test', tenantId: TENANT_A, isPrimary: true });
      const primary = await store.getPrimary(TENANT_A);
      expect(primary).not.toBeNull();
      expect(primary!.hostname).toBe('a2.acme.test');
    });

    it('add with isPrimary=true demotes the previous primary', async () => {
      await store.add({ hostname: 'old.acme.test', tenantId: TENANT_A, isPrimary: true });
      await store.add({ hostname: 'new.acme.test', tenantId: TENANT_A, isPrimary: true });

      const primary = await store.getPrimary(TENANT_A);
      expect(primary!.hostname).toBe('new.acme.test');

      const old = await store.getByHostname('old.acme.test');
      expect(old!.isPrimary).toBe(false);
    });

    it('list returns rows for one tenant only', async () => {
      await store.add({ hostname: 'one.acme.test', tenantId: TENANT_A, isPrimary: true });
      await store.add({ hostname: 'two.acme.test', tenantId: TENANT_A, isPrimary: false });
      await store.add({ hostname: 'one.b.test', tenantId: TENANT_B, isPrimary: false });

      const a = await store.list(TENANT_A);
      const b = await store.list(TENANT_B);

      expect(a).toHaveLength(2);
      // Primary first
      expect(a[0]!.isPrimary).toBe(true);
      expect(a.map((r) => r.hostname).sort()).toEqual(['one.acme.test', 'two.acme.test']);

      expect(b).toHaveLength(1);
      expect(b[0]!.hostname).toBe('one.b.test');
    });

    it('disable clears the primary flag', async () => {
      await store.add({ hostname: 'primary.acme.test', tenantId: TENANT_A, isPrimary: true });
      await store.disable('primary.acme.test');

      const primary = await store.getPrimary(TENANT_A);
      expect(primary).toBeNull();

      // The row stays for audit. list() still surfaces it (any status).
      const all = await store.list(TENANT_A);
      expect(all).toHaveLength(1);
      expect(all[0]!.status).toBe('disabled');
      expect(all[0]!.isPrimary).toBe(false);
    });
  });
}
