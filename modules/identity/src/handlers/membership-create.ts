import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { MembershipDocument, MembershipStatus } from '../types.ts';
import { newEventId, newMembershipId } from '../ids.ts';
import { getUserEntity } from '../entities/user.ts';
import { getMembershipEntity } from '../entities/membership.ts';

export interface MembershipCreateCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  userId: string;
  roles: string[];
  status?: MembershipStatus;
}

export interface MembershipCreateResult {
  envelope: EventEnvelope;
  document: MembershipDocument;
}

/**
 * `Identity.Membership.Create` handler.
 *
 * Verifies the User exists (in the platform partition), refuses if a
 * Membership already exists for the (tenant, user) pair, and emits a
 * `Identity.MembershipCreated` event. Dispatcher persists the entity
 * and writes the cross-partition `membership.user` edge.
 */
export async function handleMembershipCreate(
  cmd: MembershipCreateCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<MembershipCreateResult> {
  const user = await getUserEntity(entities, cmd.tenantId, cmd.userId);
  if (!user) {
    throw new IdentityError(
      codes.USER_NOT_FOUND,
      `user not found: ${cmd.userId}`,
      404,
    );
  }

  const existing = await getMembershipEntity(entities, cmd.tenantId, cmd.userId);
  if (existing) {
    // Idempotency at the call site: callers that want "create or update
    // roles" should use a future Identity.Membership.Update intent. The
    // create path is strict so race-loser detection at the substrate's
    // PK is meaningful.
    throw new IdentityError(
      codes.MEMBERSHIP_REQUIRED,
      `membership already exists for user ${cmd.userId} in tenant ${cmd.tenantId}`,
      409,
    );
  }

  const occurredAt = new Date().toISOString();
  const document: MembershipDocument = {
    membershipId: newMembershipId(),
    tenantId: cmd.tenantId,
    userId: cmd.userId,
    roles: [...cmd.roles],
    status: cmd.status ?? 'active',
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };

  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.MembershipCreated',
    schemaId: 'domain.identity.membership.created.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.membership.create.${cmd.tenantId}.${cmd.userId}`,
    causationId: null,
    principalId: cmd.principalId,
    // Subject is the User whose Membership is created, not the actor
    // (admin/robot) creating it. `principalId` carries the actor.
    userId: cmd.userId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${cmd.userId}`,
      `Membership:${cmd.tenantId}:${cmd.userId}`,
    ],
    payload: { document },
  };

  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  return { envelope, document };
}
