import type { EventEnvelope } from '@atlas/platform-core';
import type { EventStore } from '@atlas/ports';
import type { InviteTokenDocument } from '../types.ts';
import { newEventId, newInviteTokenId } from '../ids.ts';
import { generateSecret, hashSecret, lookupOf } from '../crypto/secret-hash.ts';

export interface InviteIssueCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  email: string;
  rolesOnAccept: string[];
  /** Default 7 days. */
  ttlSeconds?: number;
}

export interface InviteIssueResult {
  envelope: EventEnvelope;
  document: InviteTokenDocument;
  /**
   * The plaintext token. Surfaced to the issuing operator EXACTLY ONCE;
   * the route layer must not log or persist it. The hashed form lives in
   * `document.tokenHash`.
   */
  plaintextToken: string;
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * `Identity.Invite.Issue` handler.
 *
 * Mints a high-entropy random secret, hashes it, persists the hashed
 * record, and returns the plaintext to the caller exactly once. The
 * accept handler later verifies a presented secret against `tokenHash`
 * after narrowing candidates by `tokenLookup`.
 */
export async function handleInviteIssue(
  cmd: InviteIssueCommand,
  eventStore: EventStore,
): Promise<InviteIssueResult> {
  const occurredAt = new Date().toISOString();
  const ttl = cmd.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  const plaintextToken = generateSecret();
  const tokenHash = hashSecret(plaintextToken);
  const tokenLookup = lookupOf(plaintextToken);

  const document: InviteTokenDocument = {
    tokenId: newInviteTokenId(),
    tenantId: cmd.tenantId,
    email: cmd.email.toLowerCase(),
    tokenHash,
    tokenLookup,
    rolesOnAccept: [...cmd.rolesOnAccept],
    status: 'pending',
    expiresAt,
    createdAt: occurredAt,
  };

  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.InviteIssued',
    schemaId: 'domain.identity.invite.issued.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.invite.issue.${document.tokenId}`,
    causationId: null,
    principalId: cmd.principalId,
    // No User subject at issue time — the invitee is identified by
    // email only; the User entity is minted on accept. `principalId`
    // is the actor (the robot for system-initiated invites).
    userId: null,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `Invite:${document.tokenId}`,
    ],
    // Note: only the hashed document goes on the event payload. The
    // plaintext is surfaced via the handler return value and never
    // persisted to the event store (Invariant: secrets stay out of
    // event history; events.md retains the rule).
    payload: { document },
  };

  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  return { envelope, document, plaintextToken };
}
