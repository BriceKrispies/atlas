import type {
  PolicyDecision,
  PolicyEngine,
  PolicyEvaluationRequest,
} from '@atlas/ports';

/**
 * Allow-all-with-tenant-scope policy engine.
 *
 * Used as the default in dev / sim mode and behind `apps/server` until the
 * Cedar adapter (Chunk 6b) is wired. Returns `permit` whenever
 * `principal.tenantId === resource.tenantId`, `deny` otherwise.
 *
 * The deny path is defensive: ingress already enforces tenant scope at
 * step 2 of the middleware (`TENANT_MISMATCH`), so under normal flow this
 * engine never sees a mismatched request. Real engines (Cedar) inspect
 * action + resource type + attributes; this stub deliberately does not, so
 * tests against it can assert the tenant-scope path without policy noise.
 */
export class StubPolicyEngine implements PolicyEngine {
  async evaluate(request: PolicyEvaluationRequest): Promise<PolicyDecision> {
    // Input validation — every adapter must reject obviously malformed
    // requests so callers can't silently smuggle through "" tenant ids.
    if (!request.principal.id) {
      throw new Error('PolicyEngine: principal.id must be non-empty');
    }
    if (!request.principal.tenantId) {
      throw new Error('PolicyEngine: principal.tenantId must be non-empty');
    }
    if (!request.resource.tenantId) {
      throw new Error('PolicyEngine: resource.tenantId must be non-empty');
    }

    if (request.principal.tenantId !== request.resource.tenantId) {
      return {
        effect: 'deny',
        reasons: ['stub: tenant mismatch'],
      };
    }
    return {
      effect: 'permit',
      reasons: ['stub: tenant-scope ok'],
    };
  }
}
