/**
 * Smoke tests for `acquireLeadership`.
 *
 * Mirrors the test-skip pattern in `adapters/node/test/_setup.ts`: the suite
 * is silently skipped unless `TEST_TENANT_DB_URL` is set. Locally:
 *
 *   make db-up
 *   export TEST_TENANT_DB_URL=postgres://atlas_platform:local_dev_password@localhost:15433/adapters_node_test
 *   pnpm --filter @atlas/projection-worker test
 *
 * We use the tenant test DB on purpose — advisory locks are global to the
 * Postgres cluster but namespaced by `database`, so reusing the existing
 * test DB is safe and keeps the harness uniform with the adapter suite.
 */

import { afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { acquireLeadership } from '../src/leader.ts';

const TEST_DB_URL = process.env['TEST_TENANT_DB_URL'];
const HAS_DB = typeof TEST_DB_URL === 'string' && TEST_DB_URL.length > 0;

if (HAS_DB) {
  const pools: postgres.Sql[] = [];
  const newPool = (): postgres.Sql => {
    // Each pool needs at least 2 connections: one reserved for the lock,
    // plus one available for any other queries the test issues.
    const sql = postgres(TEST_DB_URL!, { max: 4, prepare: false });
    pools.push(sql);
    return sql;
  };

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end({ timeout: 1 }).catch(() => undefined)));
  });

  describe('acquireLeadership', () => {
    it('acquires and releases the advisory lock end-to-end', async () => {
      // Use a unique moduleId per test run so concurrent CI runs against
      // a shared DB don't collide.
      const moduleId = `leader-test-acquire-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const sql = newPool();

      const leadership = await acquireLeadership(sql, moduleId);
      // Releasing must not throw and must be idempotent.
      await leadership.release();
      await leadership.release();
    });

    it('serializes simultaneous acquireLeadership calls — only one resolves at a time', async () => {
      const moduleId = `leader-test-serialize-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const sqlA = newPool();
      const sqlB = newPool();

      const leadershipA = await acquireLeadership(sqlA, moduleId);

      // B must NOT be able to acquire while A holds the lock.
      let bAcquired = false;
      const bPromise = acquireLeadership(sqlB, moduleId).then((l) => {
        bAcquired = true;
        return l;
      });

      // Wait long enough for at least one poll cycle (5s) plus margin.
      // If B somehow acquired during this window, our serialization is
      // broken. We cap the wait at 7s to keep the suite tolerable.
      await new Promise((r) => setTimeout(r, 7_000));
      expect(bAcquired).toBe(false);

      // Now release A and verify B picks up leadership.
      await leadershipA.release();
      const leadershipB = await bPromise;
      expect(bAcquired).toBe(true);

      await leadershipB.release();
    }, 30_000);
  });
} else {
  describe('acquireLeadership (skipped)', () => {
    it.skip('TEST_TENANT_DB_URL not set — skipping advisory-lock leader tests', () => {
      // intentionally empty
    });
  });
}
