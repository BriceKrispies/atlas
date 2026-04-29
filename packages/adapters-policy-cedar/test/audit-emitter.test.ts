/**
 * Audit-emitter unit tests.
 *
 * Pure helpers — no IO. Verifies the envelope shape matches the
 * `StructuredAuthz.PolicyEvaluated` contract from `specs/crosscut/events.md`
 * and that the deny/permit emission gate honours `AUDIT_EMIT_PERMITS`.
 */

import { describe, expect, test } from 'vitest';
import type { PolicyDecision, PolicyEvaluationRequest } from '@atlas/ports';
import {
  POLICY_EVALUATED_EVENT_TYPE,
  POLICY_EVALUATED_SCHEMA_ID,
  policyEvaluatedEvent,
  shouldEmitPolicyEvaluated,
} from '../src/audit-emitter.ts';

const REQUEST: PolicyEvaluationRequest = {
  principal: { id: 'alice', tenantId: 'tenant-a', attributes: {} },
  action: 'Catalog.Family.Publish',
  resource: { type: 'Family', id: 'fam-1', tenantId: 'tenant-a', attributes: {} },
  context: { correlationId: 'corr-1' },
};

const DENY: PolicyDecision = {
  effect: 'deny',
  reasons: ['cedar: forbid wins'],
  matchedPolicies: ['protected-families'],
};

const PERMIT: PolicyDecision = {
  effect: 'permit',
  reasons: ['cedar: editor permit'],
  matchedPolicies: ['editors-can-publish'],
};

describe('policyEvaluatedEvent', () => {
  test('builds an envelope shaped to the StructuredAuthz contract', () => {
    const env = policyEvaluatedEvent(REQUEST, DENY, {
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      eventId: 'evt-1',
      occurredAt: '2026-04-28T00:00:00.000Z',
      causationId: 'parent-evt-0',
    });
    expect(env.eventId).toBe('evt-1');
    expect(env.eventType).toBe(POLICY_EVALUATED_EVENT_TYPE);
    expect(env.schemaId).toBe(POLICY_EVALUATED_SCHEMA_ID);
    expect(env.schemaVersion).toBe(1);
    expect(env.tenantId).toBe('tenant-a');
    expect(env.correlationId).toBe('corr-1');
    expect(env.idempotencyKey).toBe('idem-1');
    expect(env.causationId).toBe('parent-evt-0');
    expect(env.principalId).toBe('alice');
    expect(env.userId).toBe('alice');
    expect(env.cacheInvalidationTags).toEqual([
      'Tenant:tenant-a',
      'Principal:alice',
    ]);
    const payload = env.payload as Record<string, unknown>;
    expect(payload['decision']).toBe('deny');
    expect(payload['action']).toBe('Catalog.Family.Publish');
    expect(payload['matchedPolicies']).toEqual(['protected-families']);
    expect(payload['reasons']).toEqual(['cedar: forbid wins']);
    expect(payload['resource']).toEqual({ type: 'Family', id: 'fam-1' });
    expect(payload['principalId']).toBe('alice');
  });

  test('defaults occurredAt to now and causationId to null', () => {
    const before = Date.now();
    const env = policyEvaluatedEvent(REQUEST, DENY, {
      correlationId: 'corr-2',
      idempotencyKey: 'idem-2',
      eventId: 'evt-2',
    });
    const after = Date.now();
    const occurred = Date.parse(env.occurredAt);
    expect(occurred).toBeGreaterThanOrEqual(before);
    expect(occurred).toBeLessThanOrEqual(after);
    expect(env.causationId).toBeNull();
  });

  test('handles a permit decision', () => {
    const env = policyEvaluatedEvent(REQUEST, PERMIT, {
      correlationId: 'c',
      idempotencyKey: 'i',
      eventId: 'e',
    });
    expect((env.payload as Record<string, unknown>)['decision']).toBe('permit');
  });

  test('handles missing matchedPolicies / reasons gracefully', () => {
    const minimal: PolicyDecision = { effect: 'deny' };
    const env = policyEvaluatedEvent(REQUEST, minimal, {
      correlationId: 'c',
      idempotencyKey: 'i',
      eventId: 'e',
    });
    const payload = env.payload as Record<string, unknown>;
    expect(payload['matchedPolicies']).toEqual([]);
    expect(payload['reasons']).toEqual([]);
  });
});

describe('shouldEmitPolicyEvaluated', () => {
  test('always emits on deny regardless of env', () => {
    expect(shouldEmitPolicyEvaluated(DENY, {})).toBe(true);
    expect(shouldEmitPolicyEvaluated(DENY, { AUDIT_EMIT_PERMITS: 'true' })).toBe(true);
  });

  test('does not emit on permit by default', () => {
    expect(shouldEmitPolicyEvaluated(PERMIT, {})).toBe(false);
    expect(shouldEmitPolicyEvaluated(PERMIT, { AUDIT_EMIT_PERMITS: 'false' })).toBe(false);
  });

  test('emits on permit when AUDIT_EMIT_PERMITS=true', () => {
    expect(shouldEmitPolicyEvaluated(PERMIT, { AUDIT_EMIT_PERMITS: 'true' })).toBe(true);
  });
});
