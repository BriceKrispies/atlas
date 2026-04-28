import { describe, test, expect } from 'vitest';
import { makeSimIngress } from './lib/sim-factory.ts';
import {
  intentWithoutIdempotencyKey,
  uniqueIdempotencyKey,
  validIntent,
} from './lib/intent-fixtures.ts';

describe('[sim] idempotency parity', () => {
  test('test_duplicate_idempotency_key_returns_same_event', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('idem-dup');
    const idem = uniqueIdempotencyKey('itest-dup');
    const env1 = validIntent({ tenantId, principalId, idempotencyKey: idem });
    const env2 = validIntent({ tenantId, principalId, idempotencyKey: idem });

    const r1 = await ingress.submitIntent(env1);
    const r2 = await ingress.submitIntent(env2);
    expect(r1.eventId).toBe(r2.eventId);
    await ingress.close();
  });

  test('test_different_idempotency_keys_create_different_events', async () => {
    // Catalog seed-apply synthesizes its idempotency key from
    // (tenantId, seedPackageKey, seedPackageVersion) so distinct envelope
    // keys alone don't differentiate. To prove "different intents → different
    // events" we bump seedPackageVersion between the two submissions.
    const { ingress, tenantId, principalId } = await makeSimIngress('idem-diff');
    const env1 = validIntent({
      tenantId,
      principalId,
      idempotencyKey: uniqueIdempotencyKey('a'),
      overrides: { payload: { seedPackageVersion: 'v1' } },
    });
    const env2 = validIntent({
      tenantId,
      principalId,
      idempotencyKey: uniqueIdempotencyKey('b'),
      overrides: { payload: { seedPackageVersion: 'v2' } },
    });

    const r1 = await ingress.submitIntent(env1);
    const r2 = await ingress.submitIntent(env2);
    expect(r1.eventId).not.toBe(r2.eventId);
    await ingress.close();
  });

  test('test_idempotency_across_multiple_retries', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('idem-retry');
    const idem = uniqueIdempotencyKey('itest-retries');
    const eventIds: string[] = [];
    for (let i = 0; i < 10; i++) {
      const env = validIntent({ tenantId, principalId, idempotencyKey: idem });
      const r = await ingress.submitIntent(env);
      expect(r.eventId.length).toBeGreaterThan(0);
      eventIds.push(r.eventId);
    }
    const first = eventIds[0]!;
    for (const id of eventIds) {
      expect(id).toBe(first);
    }
    await ingress.close();
  });

  test('test_idempotency_with_different_payload_same_key', async () => {
    // Catalog seed-apply uses synthesized keys so the envelope idempotencyKey
    // doesn't gate replay. Use the seed's own (key, version) tuple as the
    // idempotency proxy: same tuple, regardless of envelope idempotency key,
    // returns the same event. This is the catalog-flavoured equivalent of
    // the Rust suite's "same key, different payload" assertion.
    const { ingress, tenantId, principalId } = await makeSimIngress('idem-same-key');
    const env1 = validIntent({
      tenantId,
      principalId,
      idempotencyKey: uniqueIdempotencyKey('itest-skd-1'),
    });
    const env2 = validIntent({
      tenantId,
      principalId,
      idempotencyKey: uniqueIdempotencyKey('itest-skd-2'),
    });

    const r1 = await ingress.submitIntent(env1);
    const r2 = await ingress.submitIntent(env2);
    expect(r1.eventId).toBe(r2.eventId);
    await ingress.close();
  });

  test('idempotency_key_required_returns_400', async () => {
    const { ingress, tenantId, principalId } = await makeSimIngress('idem-missing');
    const env = intentWithoutIdempotencyKey({ tenantId, principalId });
    const out = await ingress.submitIntentRaw(env);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.failure.status).toBe(400);
      expect(out.failure.code).toBe('INVALID_IDEMPOTENCY_KEY');
    }
    await ingress.close();
  });
});
