/**
 * Read-path authz helper.
 *
 * Reads don't go through `submitIntent` because they don't produce
 * events. But they MUST go through the same observability + audit path
 * as writes — otherwise denied reads are invisible in
 * `atlas_policy_evaluations_total{decision='deny'}` and never surface
 * `StructuredAuthz.PolicyEvaluated` audit events. That gap was caught
 * by the Chunk 7 architectural audit; this helper closes it.
 *
 * Callers wire it after building the per-request `IngressState`
 * (the same one `submitIntent` consumes) so the policy engine, audit
 * hook, correlation-id, and tenant scope are all already resolved.
 *
 * On deny, the caller still throws / returns the 403; this helper just
 * runs the side effects (metric + audit) and returns the decision so
 * the caller stays in control of the response shape.
 */

import { policyEvaluationsTotal } from '@atlas/metrics';
import type { PolicyDecision, PolicyEvaluationRequest } from '@atlas/ports';
import type { IngressState } from './submit-intent.ts';

function newReadAuditId(): string {
  return `audit-read-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function evaluateRead(
  request: PolicyEvaluationRequest,
  state: IngressState,
): Promise<PolicyDecision> {
  const decision = await state.policyEngine.evaluate(request);

  // Metric counter — same shape as submitIntent's authz step. Wrapped
  // because metrics MUST NOT fail the request.
  try {
    policyEvaluationsTotal().inc({ decision: decision.effect });
  } catch {
    // Swallow — see comment above.
  }

  // Audit emit. The hook itself decides whether to record (deny by
  // default; permits opt-in via AUDIT_EMIT_PERMITS=true). Errors here
  // MUST NOT block the caller's response — Invariant I2 says no side
  // effects on a denied request, but recording the denial is the
  // intended audit side effect, so the swallow keeps the read path
  // robust against a flaky audit pipeline.
  if (state.auditPolicyEvaluated) {
    try {
      await state.auditPolicyEvaluated(request, decision, {
        correlationId: state.correlationId ?? 'unknown',
        // Each read deny gets a fresh idempotency key so multiple
        // denies aren't deduplicated by the event store's
        // (tenantId, idempotencyKey) unique constraint. Read denies
        // are not retried by clients in any deterministic way, so a
        // synthetic per-call key is the right shape.
        idempotencyKey: newReadAuditId(),
      });
    } catch {
      // Same swallow rule as submitIntent's audit emit.
    }
  }

  return decision;
}
