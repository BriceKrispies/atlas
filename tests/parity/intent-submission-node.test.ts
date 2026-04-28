import { describe, test, expect } from 'vitest';
import { makeServerIngress } from './lib/server-factory.ts';
import {
  intentWithUnknownAction,
  intentWithUnknownSchema,
  intentWithSchemaMismatch,
  uniqueIdempotencyKey,
  validIntent,
} from './lib/intent-fixtures.ts';

const baseUrl = process.env['NODE_PARITY_BASE_URL'];
const d = baseUrl ? describe : describe.skip;

d('[node] intent_submission parity', () => {
  test('test_submit_valid_intent_returns_event', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('isub-ok');
    const env = validIntent({
      tenantId,
      principalId,
      idempotencyKey: uniqueIdempotencyKey('itest-ok'),
    });
    const r = await ingress.submitIntent(env);
    expect(r.eventId.length).toBeGreaterThan(0);
    expect(r.tenantId).toBe(tenantId);
    await ingress.close();
  });

  test('test_submit_intent_with_invalid_schema_returns_error', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('isub-bad-schema');
    const env = intentWithUnknownSchema({ tenantId, principalId });
    const out = await ingress.submitIntentRaw(env);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.status).toBe(400);
      expect(out.failure.code).toBe('UNKNOWN_SCHEMA');
    }
    await ingress.close();
  });

  test('test_submit_intent_with_schema_mismatch_returns_error', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('isub-mismatch');
    const env = intentWithSchemaMismatch({ tenantId, principalId });
    const out = await ingress.submitIntentRaw(env);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.status).toBe(400);
      expect(out.failure.code).toBe('SCHEMA_VALIDATION_FAILED');
    }
    await ingress.close();
  });

  test('test_submit_intent_with_unknown_action_returns_error', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('isub-bad-action');
    const env = intentWithUnknownAction({ tenantId, principalId });
    const out = await ingress.submitIntentRaw(env);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.status).toBe(400);
      expect(['UNKNOWN_ACTION', 'SCHEMA_VALIDATION_FAILED']).toContain(out.failure.code);
    }
    await ingress.close();
  });

  test('test_multiple_valid_intents_succeed', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('isub-multi');
    for (let i = 0; i < 5; i++) {
      const env = validIntent({
        tenantId,
        principalId,
        idempotencyKey: uniqueIdempotencyKey(`itest-multi-${i}`),
      });
      const r = await ingress.submitIntent(env);
      expect(r.eventId.length).toBeGreaterThan(0);
    }
    await ingress.close();
  });

  test('test_submit_intent_response_carries_tenant_id', async () => {
    const { ingress, tenantId, principalId } = await makeServerIngress('isub-tenant');
    const env = validIntent({
      tenantId,
      principalId,
      idempotencyKey: uniqueIdempotencyKey('itest-tenant'),
    });
    const r = await ingress.submitIntent(env);
    expect(r.tenantId).toBe(tenantId);
    expect(r.principalId).toBe(principalId);
    await ingress.close();
  });
});
