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
    userId: cmd.principalId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `User:${cmd.userId}`],
    payload: { document },
  };

  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  return { envelope, document };
}
