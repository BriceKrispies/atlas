import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { ScimTokenDocument } from '../types.ts';
import { newEventId, newScimTokenId } from '../ids.ts';
import { generateSecret, hashSecret, lookupOf } from '../crypto/secret-hash.ts';
import { hashPassword } from '../crypto/password.ts';
import { getScimTokenEntity } from '../entities/scim-token.ts';

const DEFAULT_ROTATION_OVERLAP_HOURS = 24;

export interface ScimTokenEnableCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  name: string;
  expiresAt?: string;
}

export interface ScimTokenEnableResult {
  envelope: EventEnvelope;
  document: ScimTokenDocument;
  /** Plaintext bearer secret. Surfaced ONCE; never persisted. */
  plaintextSecret: string;
}

/**
 * `Identity.ScimToken.Enable` — mints a new SCIM bearer token.
 *
 * Multiple tokens per tenant are allowed (some enterprises run
 * separate connectors per environment). The Rotate handler is
 * preferred over Enable+Revoke for the standard "rotate one token"
 * flow because it preserves the audit lineage.
 */
export async function handleScimTokenEnable(
  cmd: ScimTokenEnableCommand,
  eventStore: EventStore,
): Promise<ScimTokenEnableResult> {
  const occurredAt = new Date().toISOString();
  const tokenId = newScimTokenId();
  const secret = generateSecret();
  const document: ScimTokenDocument = {
    tokenId,
    tenantId: cmd.tenantId,
    secretHash: await hashPassword(secret),
    secretLookup: lookupOf(secret),
    name: cmd.name,
    status: 'active',
    issuedAt: occurredAt,
    ...(cmd.expiresAt !== undefined ? { expiresAt: cmd.expiresAt } : {}),
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.ScimTokenEnabled',
    schemaId: 'domain.identity.scim_token.enabled.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.scim-token.enable.${tokenId}`,
    causationId: null,
    principalId: cmd.principalId,
    // Tenant-scoped SCIM connector credential — no User subject. The actor
    // minting it is in `principalId`.
    userId: null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `ScimToken:${tokenId}`],
    payload: { document },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document, plaintextSecret: secret };
}

export interface ScimTokenRotateCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  tokenId: string;
  /** Hours the predecessor remains valid post-rotation. Default 24. */
  overlapHours?: number;
}

export interface ScimTokenRotateResult {
  envelope: EventEnvelope;
  predecessor: ScimTokenDocument;
  successor: ScimTokenDocument;
  follow: ReadonlyArray<EventEnvelope>;
  /** Plaintext secret of the SUCCESSOR. Shown ONCE. */
  plaintextSecret: string;
}

export async function handleScimTokenRotate(
  cmd: ScimTokenRotateCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<ScimTokenRotateResult> {
  const existing = await getScimTokenEntity(entities, cmd.tenantId, cmd.tokenId);
  if (!existing) {
    throw new IdentityError(
      codes.SCIM_TOKEN_NOT_FOUND,
      `scim token not found: ${cmd.tokenId}`,
      404,
    );
  }
  if (existing.status !== 'active') {
    throw new IdentityError(
      codes.SCIM_TOKEN_REVOKED,
      `scim token ${cmd.tokenId} is in status ${existing.status}`,
      409,
    );
  }
  const occurredAt = new Date().toISOString();
  const overlapHours = cmd.overlapHours ?? DEFAULT_ROTATION_OVERLAP_HOURS;
  const overlapUntil = new Date(
    Date.now() + overlapHours * 60 * 60 * 1000,
  ).toISOString();
  const newTokenId = newScimTokenId();
  const secret = generateSecret();
  const successor: ScimTokenDocument = {
    tokenId: newTokenId,
    tenantId: existing.tenantId,
    secretHash: await hashPassword(secret),
    secretLookup: lookupOf(secret),
    name: existing.name,
    status: 'active',
    issuedAt: occurredAt,
    rotatedFromTokenId: existing.tokenId,
  };
  const flippedPredecessor: ScimTokenDocument = {
    ...existing,
    status: 'rotated',
    rotatedToTokenId: newTokenId,
    rotationOverlapUntil: overlapUntil,
    endedAt: occurredAt,
    endReason: 'rotated',
  };
  const predEvent: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.ScimTokenRotated',
    schemaId: 'domain.identity.scim_token.rotated.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.scim-token.rotate.${cmd.tokenId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    // Tenant-scoped SCIM connector credential — no User subject. The actor
    // rotating it is in `principalId`.
    userId: null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `ScimToken:${cmd.tokenId}`],
    payload: { document: flippedPredecessor },
  };
  const successorEvent: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.ScimTokenEnabled',
    schemaId: 'domain.identity.scim_token.enabled.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.scim-token.enable.${newTokenId}`,
    causationId: null,
    principalId: cmd.principalId,
    // Tenant-scoped SCIM connector credential (successor) — no User subject.
    userId: null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `ScimToken:${newTokenId}`],
    payload: { document: successor },
  };
  const storedPred = await eventStore.append(predEvent);
  predEvent.eventId = storedPred.eventId;
  predEvent.seq = storedPred.seq;
  const storedSucc = await eventStore.append(successorEvent);
  successorEvent.eventId = storedSucc.eventId;
  successorEvent.seq = storedSucc.seq;
  return {
    envelope: predEvent,
    predecessor: flippedPredecessor,
    successor,
    follow: [successorEvent],
    plaintextSecret: secret,
  };
}

export interface ScimTokenRevokeCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  tokenId: string;
}

export interface ScimTokenRevokeResult {
  envelope: EventEnvelope;
  document: ScimTokenDocument;
}

export async function handleScimTokenRevoke(
  cmd: ScimTokenRevokeCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<ScimTokenRevokeResult> {
  const existing = await getScimTokenEntity(entities, cmd.tenantId, cmd.tokenId);
  if (!existing) {
    throw new IdentityError(
      codes.SCIM_TOKEN_NOT_FOUND,
      `scim token not found: ${cmd.tokenId}`,
      404,
    );
  }
  const occurredAt = new Date().toISOString();
  const revoked: ScimTokenDocument = {
    ...existing,
    status: 'revoked',
    endedAt: occurredAt,
    endReason: 'admin_revoke',
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.ScimTokenRevoked',
    schemaId: 'domain.identity.scim_token.revoked.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.scim-token.revoke.${cmd.tokenId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    // Tenant-scoped SCIM connector credential — no User subject. The actor
    // revoking it is in `principalId`.
    userId: null,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `ScimToken:${cmd.tokenId}`],
    payload: { document: revoked },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document: revoked };
}
