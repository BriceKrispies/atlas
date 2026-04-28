/**
 * Health parity for sim mode.
 *
 * The sim has no HTTP layer; the factory exposes synthetic `health()` /
 * `ready()` results so the same shape can be asserted in both modes. The
 * sim's readyz response reports ok iff the bundled module manifest mounted
 * at least one action — analogous to the Rust readyz "schema_registry +
 * policies" gates.
 */

import { describe, test, expect } from 'vitest';
import { makeSimIngress } from './lib/sim-factory.ts';

describe('[sim] health parity', () => {
  test('test_liveness_endpoint_returns_200_without_auth', async () => {
    const { ingress } = await makeSimIngress('health-live');
    const r = await ingress.health();
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    await ingress.close();
  });

  test('test_readiness_endpoint_returns_200_when_ready', async () => {
    const { ingress } = await makeSimIngress('health-ready');
    const r = await ingress.ready();
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    await ingress.close();
  });

  test('test_readiness_endpoint_accessible_without_auth', async () => {
    // No auth layer in sim — trivially true; we keep the assertion shape so
    // the [sim] / [node] grep matrix lines up.
    const { ingress } = await makeSimIngress('health-no-auth');
    const r = await ingress.ready();
    expect([200, 503]).toContain(r.status);
    await ingress.close();
  });

  test('test_readiness_includes_checks', async () => {
    const { ingress } = await makeSimIngress('health-checks');
    const r = await ingress.ready();
    expect(r.body.checks).toBeDefined();
    await ingress.close();
  });
});
