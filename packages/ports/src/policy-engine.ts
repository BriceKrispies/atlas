// PolicyEngine port — the seam for tenant-configurable authorization
// (Invariant I2: authorization runs BEFORE execution; Invariant I4:
// deny-overrides-allow). The ingress middleware calls `evaluate` between
// schema/idempotency/action-lookup and handler dispatch. Combination
// semantics (deny-overrides) live inside the adapter; consumers just see a
// single `permit` | `deny` decision plus reasons / matched-policy ids for
// traceability.
//
// Chunk 6a wires this seam with a `StubPolicyEngine` that preserves the
// pre-existing allow-all behaviour (modulo a defensive tenant-scope check).
// Chunk 6b lands `@atlas/adapters-policy-cedar` behind the same interface.

export interface PolicyPrincipal {
  id: string;
  tenantId: string;
  attributes: Record<string, unknown>;
}

export interface PolicyResource {
  type: string;
  id: string;
  tenantId: string;
  attributes: Record<string, unknown>;
}

export interface PolicyEvaluationRequest {
  principal: PolicyPrincipal;
  action: string;
  resource: PolicyResource;
  context?: Record<string, unknown>;
}

export type PolicyEffect = 'permit' | 'deny';

export interface PolicyDecision {
  effect: PolicyEffect;
  reasons?: string[];
  /** Policy ids that contributed to the decision — for traceability/audit. */
  matchedPolicies?: string[];
}

export interface PolicyEngine {
  evaluate(request: PolicyEvaluationRequest): Promise<PolicyDecision>;
}
