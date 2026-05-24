import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { ApiKeyDocument } from '../types.ts';
import { newApiKeyId, newEventId } from '../ids.ts';
import { generateSecret } from '../crypto/secret-hash.ts';
import { hashPassword } from '../crypto/password.ts';
import { getApiKeyEntity } from '../entities/api-key.ts';

export interface ApiKeyRotateCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  keyId: string;
  /**
   * Hours the predecessor key remains valid after rotation. Default 24.
   */
  overlapHours?: number;
}

export interface ApiKeyRotateResult {
  envelope: EventEnvelope;
  /** The newly-minted successor key. */
  successor: ApiKeyDocument;
  /** The predecessor, marked rotated with overlap window set. */
  predecessor: ApiKeyDocument;
  /** Follow event: the predecessor's status flip. */
  follow: ReadonlyArray<EventEnvelope>;
  /** Plaintext bearer for the successor — surfaced ONCE. */
  plaintextBearer: string;
}

const DEFAULT_OVERLAP_HOURS = 24;

/**
 * `Identity.ApiKey.Rotate` handler.
 *
 * Mints a new ApiKey row that points back at the predecessor via
 * `rotatedFromKeyId`. The predecessor flips to `status='rotated'`
 * with `rotationOverlapUntil = now + overlapHours`. Validation for
 * presented bearers accepts either the successor at any time OR the
 * predecessor while still inside the overlap window — see
 * `validateApiKeyBearer` in the principal-middleware path.
 */
export async function handleApiKeyRotate(
  cmd: ApiKeyRotateCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<ApiKeyRotateResult> {
  const predecessor = await getApiKeyEntity(entities, cmd.tenantId, cmd.keyId);
  if (!predecessor) {
    throw new IdentityError(
      codes.API_KEY_NOT_FOUND,
      `api key not found: ${cmd.keyId}`,
      404,
    );
  }
  if (predecessor.status !== 'active') {
    throw new IdentityError(
      codes.API_KEY_REVOKED,
      `api key ${cmd.keyId} is in status ${predecessor.status}`,
      409,
    );
  }

  const occurredAt = new Date().toISOString();
  const overlapHours = cmd.overlapHours ?? DEFAULT_OVERLAP_HOURS;
  const overlapUntil = new Date(
    Date.now() + overlapHours * 60 * 60 * 1000,
  ).toISOString();

  const newKeyId = newApiKeyId();
  const newSecret = generateSecret();
  const newSecretHash = await hashPassword(newSecret);

  const successor: ApiKeyDocument = {
    keyId: newKeyId,
    tenantId: predecessor.tenantId,
    secretHash: newSecretHash,
    name: predecessor.name,
    scopes: [...predecessor.scopes],
    status: 'active',
    issuedAt: occurredAt,
    rotatedFromKeyId: predecessor.keyId,
    ...(predecessor.userId !== undefined ? { userId: predecessor.userId } : {}),
    ...(predecessor.servicePrincipalId !== undefined
      ? { servicePrincipalId: predecessor.servicePrincipalId }
      : {}),
  };
  const flippedPredecessor: ApiKeyDocument = {
    ...predecessor,
    status: 'rotated',
    rotatedToKeyId: newKeyId,
    rotationOverlapUntil: overlapUntil,
    endedAt: occurredAt,
    endReason: 'rotated',
  };

  const successorEvent: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.ApiKeyCreated',
    schemaId: 'domain.identity.api_key.created.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.api-key.create.${newKeyId}`,
    causationId: null,
    principalId: cmd.principalId,
    // Subject is the key's OWNER (carried over from the predecessor), not
    // the actor who rotated it. SP-owned keys have no User subject → null.
    userId: successor.userId ?? null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `ApiKey:${newKeyId}`],
    payload: { document: successor },
  };
  const predEvent: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.ApiKeyRotated',
    schemaId: 'domain.identity.api_key.rotated.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.api-key.rotate.${cmd.keyId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    // Subject is the key's OWNER (the predecessor's owner), not the actor.
    // SP-owned keys have no User subject → null.
    userId: flippedPredecessor.userId ?? null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `ApiKey:${cmd.keyId}`],
    payload: { document: flippedPredecessor },
  };

  // Predecessor's flip is the "primary" — that's what changes existing
  // state. Successor is the follow.
  const stored = await eventStore.append(predEvent);
  predEvent.eventId = stored.eventId;
  predEvent.seq = stored.seq;
  const storedSucc = await eventStore.append(successorEvent);
  successorEvent.eventId = storedSucc.eventId;
  successorEvent.seq = storedSucc.seq;

  return {
    envelope: predEvent,
    follow: [successorEvent],
    successor,
    predecessor: flippedPredecessor,
    plaintextBearer: `atlas_${newKeyId}.${newSecret}`,
  };
}
