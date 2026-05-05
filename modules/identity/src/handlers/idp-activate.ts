import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { IdentityProviderDocument } from '../types.ts';
import { newEventId } from '../ids.ts';
import { getIdentityProviderEntity } from '../entities/identity-provider.ts';

export interface IdpActivateCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  idpId: string;
}

export interface IdpActivateResult {
  envelope: EventEnvelope;
  document: IdentityProviderDocument;
}

/**
 * `Identity.IdentityProvider.Activate` handler.
 *
 * Flips status from `'configured'` (or `'disabled'`) to `'active'`.
 * Activating from `'configured'` is the standard onboarding flow;
 * activating from `'disabled'` is a re-enable after a temporary
 * disable.
 */
export async function handleIdpActivate(
  cmd: IdpActivateCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<IdpActivateResult> {
  const existing = await getIdentityProviderEntity(
    entities,
    cmd.tenantId,
    cmd.idpId,
  );
  if (!existing) {
    throw new IdentityError(
      codes.IDP_NOT_FOUND,
      `identity provider not found: ${cmd.idpId}`,
      404,
    );
  }
  if (existing.status === 'active') {
    return {
      envelope: synthesizeNoopEvent(cmd, existing),
      document: existing,
    };
  }
  const occurredAt = new Date().toISOString();
  const document: IdentityProviderDocument = {
    ...existing,
    status: 'active',
    activatedAt: occurredAt,
    updatedAt: occurredAt,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.IdentityProviderActivated',
    schemaId: 'domain.identity.idp.activated.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.idp.activate.${cmd.idpId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `IdentityProvider:${cmd.idpId}`,
    ],
    payload: { document },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document };
}

/**
 * No-op event for the already-active idempotent path. The intent
 * pipeline expects a primary envelope; the dispatcher's
 * HANDLED_EVENT_TYPES set excludes `…NoOp` so it's ignored
 * downstream.
 */
function synthesizeNoopEvent(
  cmd: IdpActivateCommand,
  doc: IdentityProviderDocument,
): EventEnvelope {
  return {
    eventId: newEventId(),
    eventType: 'Identity.IdentityProviderActivated.NoOp',
    schemaId: 'domain.identity.idp.activated.noop.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.idp.activate-noop.${cmd.idpId}.${Date.now()}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`],
    payload: { idpId: doc.idpId, alreadyActive: true },
  };
}
