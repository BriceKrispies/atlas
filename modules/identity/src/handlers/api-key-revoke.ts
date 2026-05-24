import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { ApiKeyDocument } from '../types.ts';
import { newEventId } from '../ids.ts';
import { getApiKeyEntity } from '../entities/api-key.ts';

export interface ApiKeyRevokeCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  keyId: string;
}

export interface ApiKeyRevokeResult {
  envelope: EventEnvelope;
  document: ApiKeyDocument;
}

export async function handleApiKeyRevoke(
  cmd: ApiKeyRevokeCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<ApiKeyRevokeResult> {
  const existing = await getApiKeyEntity(entities, cmd.tenantId, cmd.keyId);
  if (!existing) {
    throw new IdentityError(
      codes.API_KEY_NOT_FOUND,
      `api key not found: ${cmd.keyId}`,
      404,
    );
  }
  const occurredAt = new Date().toISOString();
  const revoked: ApiKeyDocument = {
    ...existing,
    status: 'revoked',
    endedAt: occurredAt,
    endReason: 'admin_revoke',
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.ApiKeyRevoked',
    schemaId: 'domain.identity.api_key.revoked.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.api-key.revoke.${cmd.keyId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    // Subject is the revoked key's OWNER, not the actor who revoked it.
    // SP-owned keys have no User subject → null.
    userId: revoked.userId ?? null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `ApiKey:${cmd.keyId}`],
    payload: { document: revoked },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document: revoked };
}
