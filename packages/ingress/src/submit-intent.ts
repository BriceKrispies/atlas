import type { EventEnvelope, IntentEnvelope, IntentResponse } from '@atlas/platform-core';
import { IngressError } from '@atlas/platform-core';
import { intentsSubmittedTotal, policyEvaluationsTotal } from '@atlas/metrics';
import type {
  EventStore,
  Cache,
  ProjectionStore,
  SearchEngine,
  ControlPlaneRegistry,
  CatalogStateStore,
  HandlerRegistry,
  IntentHandlerContext,
  PolicyEngine,
  PolicyDecision,
  PolicyEvaluationRequest,
  EventDispatcher,
} from '@atlas/ports';

// Hook invoked for every event produced by submitIntent (handler-emitted or
// the generic fall-through). The wiring layer plugs in module-specific
// projection rebuilds + cache invalidation here so this package depends on
// no domain modules. The canonical type now lives in `@atlas/ports`
// (`EventDispatcher`); ingress re-exports it so existing imports keep
// working.
export type { EventDispatcher } from '@atlas/ports';

export interface IngressState {
  tenantId: string;
  principalId: string;
  /**
   * Per-request correlation id. Optional because long-lived test fixtures
   * construct `IngressState` once and rely on the envelope-stamped id.
   * When present, callers should prefer it over envelope defaults so cache
   * writes / log lines / error envelopes carry the request-scoped id.
   * Invariant I5 — correlationId propagates through the entire request flow.
   */
  correlationId?: string;
  eventStore: EventStore;
  cache: Cache;
  projections: ProjectionStore;
  search: SearchEngine;
  registry: ControlPlaneRegistry;
  catalogState: CatalogStateStore;
  handlers: HandlerRegistry;
  dispatch: EventDispatcher;
  /**
   * Authorization seam (Invariant I2). Called between schema/idempotency
   * validation and handler dispatch. The default wiring is
   * `StubPolicyEngine` (allow-all + tenant-scope); production wires Cedar
   * via `@atlas/adapters-policy-cedar` (Chunk 6b).
   */
  policyEngine: PolicyEngine;
  /**
   * Audit hook for `StructuredAuthz.PolicyEvaluated` (Chunk 6c). Called
   * on every deny by default, and on permits when `AUDIT_EMIT_PERMITS=true`.
   * The hook is responsible for building + dispatching the audit event
   * (the engine just decides; the wiring layer routes via the existing
   * event pipeline). Optional — adapters that wire neither cedar nor
   * audit may leave this `undefined`.
   *
   * Signature: receives the request + decision; returns void. Errors
   * thrown here MUST NOT block the deny-throw — wrap in try/catch at the
   * call site.
   */
  auditPolicyEvaluated?: (
    request: PolicyEvaluationRequest,
    decision: PolicyDecision,
    context: { correlationId: string; idempotencyKey: string },
  ) => Promise<void> | void;
}

