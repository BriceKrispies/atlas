import type { EventEnvelope, IntentEnvelope, IntentResponse } from '@atlas/platform-core';
import { IngressError } from '@atlas/platform-core';
import type {
  EventStore,
  Cache,
  ProjectionStore,
  SearchEngine,
  ControlPlaneRegistry,
  CatalogStateStore,
  HandlerRegistry,
  IntentHandlerContext,
} from '@atlas/ports';

// Hook invoked for every event produced by submitIntent (handler-emitted or
// the generic fall-through). The wiring layer plugs in module-specific
// projection rebuilds + cache invalidation here so this package depends on
// no domain modules.
export type EventDispatcher = (envelope: EventEnvelope) => Promise<void>;

export interface IngressState {
  tenantId: string;
  principalId: string;
  eventStore: EventStore;
  cache: Cache;
  projections: ProjectionStore;
  search: SearchEngine;
  registry: ControlPlaneRegistry;
  catalogState: CatalogStateStore;
  handlers: HandlerRegistry;
  dispatch: EventDispatcher;
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

  // 6. Authz (stub: allow-all)

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

  return {
    eventId: generic.eventId,
    tenantId: state.tenantId,
    principalId: state.principalId,
  };
}
