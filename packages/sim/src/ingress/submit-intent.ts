import type { Db } from '../ports/db.ts';
import type { EventStorePort } from '../ports/event-store.ts';
import type { CachePort } from '../ports/cache.ts';
import type { ProjectionStorePort } from '../ports/projection-store.ts';
import type { SearchEnginePort } from '../ports/search-engine.ts';
import type { ControlPlaneRegistryPort } from '../ports/control-plane-registry.ts';
import type { IntentEnvelope, IntentResponse, EventEnvelope } from '../types.ts';
import { IngressError } from '../types.ts';
import { handleSeedPackageApply } from '../domain/catalog/handlers/seed-package-apply.ts';
import { handleFamilyPublish } from '../domain/catalog/handlers/family-publish.ts';
import { dispatchEvent, type ProjectionContext } from '../worker/projection-loop.ts';
import { newEventId } from '../domain/catalog/ids.ts';
import type { SeedPayload } from '../domain/catalog/seed-types.ts';

export interface IngressState {
  db: Db;
  tenantId: string;
  principalId: string;
  eventStore: EventStorePort;
  cache: CachePort;
  projections: ProjectionStorePort;
  search: SearchEnginePort;
  registry: ControlPlaneRegistryPort;
}

function err(code: string, message: string, status: number, correlationId: string): never {
  throw new IngressError(code, message, status, correlationId);
}

export async function submitIntent(
  state: IngressState,
  envelope: IntentEnvelope,
): Promise<IntentResponse> {
  const correlationId = envelope.correlationId || 'unknown';

  // 1. Authn — preconfigured principal; reject if envelope tries to claim a different one.
  if (envelope.principalId && envelope.principalId !== state.principalId) {
    err('UNAUTHORIZED', 'principal mismatch', 401, correlationId);
  }

  // 2. Tenant scope
  if (envelope.tenantId !== state.tenantId) {
    err('TENANT_MISMATCH', 'tenant scope mismatch', 403, correlationId);
  }

  // 3. Schema validation
  const validator = state.registry.getSchemaValidator(envelope.schemaId, envelope.schemaVersion);
  if (!validator) {
    err(
      'SCHEMA_NOT_FOUND',
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
    err('IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey is required', 400, correlationId);
  }

  // 5. Action lookup
  const actionId = envelope.payload.actionId;
  const action = state.registry.getAction(actionId);
  if (!action) {
    err('UNKNOWN_ACTION', `unknown action: ${actionId}`, 400, correlationId);
  }

  // 6. Authz (stub: allow-all)

  // 7. Handler dispatch
  const ctx: ProjectionContext = {
    db: state.db,
    projections: state.projections,
    search: state.search,
    cache: state.cache,
  };

  let storedEvent: EventEnvelope;
  if (actionId === 'Catalog.SeedPackage.Apply') {
    const result = await handleSeedPackageApply(
      {
        tenantId: state.tenantId,
        correlationId,
        principalId: state.principalId,
        seedPackageKey: envelope.payload['seedPackageKey'] as string,
        seedPackageVersion: envelope.payload['seedPackageVersion'] as string,
        payload: envelope.payload['payload'] as SeedPayload,
      },
      state.db,
      state.eventStore,
    );
    storedEvent = result.envelope;
  } else if (actionId === 'Catalog.Family.Publish') {
    const result = await handleFamilyPublish(
      {
        tenantId: state.tenantId,
        correlationId,
        principalId: state.principalId,
        familyKey: envelope.payload['familyKey'] as string,
        familyRevisionNumber: envelope.payload['familyRevisionNumber'] as number,
      },
      state.db,
      state.eventStore,
    );
    // Dispatch family event then variant events.
    await dispatchEvent(result.familyEnvelope, ctx);
    for (const v of result.variantEnvelopes) {
      await dispatchEvent(v, ctx);
    }
    return {
      eventId: result.familyEnvelope.eventId,
      tenantId: state.tenantId,
      principalId: state.principalId,
    };
  } else {
    // Generic fall-through: just append envelope to event store.
    const generic: EventEnvelope = {
      eventId: envelope.eventId ?? newEventId(),
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
    storedEvent = generic;
  }

  await dispatchEvent(storedEvent, ctx);

  return {
    eventId: storedEvent.eventId,
    tenantId: state.tenantId,
    principalId: state.principalId,
  };
}
