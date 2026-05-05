import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { IdentityProviderDocument } from '../types.ts';
import { newEventId } from '../ids.ts';
import { getIdentityProviderEntity } from '../entities/identity-provider.ts';

export interface IdpDisableCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  idpId: string;
}

export interface IdpDisableResult {
  envelope: EventEnvelope;
  document: IdentityProviderDocument;
}

/**
 * `Identity.IdentityProvider.Disable` handler.
 *
 * Flips status to `'disabled'`. New JWT logins from this IDP are
 * rejected; existing AuthSessions live through their natural expiry
 * (sessions are opaque, they don't reference IDP signing keys).
 */
export async function handleIdpDisable(
  cmd: IdpDisableCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<IdpDisableResult> {
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
  const occurredAt = new Date().toISOString();
  const document: IdentityProviderDocument = {
    ...existing,
    status: 'disabled',
    disabledAt: occurredAt,
    ...(cmd.principalId !== null ? { disabledBy: cmd.principalId } : {}),
    updatedAt: occurredAt,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.IdentityProviderDisabled',
    schemaId: 'domain.identity.idp.disabled.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.idp.disable.${cmd.idpId}.${occurredAt}`,
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
