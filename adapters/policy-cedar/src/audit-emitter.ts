/**
 * Audit-event helpers for the policy engine.
 *
 * `StructuredAuthz.PolicyEvaluated` is the family of events emitted on
 * every authorization decision the runtime cares to record. Today that's
 * **deny** by default — permits are noise unless an operator opts in via
 * `AUDIT_EMIT_PERMITS=true`. The emitter lives outside the engine so the
 * engine itself stays a pure decision function; the ingress middleware
 * stitches the event onto its existing `state.dispatch` pipeline.
 *
 * Event shape mirrors the spec in `specs/crosscut/events.md` and the
 * Rust counterpart at `crates/runtime/src/audit.rs`.
 *
 * NOTE on schemaId: events the platform stores are normally accompanied
 * by a JSON Schema in `@atlas/schemas`. The audit-event family is
 * platform-emitted (not user-authored) so we ship a stable schemaId
 * (`platform.policy_evaluated.v1`) and let the schemas package register
 * the validator when it lands. Until then, downstream stores accept the
 * event verbatim — the ingress generic dispatcher does not validate
 * platform-emitted events.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { PolicyDecision, PolicyEvaluationRequest } from '@atlas/ports';

/** Schema id for `StructuredAuthz.PolicyEvaluated` events. */
export const POLICY_EVALUATED_SCHEMA_ID = 'platform.policy_evaluated.v1';
export const POLICY_EVALUATED_EVENT_TYPE = 'StructuredAuthz.PolicyEvaluated';

export interface PolicyEvaluatedPayload {
  /** Action being evaluated (e.g. `Catalog.Family.Publish`). */
  action: string;
  /** Permit or deny. Cedar's deny-overrides semantics already collapsed. */
  decision: 'permit' | 'deny';
  /** Policy ids that contributed to the decision (Cedar `diagnostics.reason`). */
  matchedPolicies: string[];
  /** Human-readable reasons surfaced by the engine (audit-only — never user-facing). */
  reasons: string[];
  /** Resource the decision was made about. */
  resource: { type: string; id: string };
  /** Principal the decision was made about. */
  principalId: string;
}

export interface PolicyEvaluatedEventOptions {
  /** Per-request correlation id (Invariant I5 — propagates through the flow). */
  correlationId: string;
  /**
   * Idempotency key from the originating intent envelope. Required because
   * the platform's event store keys by `(idempotencyKey, eventType)`; reusing
   * the originating intent's key keeps deny-on-retry idempotent.
   */
  idempotencyKey: string;
  /**
   * EventId to assign. Caller is expected to mint a fresh one — the audit
   * event is a separate row in the event store from the originating intent.
   */
  eventId: string;
  /** ISO timestamp the decision was reached. Defaults to `new Date().toISOString()`. */
  occurredAt?: string;
  /** Optional causation — typically the originating intent's eventId. */
  causationId?: string | null;
}

/**
 * Build an `EventEnvelope` for a policy decision. Pure helper — the caller
 * (ingress middleware) is responsible for actually dispatching it via
 * `state.dispatch(...)`.
 *
 * Fields the ingress middleware would normally fill in (occurredAt, eventId,
 * idempotencyKey) come in via `opts` so this stays a pure function.
 */
export function policyEvaluatedEvent(
  request: PolicyEvaluationRequest,
  decision: PolicyDecision,
  opts: PolicyEvaluatedEventOptions,
): EventEnvelope {
  const payload: PolicyEvaluatedPayload = {
    action: request.action,
    decision: decision.effect,
    matchedPolicies: decision.matchedPolicies ?? [],
    reasons: decision.reasons ?? [],
    resource: {
      type: request.resource.type,
      id: request.resource.id,
    },
    principalId: request.principal.id,
  };

  return {
    eventId: opts.eventId,
    eventType: POLICY_EVALUATED_EVENT_TYPE,
    schemaId: POLICY_EVALUATED_SCHEMA_ID,
    schemaVersion: 1,
    occurredAt: opts.occurredAt ?? new Date().toISOString(),
    tenantId: request.principal.tenantId,
    correlationId: opts.correlationId,
    idempotencyKey: opts.idempotencyKey,
    causationId: opts.causationId ?? null,
    principalId: request.principal.id,
    userId: request.principal.id,
    // Audit events do NOT invalidate any cache. They're append-only
    // history; nothing reads-through to a tenant-scoped key from them.
    // A previous version included `Tenant:${tenantId}` here; that tag
    // would force the Cedar bundle cache to refresh on every deny once
    // `wirePolicyCacheInvalidation` is hooked into the dispatcher,
    // causing a thrash under sustained denial load (a misconfigured
    // client retrying). Future "events for principal X" admin views
    // should derive their own cache key, not piggy-back on this field.
    cacheInvalidationTags: null,
    payload,
  };
}

/**
 * Returns true iff the runtime should emit a `PolicyEvaluated` event for
 * the given decision. Default policy: deny → emit; permit → emit only
 * when `AUDIT_EMIT_PERMITS=true`. Centralised so the gate is testable
 * and the env-var name has one definition.
 */
export function shouldEmitPolicyEvaluated(
  decision: PolicyDecision,
  env: { AUDIT_EMIT_PERMITS?: string | undefined } = {},
): boolean {
  if (decision.effect === 'deny') return true;
  return env.AUDIT_EMIT_PERMITS === 'true';
}
