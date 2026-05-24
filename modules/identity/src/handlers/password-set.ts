import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { UserDocument } from '../types.ts';
import { newEventId } from '../ids.ts';
import { getUserEntity } from '../entities/user.ts';
import {
  hashPassword,
  validatePasswordComplexity,
} from '../crypto/password.ts';
import { handleSessionRevokeAllForUser } from './session-revoke.ts';

export interface PasswordSetCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  userId: string;
  /** Plaintext, validated against complexity rules then hashed. */
  newPassword: string;
}

export interface PasswordSetResult {
  envelope: EventEnvelope;
  document: UserDocument;
  /**
   * Follow-up envelopes — one `Identity.SessionEnded` per active
   * session the user had at the moment the password changed. Empty
   * when the user had no active sessions. Session-fixation reset:
   * password rotation invalidates every stale cookie/bearer the user
   * (or an attacker who phished the old password) might still hold.
   */
  follow: EventEnvelope[];
  revokedSessionIds: string[];
}

/**
 * `Identity.User.SetPassword` handler.
 *
 * Validates the new password against complexity rules, hashes via
 * Argon2id, and emits `Identity.PasswordChanged` whose payload carries
 * the merged User document (with the new hash, lockout cleared, and
 * failure counter reset). The dispatcher persists.
 *
 * Used both by:
 *   - the user-initiated change-password flow (route checks the OLD
 *     password before calling)
 *   - the password-reset flow (route checks a single-use reset token)
 *   - operator/admin reset (audit-trailed separately)
 */
export async function handlePasswordSet(
  cmd: PasswordSetCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<PasswordSetResult> {
  validatePasswordComplexity(cmd.newPassword);

  const existing = await getUserEntity(entities, cmd.tenantId, cmd.userId);
  if (!existing) {
    throw new IdentityError(
      codes.USER_NOT_FOUND,
      `user not found: ${cmd.userId}`,
      404,
    );
  }

  const passwordHash = await hashPassword(cmd.newPassword);
  const occurredAt = new Date().toISOString();
  const document: UserDocument = {
    ...existing,
    passwordHash,
    failedLoginCount: 0,
    updatedAt: occurredAt,
  };
  // Setting a new password clears the lockout — the assumption is the
  // route layer has already verified ownership (old password / reset
  // token / admin authz). Keeping the lockout would defeat the reset
  // path used for "I forgot my password and got locked out."
  delete (document as { lockedUntil?: string }).lockedUntil;

  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.PasswordChanged',
    schemaId: 'domain.identity.password.changed.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.password.set.${cmd.tenantId}.${cmd.userId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    // Subject is the User whose password changed, not the actor. The actor
    // may be the user themselves, an admin, or the reset flow — all carried
    // in `principalId`. Audit "events about user X" must index this row.
    userId: cmd.userId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `User:${cmd.userId}`],
    payload: { document },
  };

  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  // Session-fixation reset. Any cookie/bearer the user (or a phisher)
  // still holds for a prior session is invalidated by the password
  // change. We pass `reason: 'password_changed'` so the audit trail
  // and risk engine can distinguish this from an admin-initiated revoke.
  const revoke = await handleSessionRevokeAllForUser(
    {
      tenantId: cmd.tenantId,
      correlationId: cmd.correlationId,
      principalId: cmd.principalId,
      userId: cmd.userId,
      reason: 'password_changed',
    },
    eventStore,
    entities,
  );

  return {
    envelope,
    document,
    follow: revoke.envelopes,
    revokedSessionIds: revoke.revokedSessionIds,
  };
}
