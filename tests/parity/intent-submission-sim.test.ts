import { describe, test, expect } from 'vitest';
import { makeSimIngress } from './lib/sim-factory.ts';
import {
  intentWithUnknownAction,
  intentWithUnknownSchema,
  intentWithSchemaMismatch,
  uniqueIdempotencyKey,
  validIntent,
} from './lib/intent-fixtures.ts';

describe('[sim] intent_submission parity', () => {
  test('test_submit_valid_intent_returns_event', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('isub-ok');
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
    const { ingress, tenantId, principalId } = await makeSimIngress('isub-bad-schema');
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
    const { ingress, tenantId, principalId } = await makeSimIngress('isub-mismatch');
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
    const { ingress, tenantId, principalId } = await makeSimIngress('isub-bad-action');
    const env = intentWithUnknownAction({ tenantId, principalId });
    const out = await ingress.submitIntentRaw(env);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.status).toBe(400);
      // Schema for SeedPackage.Apply requires actionId === 'Catalog.SeedPackage.Apply',
      // so the schema validator catches the bogus action before action lookup.
      // Either UNKNOWN_ACTION or SCHEMA_VALIDATION_FAILED is acceptable parity.
      expect(['UNKNOWN_ACTION', 'SCHEMA_VALIDATION_FAILED']).toContain(out.failure.code);
    }
    await ingress.close();
  });

  test('test_multiple_valid_intents_succeed', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('isub-multi');
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
    const { ingress, tenantId, principalId } = await makeSimIngress('isub-tenant');
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
