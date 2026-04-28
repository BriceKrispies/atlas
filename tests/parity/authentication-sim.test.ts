/**
 * Authentication parity for sim mode.
 *
 * The sim has no HTTP layer and no JWT verifier — the IDB factory just trusts
 * the (tenantId, principalId) you hand it. Most of the Rust authentication
 * suite (missing/invalid/expired/malformed JWT, audience mismatch, debug
 * principal header, JWT-vs-401-vs-403 separation) only meaningful at the HTTP
 * boundary. Those scenarios live exclusively in `authentication-node.test.ts`.
 *
 * The sim equivalents — "submitIntent rejects when the envelope's principal
 * contradicts the authenticated one" — are already covered by
 * `authorization-sim.test.ts`. We keep one smoke test here so the [sim] suite
 * shape mirrors [node] for greppability.
 */

import { describe, test, expect } from 'vitest';
import { makeSimIngress } from './lib/sim-factory.ts';

describe('[sim] authentication parity', () => {
  test('sim_principal_is_trusted_no_jwt', async () => {
    // Documenting the LIES.md-style gap: sim mode has no JWT verification.
    // A factory invocation with arbitrary principalId / tenantId is accepted.
    const { ingress, tenantId, principalId } = await makeSimIngress('auth-sim');
    expect(ingress.tenantId).toBe(tenantId);
    expect(ingress.principalId).toBe(principalId);
    const ready = await ingress.ready();
    expect(ready.body.status).toBe('ok');
    await ingress.close();
  });
});
