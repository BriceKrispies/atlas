/**
 * Tenant-DB isolation parity, sim mode.
 *
 * Mirrors `tests/blackbox/suites/tenant_db_isolation_test.rs`. The Rust suite
 * provisions two tenants in Postgres and proves their tables don't share rows.
 * The sim equivalent: each tenantId opens its own IndexedDB database
 * (`atlas-sim-<tenantId>`), so writing into A's catalog state must be invisible
 * from B's ingress instance.
 */

import { describe, test, expect } from 'vitest';
import { makeSimIngress } from './lib/sim-factory.ts';
import { loadBadgeFamilySeed, buildSeedIntent } from './lib/fixtures.ts';

describe('[sim] tenant_isolation parity', () => {
  test('test_two_tenants_have_isolated_databases', async () => {
    const a = await makeSimIngress('iso-a');
    const b = await makeSimIngress('iso-b');
    expect(a.tenantId).not.toBe(b.tenantId);

    const seed = loadBadgeFamilySeed();
    await a.ingress.submitIntent(
      buildSeedIntent(a.tenantId, a.principalId, `iso-${a.tenantId}`, seed),
    );

    // A sees its own seed.
    const famA = await a.ingress.getFamilyDetail('service_anniversary_badge');
    expect(famA).not.toBeNull();

    // B's IDB database is a separate file — cannot see A's projections.
    const famB = await b.ingress.getFamilyDetail('service_anniversary_badge');
    expect(famB).toBeNull();
    const taxB = await b.ingress.getTaxonomyNodes('recognition');
    expect(taxB).toBeNull();

    await a.ingress.close();
    await b.ingress.close();
  });
});
