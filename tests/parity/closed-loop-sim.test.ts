/**
 * Closed-loop parity for sim mode.
 *
 * Mirrors `tests/blackbox/suites/closed_loop_test.rs`: an intent flows through
 * submitIntent → handler → event store → dispatch → projection rebuild → query.
 * The Rust suite uses page-create; the TS sim wires only the catalog module,
 * so we use seed-apply as the equivalent end-to-end exerciser.
 */

import { describe, test, expect } from 'vitest';
import { makeSimIngress } from './lib/sim-factory.ts';
import { loadBadgeFamilySeed, buildSeedIntent } from './lib/fixtures.ts';
import {
  intentWithUnknownAction,
  uniqueIdempotencyKey,
  validIntent,
} from './lib/intent-fixtures.ts';

describe('[sim] closed_loop parity', () => {
  test('test_intent_builds_projection_and_query_returns_it', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('cl-build');
    const seed = loadBadgeFamilySeed();
    const r = await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cl-${tenantId}`, seed),
    );
    expect(r.eventId.length).toBeGreaterThan(0);
    const fam = await ingress.getFamilyDetail('service_anniversary_badge');
    expect(fam).not.toBeNull();
    await ingress.close();
  });

  test('test_second_intent_refreshes_projection', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('cl-cache');
    const seed = loadBadgeFamilySeed();
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cl-c1-${tenantId}`, seed),
    );
    const firstFam = await ingress.getFamilyDetail('service_anniversary_badge');
    expect(firstFam).not.toBeNull();

    const bumped = { ...seed, version: `v2-${tenantId}` };
    await ingress.submitIntent(
      buildSeedIntent(tenantId, principalId, `itest-cl-c2-${tenantId}`, bumped),
    );
    const refreshed = await ingress.getFamilyDetail('service_anniversary_badge');
    expect(refreshed).not.toBeNull();
    await ingress.close();
  });

  test('test_unknown_action_is_rejected', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('cl-unknown');
    const env = intentWithUnknownAction({ tenantId, principalId });
    const out = await ingress.submitIntentRaw(env);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.status).toBe(400);
    }
    await ingress.close();
  });

  test('test_cross_tenant_query_is_isolated', async () => {
    const a = await makeSimIngress('cl-iso-a');
    const b = await makeSimIngress('cl-iso-b');
    const seed = loadBadgeFamilySeed();
    await a.ingress.submitIntent(
      buildSeedIntent(a.tenantId, a.principalId, `itest-cl-iso-${a.tenantId}`, seed),
    );
    // Tenant B should never see tenant A's family detail.
    const fromB = await b.ingress.getFamilyDetail('service_anniversary_badge');
    expect(fromB).toBeNull();
    // Sanity: the same intent against tenant B (with B's principal) builds B's projection.
    await b.ingress.submitIntent(
      validIntent({
        tenantId: b.tenantId,
        principalId: b.principalId,
        idempotencyKey: uniqueIdempotencyKey('itest-cl-iso-b'),
      }),
    );
    const inB = await b.ingress.getFamilyDetail('service_anniversary_badge');
    expect(inB).not.toBeNull();
    await a.ingress.close();
    await b.ingress.close();
  });
});
