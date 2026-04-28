/**
 * Tenant-DB isolation parity, node mode.
 *
 * The Rust suite provisions tenants via the control plane and connects to
 * Postgres directly to assert table-level isolation. Two scenarios down from
 * that:
 *   1. Tenant A's seed is invisible from Tenant B's ingress requests.
 *   2. The two tenants do receive distinct event ids for the same idempotency
 *      key (proves they're not sharing the events table by some bug).
 *
 * The full "physical Postgres separation" assertion (the Rust suite creates a
 * probe table on tenant A and asserts its absence from tenant B) requires a
 * direct DB connection that this fetch-only factory doesn't expose. The
 * black-box request-level test below is the strongest assertion the parity
 * suite can make without bypassing the HTTP layer.
 */

import { describe, test, expect } from 'vitest';
import { makeServerIngress } from './lib/server-factory.ts';
import { loadBadgeFamilySeed, buildSeedIntent } from './lib/fixtures.ts';
import { uniqueIdempotencyKey, validIntent } from './lib/intent-fixtures.ts';

const baseUrl = process.env['NODE_PARITY_BASE_URL'];
const d = baseUrl ? describe : describe.skip;

d('[node] tenant_isolation parity', () => {
  test('test_two_tenants_have_isolated_databases', async () => {
    const a = await makeServerIngress('iso-a');
    const b = await makeServerIngress('iso-b');
    expect(a.tenantId).not.toBe(b.tenantId);

    const seed = loadBadgeFamilySeed();
    await a.ingress.submitIntent(
      buildSeedIntent(a.tenantId, a.principalId, `iso-${a.tenantId}`, seed),
    );

    const famA = await a.ingress.getFamilyDetail('service_anniversary_badge');
    expect(famA).not.toBeNull();

    const famB = await b.ingress.getFamilyDetail('service_anniversary_badge');
    expect(famB).toBeNull();
    const taxB = await b.ingress.getTaxonomyNodes('recognition');
    expect(taxB).toBeNull();

    await a.ingress.close();
    await b.ingress.close();
  });

  test('idempotency_keys_do_not_collide_across_tenants', async () => {
    // Same idempotency key, different tenants → different events (per-tenant
    // event scope). Catches a class of cross-tenant-leak bug the Rust suite
    // proves by table inspection.
    const a = await makeServerIngress('iso-idem-a');
    const b = await makeServerIngress('iso-idem-b');
    const idem = uniqueIdempotencyKey('cross');
    const r1 = await a.ingress.submitIntent(
      validIntent({
        tenantId: a.tenantId,
        principalId: a.principalId,
        idempotencyKey: idem,
      }),
    );
    const r2 = await b.ingress.submitIntent(
      validIntent({
        tenantId: b.tenantId,
        principalId: b.principalId,
        idempotencyKey: idem,
      }),
    );
    expect(r1.eventId).not.toBe(r2.eventId);
    await a.ingress.close();
    await b.ingress.close();
  });
});
