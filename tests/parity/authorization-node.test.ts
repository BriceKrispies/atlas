import { describe, test, expect } from 'vitest';
import { makeServerIngress } from './lib/server-factory.ts';
import {
  intentWithMismatchedTenant,
  uniqueIdempotencyKey,
  validIntent,
} from './lib/intent-fixtures.ts';

const baseUrl = process.env['NODE_PARITY_BASE_URL'];
const d = baseUrl ? describe : describe.skip;

d('[node] authorization parity', () => {
  test('test_authorized_action_succeeds', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('authz-ok');
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
    const { ingress, principalId } = await makeServerIngress('authz-bad-tenant');
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
    const { ingress, tenantId } = await makeServerIngress('authz-bad-princ');
    const env = validIntent({
      tenantId,
      principalId: 'someone-else',
      idempotencyKey: uniqueIdempotencyKey('itest-bad-princ'),
    });
    const out = await ingress.submitIntentRaw(env);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.status).toBe(403);
      expect(out.failure.code).toBe('UNAUTHORIZED');
    }
    await ingress.close();
  });
});
