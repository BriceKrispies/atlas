import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  InviteTokenDocument,
  MembershipDocument,
  UserDocument,
} from '../types.ts';
import { newEventId, newMembershipId, newUserId } from '../ids.ts';
import {
  constantTimeEqual,
  hashSecret,
  lookupOf,
} from '../crypto/secret-hash.ts';
import { findInviteTokensByLookup } from '../entities/invite-token.ts';
import { findUserByEmail } from '../entities/user.ts';

export interface InviteAcceptCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  /** Plaintext token presented by the invitee. */
  presentedToken: string;
  /** Optional IDP subject to bind to the User on first login. */
  primaryIdpSubject?: string | null;
  givenName?: string;
  familyName?: string;
}

export interface InviteAcceptResult {
  /** Primary event: InviteAccepted. */
  envelope: EventEnvelope;
  follow: ReadonlyArray<EventEnvelope>;
  /** The User this invite resolved to (existing or just-minted). */
  user: UserDocument;
  /** The Membership minted by accepting. */
  membership: MembershipDocument;
}

/**
 * `Identity.Invite.Accept` handler.
 *
 * Resolves a presented plaintext token to a pending InviteToken,
 * verifies the hash in constant time, expires lapsed tokens, and emits
 * three events:
 *
 *   1. (optional follow) `Identity.UserCreated` — when no User exists
 *      for this email yet.
 *   2. (optional follow) `Identity.MembershipCreated` — couples the
 *      User to the inviting tenant with the invite's roles.
 *   3. (primary) `Identity.InviteAccepted` — flips the InviteToken to
 *      `accepted` and stamps `acceptedUserId`.
 *
 * The dispatcher applies all three to entities/relations in order.
 */
export async function handleInviteAccept(
  cmd: InviteAcceptCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<InviteAcceptResult> {
  const lookup = lookupOf(cmd.presentedToken);
  const candidates = await findInviteTokensByLookup(
    entities,
    cmd.tenantId,
    lookup,
  );

  // Constant-time compare against every candidate so timing leaks the
  // bucket size at most, not the matched id. Buckets are small by
  // design (lookup carries 32 bits of entropy).
  const presentedHash = hashSecret(cmd.presentedToken);
  let invite: InviteTokenDocument | null = null;
  for (const candidate of candidates) {
    if (constantTimeEqual(candidate.tokenHash, presentedHash)) {
      invite = candidate;
      break;
    }
  }
  if (!invite) {
    throw new IdentityError(
      codes.INVITE_NOT_FOUND,
      'invite not found or already used',
      404,
    );
  }
  if (new Date(invite.expiresAt) < new Date()) {
    throw new IdentityError(
      codes.INVITE_EXPIRED,
      'invite has expired',
      410,
    );
  }
  if (invite.status !== 'pending') {
    throw new IdentityError(
      codes.INVITE_ALREADY_USED,
      `invite is in status ${invite.status}`,
      409,
    );
  }

  const occurredAt = new Date().toISOString();
  const follow: EventEnvelope[] = [];

  // 1. Resolve User: existing by email, or new.
  const existingUser = await findUserByEmail(entities, cmd.tenantId, invite.email);
  let user: UserDocument;
  if (existingUser) {
    user = existingUser;
  } else {
    const userId = newUserId();
    user = {
      userId,
      email: invite.email,
      status: 'active',
      primaryIdpSubject: cmd.primaryIdpSubject ?? null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      ...(cmd.givenName !== undefined ? { givenName: cmd.givenName } : {}),
      ...(cmd.familyName !== undefined ? { familyName: cmd.familyName } : {}),
    };
    const userCreated: EventEnvelope = {
      eventId: newEventId(),
      eventType: 'Identity.UserCreated',
      schemaId: 'domain.identity.user.created.v1',
      schemaVersion: 1,
      occurredAt,
      tenantId: cmd.tenantId,
      correlationId: cmd.correlationId,
      idempotencyKey: `identity.user.create.${userId}`,
      causationId: null,
      principalId: cmd.principalId,
      userId: cmd.principalId,
      cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `User:${userId}`],
      payload: { document: user },
    };
    follow.push(userCreated);
  }

  // 2. Mint the Membership.
  const membership: MembershipDocument = {
    membershipId: newMembershipId(),
    tenantId: cmd.tenantId,
    userId: user.userId,
    roles: [...invite.rolesOnAccept],
    status: 'active',
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  const membershipCreated: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.MembershipCreated',
    schemaId: 'domain.identity.membership.created.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.membership.create.${cmd.tenantId}.${user.userId}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${user.userId}`,
      `Membership:${cmd.tenantId}:${user.userId}`,
    ],
    payload: { document: membership },
  };
  follow.push(membershipCreated);

  // 3. Primary: InviteAccepted (flips the InviteToken status).
  const acceptedInvite: InviteTokenDocument = {
    ...invite,
    status: 'accepted',
    acceptedAt: occurredAt,
    acceptedUserId: user.userId,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.InviteAccepted',
    schemaId: 'domain.identity.invite.accepted.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.invite.accept.${invite.tokenId}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: cmd.principalId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `Invite:${invite.tokenId}`,
      `User:${user.userId}`,
    ],
    payload: { document: acceptedInvite, userId: user.userId },
  };

  // Append in order: follows first (so dispatcher state matches event
  // order), then primary. The intent pipeline appends a stored seq per
  // call so the resulting order in the event log is preserved.
  for (const f of follow) {
    const stored = await eventStore.append(f);
    f.eventId = stored.eventId;
    f.seq = stored.seq;
  }
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  return { envelope, follow, user, membership };
}