function err(code: string, message: string, status: number, correlationId: string): never {
  throw new IngressError(code, message, status, correlationId);
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function submitIntent(
  state: IngressState,
  envelope: IntentEnvelope,
): Promise<IntentResponse> {
  const correlationId = envelope.correlationId || 'unknown';

  // Counter wiring (Chunk 7.1). One increment per finished intent,
  // labelled by action + decision. `action` defaults to 'unknown' when
  // we throw before action lookup (schema/idempotency/principal/tenant
  // failures). `decision` is `permit` on success, `deny` on the
  // policy-engine deny path, `error` for everything else. The label
  // set is closed-form so cardinality stays bounded — adding a new
  // decision value here means updating dashboards too.
  let observedAction = 'unknown';
  let observedDecision: 'permit' | 'deny' | 'error' = 'error';
  try {
    const result = await submitIntentInner(state, envelope, correlationId, (action, decision) => {
      observedAction = action;
      observedDecision = decision;
    });
    return result;
  } finally {
    try {
      intentsSubmittedTotal().inc({ action: observedAction, decision: observedDecision });
    } catch {
      // Metrics MUST NOT fail the request. A typo'd label or a
      // registration race would normally throw — swallow so the
      // request shape stays unchanged.
    }
  }
}

async function submitIntentInner(
  state: IngressState,
  envelope: IntentEnvelope,
  correlationId: string,
  observe: (action: string, decision: 'permit' | 'deny' | 'error') => void,
): Promise<IntentResponse> {
  // 1. Authn — preconfigured principal; reject if envelope tries to claim a different one.
  // Rust counterpart: AppError::unauthorized() in crates/ingress/src/errors.rs (FORBIDDEN/403).
  if (envelope.principalId && envelope.principalId !== state.principalId) {
    err('UNAUTHORIZED', 'principal mismatch', 403, correlationId);
  }

  // 2. Tenant scope
  if (envelope.tenantId !== state.tenantId) {
    err('TENANT_MISMATCH', 'tenant scope mismatch', 403, correlationId);
  }

  // 3. Schema validation
  const validator = state.registry.getSchemaValidator(envelope.schemaId, envelope.schemaVersion);
  if (!validator) {
    err(
      'UNKNOWN_SCHEMA',
      `schema not found: ${envelope.schemaId} v${envelope.schemaVersion}`,
      400,
      correlationId,
    );
  }
  if (!validator(envelope.payload)) {
    const detail = (validator.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`)
      .join('; ');
    err('SCHEMA_VALIDATION_FAILED', `payload schema validation failed: ${detail}`, 400, correlationId);
  }

  // 4. Idempotency key non-empty
  if (!envelope.idempotencyKey || envelope.idempotencyKey.length === 0) {
    err('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey is required', 400, correlationId);
  }

  // 5. Action lookup
  const actionId = envelope.payload.actionId;
  const action = state.registry.getAction(actionId);
  if (!action) {
    err('UNKNOWN_ACTION', `unknown action: ${actionId}`, 400, correlationId);
  }
  // Action is known and structurally valid — record it for the metrics
  // counter even if a later step throws (so `error` rows still attribute
  // to the right action).
  observe(actionId, 'error');

  // 6. Authz (Invariant I2: must run before handler dispatch / any side
  // effects). The PolicyEngine seam returns permit/deny; deny-overrides
  // semantics live inside the adapter (Invariant I4). Resource and
  // principal attributes are empty in 6a — Chunk 6b populates them via the
  // catalog handler resource-fetch step before this call.
  //
  // `resourceType` MUST be a non-empty string. Schema validation should
  // have already enforced this (every action schema requires it), but if
  // a misconfigured schema lets a malformed payload through, we hard-fail
  // here rather than send empty `resource.type=''` to Cedar — empty type
  // silently sidesteps `resource is X` rules (matching nothing) which
  // could let a `forbid (..., resource is Sensitive)` rule never fire.
  if (
    typeof envelope.payload.resourceType !== 'string' ||
    envelope.payload.resourceType.trim().length === 0
  ) {
    err(
      'SCHEMA_VALIDATION_FAILED',
      'payload.resourceType must be a non-empty string',
      400,
      correlationId,
    );
  }
  const resourceType = envelope.payload.resourceType;
  const resourceId =
    typeof envelope.payload.resourceId === 'string' ? envelope.payload.resourceId : '';
  const evaluationRequest: PolicyEvaluationRequest = {
    principal: {
      id: state.principalId,
      tenantId: state.tenantId,
      attributes: {},
    },
    action: actionId,
    resource: {
      type: resourceType,
      id: resourceId,
      tenantId: state.tenantId,
      attributes: {},
    },
    context: { correlationId },
  };
  const decision = await state.policyEngine.evaluate(evaluationRequest);
  // Bump the policy-evaluation counter regardless of audit emission.
  // Mirrors the Rust `policy_evaluations_total` metric exactly — same
  // label set + decision vocabulary so cross-runtime dashboards stay
  // portable. Wrapped in try/catch so a bad label can never block
  // the request (cardinality protection lives in the metric layer).
  try {
    policyEvaluationsTotal().inc({ decision: decision.effect });
  } catch {
    // Swallow — see comment above.
  }

  // Audit emit (Chunk 6c — `StructuredAuthz.PolicyEvaluated`). Wired
  // via the optional `auditPolicyEvaluated` hook on IngressState so
  // this package doesn't depend on the cedar adapter (Chunk 1
  // port-boundary rule). The hook itself owns the emit decision
  // (deny-by-default, permits opt-in via `AUDIT_EMIT_PERMITS=true`)
  // so the env-var read lives in one place — see
  // `apps/server/src/middleware/state.ts`.
  //
  // Errors from the hook MUST NOT block the deny throw — Invariant I2
  // says no side effects on a denied request, but recording the denial
  // *is* the intended audit side effect, so the throw still wins.
  if (state.auditPolicyEvaluated) {
    try {
      await state.auditPolicyEvaluated(evaluationRequest, decision, {
        correlationId,
        idempotencyKey: envelope.idempotencyKey,
      });
    } catch {
      // Swallow audit-emit errors so a flaky audit pipeline doesn't
      // turn a clean deny into a 500. Audit emitters are expected to
      // log internally; if they don't, the deny still surfaces.
    }
  }

  if (decision.effect === 'deny') {
    // Record the deny BEFORE throwing so the outer finally observes
    // `decision=deny` rather than the default `error`.
    observe(actionId, 'deny');
    // Deliberately opaque user-facing message — matches Rust ingress
    // (`crates/ingress/src/errors.rs` `unauthorized()`) and prevents
    // leaking policy ids, matched-rule reasons, or Cedar AST fragments
    // to a denied principal. Diagnostics (decision.reasons,
    // decision.matchedPolicies) belong in structured audit events
    // (Chunk 6c — `StructuredAuthz.PolicyEvaluated`), not the HTTP body.
    err(
      'UNAUTHORIZED',
      'Not authorized to perform this action',
      403,
      correlationId,
    );
  }

  // 7. Handler dispatch
  const handler = state.handlers.get(actionId);
  if (handler) {
    const handlerCtx: IntentHandlerContext = {
      tenantId: state.tenantId,
      principalId: state.principalId,
      correlationId,
      eventStore: state.eventStore,
      catalogState: state.catalogState,
    };
    const { primary, follow } = await handler.handle(handlerCtx, envelope);
    await state.dispatch(primary);
    for (const ev of follow) {
      await state.dispatch(ev);
    }
    observe(actionId, 'permit');
    return {
      eventId: primary.eventId,
      tenantId: state.tenantId,
      principalId: state.principalId,
    };
  }

  // Generic fall-through: append envelope to event store, dispatch, return.
  const generic: EventEnvelope = {
    eventId: envelope.eventId ?? newId('evt'),
    eventType: envelope.eventType,
    schemaId: envelope.schemaId,
    schemaVersion: envelope.schemaVersion,
    occurredAt: envelope.occurredAt ?? new Date().toISOString(),
    tenantId: envelope.tenantId,
    correlationId,
    idempotencyKey: envelope.idempotencyKey,
    causationId: envelope.causationId ?? null,
    principalId: state.principalId,
    userId: state.principalId,
    cacheInvalidationTags: null,
    payload: envelope.payload,
  };
  const stored = await state.eventStore.append(generic);
  generic.eventId = stored;
  await state.dispatch(generic);

  observe(actionId, 'permit');
  return {
    eventId: generic.eventId,
    tenantId: state.tenantId,
    principalId: state.principalId,
  };
}
