import { describe, test, expect } from 'vitest';
import { makeSimIngress } from './lib/sim-factory.ts';
import {
  intentWithMismatchedTenant,
  uniqueIdempotencyKey,
  validIntent,
} from './lib/intent-fixtures.ts';

describe('[sim] authorization parity', () => {
  test('test_authorized_action_succeeds', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('authz-ok');
    const env = validIntent({
      tenantId,
      principalId,
      idempotencyKey: uniqueIdempotencyKey('itest-authz-ok'),
    });
    const r = await ingress.submitIntent(env);
    expect(r.eventId.length).toBeGreaterThan(0);
    await ingress.close();
  });

  test('test_unauthorized_action_returns_403', async () => {
    // The sim's submitIntent rejects principal/tenant mismatches with 403.
    // This is the equivalent of the Rust suite's "unauthorized action" path.
    const { ingress, principalId } = await makeSimIngress('authz-bad-tenant');
    const env = intentWithMismatchedTenant({
      envelopeTenantId: 'tenant-unauthorized',
      principalId,
    });
    const out = await ingress.submitIntentRaw(env);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.status).toBe(403);
      expect(['TENANT_MISMATCH', 'UNAUTHORIZED']).toContain(out.failure.code);
    }
    await ingress.close();
  });

  test('principal_mismatch_is_rejected', async () => {
    // Distinct from tenant mismatch: principalId in envelope contradicts the
    // authenticated principal. submitIntent throws UNAUTHORIZED/403.
    const { ingress, tenantId, principalId } = await makeSimIngress('authz-bad-princ');
    const env = validIntent({
      tenantId,
      principalId: 'someone-else',
      idempotencyKey: uniqueIdempotencyKey('itest-bad-princ'),
    });
    // Rebuild without override so the envelope claims a different principal
    // than `principalId` registered with the ingress instance.
    void principalId;
    const out = await ingress.submitIntentRaw(env);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.status).toBe(403);
      expect(out.failure.code).toBe('UNAUTHORIZED');
    }
    await ingress.close();
  });
});
