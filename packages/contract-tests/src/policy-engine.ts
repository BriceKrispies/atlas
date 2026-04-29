import { describe, test, expect, beforeEach } from 'vitest';
import type {
  PolicyEngine,
  PolicyEvaluationRequest,
} from '@atlas/ports';

interface MakeRequestOptions {
  principalId?: string;
  principalTenant?: string;
  principalAttributes?: Record<string, unknown>;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  resourceTenant?: string;
  resourceAttributes?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

function makeRequest(opts: MakeRequestOptions = {}): PolicyEvaluationRequest {
  const principalTenant = opts.principalTenant ?? 'tenant-a';
  const resourceTenant = opts.resourceTenant ?? principalTenant;
  return {
    principal: {
      id: opts.principalId ?? 'user:test',
      tenantId: principalTenant,
      attributes: opts.principalAttributes ?? {},
    },
    action: opts.action ?? 'Catalog.Family.Publish',
    resource: {
      type: opts.resourceType ?? 'Family',
      id: opts.resourceId ?? 'fam-1',
      tenantId: resourceTenant,
      attributes: opts.resourceAttributes ?? {},
    },
    ...(opts.context !== undefined ? { context: opts.context } : {}),
  };
}

/**
 * Contract suite for `PolicyEngine` adapters.
 *
 * Every adapter (stub, Cedar, future rule-based) must pass this suite. The
 * suite focuses on shape + the universally-true semantics:
 *
 * - tenant-scope: cross-tenant requests deny.
 * - decision shape: `effect` is required, `reasons` and `matchedPolicies`
 *   are optional but typed as arrays when present.
 * - input validation: empty principal id / empty tenant id are rejected.
 * - concurrency: parallel `evaluate` calls return consistent results.
 *
 * Adapter-specific semantics (Cedar's forbid-overrides, attribute-based
 * matching, schema validation) live in adapter-local tests; the
 * `describe.skip(...)` blocks below sketch the shape Cedar must satisfy.
 */
export function policyEngineContract(makeEngine: () => Promise<PolicyEngine>): void {
  describe('PolicyEngine contract', () => {
    let engine: PolicyEngine;
    beforeEach(async () => {
      engine = await makeEngine();
    });

    test('permit when principal.tenantId === resource.tenantId', async () => {
      const decision = await engine.evaluate(
        makeRequest({ principalTenant: 'tenant-a', resourceTenant: 'tenant-a' }),
      );
      expect(decision.effect).toBe('permit');
    });

    test('deny when principal.tenantId !== resource.tenantId', async () => {
      const decision = await engine.evaluate(
        makeRequest({ principalTenant: 'tenant-a', resourceTenant: 'tenant-b' }),
      );
      expect(decision.effect).toBe('deny');
    });

    test('decision shape: effect is "permit" or "deny"', async () => {
      const decision = await engine.evaluate(makeRequest());
      expect(['permit', 'deny']).toContain(decision.effect);
    });

    test('decision shape: reasons (when present) is an array of strings', async () => {
      const decision = await engine.evaluate(makeRequest());
      if (decision.reasons !== undefined) {
        expect(Array.isArray(decision.reasons)).toBe(true);
        for (const r of decision.reasons) {
          expect(typeof r).toBe('string');
        }
      }
    });

    test('decision shape: matchedPolicies (when present) is an array of strings', async () => {
      const decision = await engine.evaluate(makeRequest());
      if (decision.matchedPolicies !== undefined) {
        expect(Array.isArray(decision.matchedPolicies)).toBe(true);
        for (const p of decision.matchedPolicies) {
          expect(typeof p).toBe('string');
        }
      }
    });

    test('deny reason explains the deny (non-empty when reasons provided)', async () => {
      const decision = await engine.evaluate(
        makeRequest({ principalTenant: 'tenant-a', resourceTenant: 'tenant-b' }),
      );
      expect(decision.effect).toBe('deny');
      if (decision.reasons !== undefined) {
        expect(decision.reasons.length).toBeGreaterThan(0);
        expect(decision.reasons[0]!.length).toBeGreaterThan(0);
      }
    });

    test('different action-resource pairs yield decisions of consistent shape', async () => {
      // Real engines must differentiate (e.g. one action permitted, another
      // denied). The stub does not — it ignores action/resource and only
      // checks tenant scope. So we only assert the shape contract here, and
      // leave the differentiation contract to adapter-specific suites.
      const a = await engine.evaluate(
        makeRequest({ action: 'Catalog.Family.Publish', resourceType: 'Family' }),
      );
      const b = await engine.evaluate(
        makeRequest({ action: 'Catalog.Variant.Archive', resourceType: 'Variant' }),
      );
      expect(['permit', 'deny']).toContain(a.effect);
      expect(['permit', 'deny']).toContain(b.effect);
    });

    test('rejects empty principal id', async () => {
      await expect(
        engine.evaluate(makeRequest({ principalId: '' })),
      ).rejects.toThrow();
    });

    test('rejects empty principal.tenantId', async () => {
      await expect(
        engine.evaluate(makeRequest({ principalTenant: '' })),
      ).rejects.toThrow();
    });

    test('rejects empty resource.tenantId', async () => {
      await expect(
        engine.evaluate(
          makeRequest({ principalTenant: 'tenant-a', resourceTenant: '' }),
        ),
      ).rejects.toThrow();
    });

    test('context field is accepted (and at minimum does not change permit on tenant match)', async () => {
      const decision = await engine.evaluate(
        makeRequest({
          principalTenant: 'tenant-a',
          resourceTenant: 'tenant-a',
          context: { correlationId: 'corr-123', ip: '127.0.0.1' },
        }),
      );
      expect(decision.effect).toBe('permit');
    });

    test('attribute-based requests return a well-formed decision', async () => {
      // The stub ignores attributes; we only assert shape. Cedar's adapter
      // tests will assert real attribute-driven permit/deny outcomes.
      const decision = await engine.evaluate(
        makeRequest({
          principalAttributes: { department: 'eng', mfa: true },
          resourceAttributes: { ownerId: 'user:test', sensitivity: 'low' },
        }),
      );
      expect(['permit', 'deny']).toContain(decision.effect);
    });

    test('[concurrency] 10 parallel evaluate calls return consistent results', async () => {
      const requests = Array.from({ length: 10 }, (_, i) =>
        makeRequest({
          principalId: `user:concurrent-${i}`,
          principalTenant: 'tenant-c',
          resourceTenant: 'tenant-c',
          resourceId: `res-${i}`,
        }),
      );
      const decisions = await Promise.all(requests.map((r) => engine.evaluate(r)));
      expect(decisions).toHaveLength(10);
      for (const d of decisions) {
        expect(d.effect).toBe('permit');
      }
    });

    test('[concurrency] mixed permit/deny parallel calls do not interleave incorrectly', async () => {
      const ops: Promise<{ effect: string; expected: string }>[] = [];
      for (let i = 0; i < 5; i++) {
        ops.push(
          engine
            .evaluate(makeRequest({ principalTenant: 'tenant-x', resourceTenant: 'tenant-x' }))
            .then((d) => ({ effect: d.effect, expected: 'permit' })),
        );
        ops.push(
          engine
            .evaluate(makeRequest({ principalTenant: 'tenant-x', resourceTenant: 'tenant-y' }))
            .then((d) => ({ effect: d.effect, expected: 'deny' })),
        );
      }
      const results = await Promise.all(ops);
      for (const r of results) {
        expect(r.effect).toBe(r.expected);
      }
    });

    // -----------------------------------------------------------------
    // Real-engine-only scenarios. The stub does not inspect action,
    // resource, or attributes; Cedar must. The Cedar adapter's real
    // assertions live in
    // `packages/adapters-policy-cedar/test/cedar-policy-engine.test.ts`
    // (forbid-overrides, attribute-based permit/deny, matched-policies).
    // We keep `describe.skip` here so the contract surface still
    // documents the expectation without forcing every adapter to satisfy
    // it inline.
    // -----------------------------------------------------------------
    describe.skip('real engine semantics (Cedar — see cedar adapter test)', () => {
      test('forbid overrides permit (Invariant I4: deny-overrides-allow)', async () => {
        // When a tenant has both a `permit` and a `forbid` rule that match
        // the same request, the decision must be `deny`.
      });

      test('attribute-based: principal.department === resource.department permits', async () => {
        // A policy keyed on principal attributes resolves against the
        // request envelope's attribute map.
      });

      test('matchedPolicies returns policy ids that contributed to the decision', async () => {
        // Real adapters expose policy ids; stub returns undefined.
      });

      test('different actions produce different decisions for the same principal/resource', async () => {
        // e.g. Catalog.Family.Read permits, Catalog.Family.Delete denies.
      });
    });
  });
}
