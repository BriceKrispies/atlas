import type { EventEnvelope } from '@atlas/platform-core';
import type { EventStore } from '@atlas/ports';
import type { UserDocument, UserStatus } from '../types.ts';
import { newEventId, newUserId } from '../ids.ts';

export interface UserCreateCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  /** Optional explicit id (atlasctl bootstrap sets it); generated otherwise. */
  userId?: string;
  email: string;
  primaryIdpSubject?: string | null;
  givenName?: string;
  familyName?: string;
  passwordHash?: string;
  status?: UserStatus;
}

export interface UserCreateResult {
  envelope: EventEnvelope;
  document: UserDocument;
}

/**
 * `Identity.User.Create` handler.
 *
 * Builds the canonical UserDocument and emits a `Identity.UserCreated`
 * event whose payload IS the document. The dispatcher persists it to
 * the request tenant's entity store.
 */
export async function handleUserCreate(
  cmd: UserCreateCommand,
  eventStore: EventStore,
): Promise<UserCreateResult> {
  const occurredAt = new Date().toISOString();
  const userId = cmd.userId ?? newUserId();

  const document: UserDocument = {
    userId,
    email: cmd.email.toLowerCase(),
    status: cmd.status ?? 'active',
    primaryIdpSubject: cmd.primaryIdpSubject ?? null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    ...(cmd.givenName !== undefined ? { givenName: cmd.givenName } : {}),
    ...(cmd.familyName !== undefined ? { familyName: cmd.familyName } : {}),
    ...(cmd.passwordHash !== undefined ? { passwordHash: cmd.passwordHash } : {}),
  };

  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.UserCreated',
    schemaId: 'domain.identity.user.created.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.user.create.${cmd.tenantId}.${userId}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `User:${userId}`],
    payload: { document },
  };

  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  return { envelope, document };
}
