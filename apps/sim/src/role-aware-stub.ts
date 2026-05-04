import type {
  PolicyDecision,
  PolicyEngine,
  PolicyEvaluationRequest,
} from '@atlas/ports';
import { StubPolicyEngine } from '@atlas/adapter-policy-stub';

const VIEWER_PREFIX = 'viewer:';
const MUTATING_VERBS = new Set([
  'Apply',
  'Publish',
  'Create',
  'Update',
  'Delete',
  'Archive',
  'Activate',
]);

/**
 * Sim-only policy engine. Wraps the shared StubPolicyEngine
 * (allow-all-with-tenant-scope) with a role-based deny on mutating actions
 * for principals whose id starts with `viewer:`. This is the smallest
 * delta needed for the I2 (authz denial) BDD scenario without forking the
 * shared stub adapter.
 */
export class RoleAwareStubPolicyEngine implements PolicyEngine {
  private readonly inner = new StubPolicyEngine();

  async evaluate(
    request: PolicyEvaluationRequest,
  ): Promise<PolicyDecision> {
    if (request.principal.id.startsWith(VIEWER_PREFIX)) {
      const verb = request.action.split('.').pop() ?? '';
      if (MUTATING_VERBS.has(verb)) {
        return {
          effect: 'deny',
          reasons: [`sim: viewer role cannot perform ${request.action}`],
        };
      }
    }
    return this.inner.evaluate(request);
  }
}
