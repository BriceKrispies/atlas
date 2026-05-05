import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  AuthFactorDocument,
  IdentityPolicy,
} from '../types.ts';
import { newEventId } from '../ids.ts';
import {
  getAuthFactorEntity,
  listFactorsForUser,
} from '../entities/auth-factor.ts';

export interface FactorRevokeCommand {
  tenantId: string;
  correlationId: string;
  /** Who is performing the revoke (admin or self). */
  principalId: string | null;
  factorId: string;
  /**
   * When `mfaRequired` is true on the tenant and the user has
   * exactly one active factor, revoking that factor would lock the
   * user out. The handler refuses with `MFA_LAST_FACTOR_PROTECTED`
   * unless the caller passes `force: true` (admin-only — typically
   * paired with a `Identity.MfaBypass.Issue` for the user).
   */
  force?: boolean;
  policy?: IdentityPolicy;
}

export interface FactorRevokeResult {
  envelope: EventEnvelope;
  document: AuthFactorDocument;
}

/**
 * `Identity.AuthFactor.Revoke` — flips a factor to `'revoked'` and
 * emits `Identity.AuthFactorRevoked`.
 *
 * Last-factor protection: when `policy.mfaRequired` is true, refuses
 * to revoke the user's only remaining active factor (would lock the
 * user out — they couldn't satisfy the MFA challenge on next login).
 * Admins can pass `force: true` to override (typically paired with a
 * MfaBypass token issued to the user out-of-band).
 */
export async function handleFactorRevoke(
  cmd: FactorRevokeCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<FactorRevokeResult> {
  const factor = await getAuthFactorEntity(entities, cmd.tenantId, cmd.factorId);
  if (!factor) {
    throw new IdentityError(
      codes.MFA_FACTOR_NOT_FOUND,
      `auth factor not found: ${cmd.factorId}`,
      404,
    );
  }
  if (cmd.policy?.mfaRequired && !cmd.force) {
    const allFactors = await listFactorsForUser(
      entities,
      cmd.tenantId,
      factor.userId,
    );
    const otherActive = allFactors.filter(
      (f) => f.factorId !== factor.factorId && f.status === 'active',
    );
    if (otherActive.length === 0 && factor.status === 'active') {
      throw new IdentityError(
        codes.MFA_LAST_FACTOR_PROTECTED,
        `cannot revoke the last active factor while tenant policy requires MFA — enroll a replacement first or pass force=true`,
        409,
      );
    }
  }
  const occurredAt = new Date().toISOString();
  const document: AuthFactorDocument = {
    ...factor,
    status: 'revoked',
    endedAt: occurredAt,
    endReason: cmd.principalId === factor.userId ? 'user_revoke' : 'admin_revoke',
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.AuthFactorRevoked',
    schemaId: 'domain.identity.auth_factor.revoked.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.factor.revoke.${cmd.factorId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: factor.userId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${factor.userId}`,
      `AuthFactor:${cmd.factorId}`,
    ],
    retentionTag: 'retention:1y',
    payload: { document, force: cmd.force ?? false },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document };
}
