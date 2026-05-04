import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  AuthSessionDocument,
  SessionEndReason,
} from '../types.ts';
import { newEventId } from '../ids.ts';
import {
  getSessionEntity,
  listActiveSessionsForUser,
} from '../entities/auth-session.ts';

export interface SessionRevokeCommand {
  tenantId: string;
  correlationId: string;
  /** Who is performing the revocation (null for self-logout via cookie). */
  principalId: string | null;
  sessionId: string;
  /** End reason the audit log carries. */
  reason: SessionEndReason;
}

export interface SessionRevokeResult {
  envelope: EventEnvelope;
  document: AuthSessionDocument;
}

/**
 * `Identity.AuthSession.Revoke` handler — terminates a single session.
 *
 * Used by:
 *   - `/identity/session/logout` (self-logout, principalId = userId)
 *   - `Identity.AuthSession.Revoke` admin intent
 *   - `/identity/sessions/<id>` DELETE (self-revoke a specific device)
 *
 * Idempotent — revoking an already-revoked session re-stamps the
 * `endedAt` and re-emits the event. Routes can deduplicate at the HTTP
 * layer if they care; the dispatcher tolerates re-application.
 */
export async function handleSessionRevoke(
  cmd: SessionRevokeCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<SessionRevokeResult> {
  const session = await getSessionEntity(entities, cmd.tenantId, cmd.sessionId);
  if (!session) {
    throw new IdentityError(
      codes.SESSION_NOT_FOUND,
      `session not found: ${cmd.sessionId}`,
      404,
    );
  }
  // Defensive cross-check: the entity-store fetch above is already
  // tenant-scoped, but assert again so any future adapter change that
  // weakens the (tenantId, entityType, entityId) PK can't silently
  // cross-tenant a revoke. Cheap belt-and-suspenders.
  if (session.tenantId !== cmd.tenantId) {
    throw new IdentityError(
      codes.SESSION_NOT_FOUND,
      `session not found: ${cmd.sessionId}`,
      404,
    );
  }
  const occurredAt = new Date().toISOString();
  const ended: AuthSessionDocument = {
    ...session,
    status: 'revoked',
    endedAt: occurredAt,
    endReason: cmd.reason,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.SessionEnded',
    schemaId: 'domain.identity.session.ended.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.session.revoke.${session.sessionId}.${occurredAt}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: session.userId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${session.userId}`,
      `Session:${session.sessionId}`,
    ],
    payload: { document: ended, reason: cmd.reason },
  };
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;
  return { envelope, document: ended };
}

export interface SessionRevokeAllForUserCommand {
  tenantId: string;
  correlationId: string;
  principalId: string | null;
  /** Whose sessions to revoke. */
  userId: string;
  reason: SessionEndReason;
}

export interface SessionRevokeAllForUserResult {
  /**
   * Empty when the user had no active sessions; one envelope per
   * revoked session otherwise. The first envelope is treated as the
   * "primary" by route layers; the rest are follows.
   */
  envelopes: EventEnvelope[];
  revokedSessionIds: string[];
}

/**
 * `Identity.AuthSession.RevokeAllForUser` handler.
 *
 * Used by:
 *   - admin "revoke all sessions" UI
 *   - reuse-detection (defensive) — see session-refresh.ts
 *   - password-changed flow (when policy enforces session revoke on
 *     password change; that wiring is in A2.3 once SetPassword learns
 *     to fire RevokeAllForUser)
 *   - tenant-wide forced re-login (Phase A4 audit policy change)
 */
export async function handleSessionRevokeAllForUser(
  cmd: SessionRevokeAllForUserCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<SessionRevokeAllForUserResult> {
  const sessions = await listActiveSessionsForUser(entities, cmd.tenantId, cmd.userId);
  const occurredAt = new Date().toISOString();
  const envelopes: EventEnvelope[] = [];
  const revokedSessionIds: string[] = [];
  for (const session of sessions) {
    const ended: AuthSessionDocument = {
      ...session,
      status: 'revoked',
      endedAt: occurredAt,
      endReason: cmd.reason,
    };
    const envelope: EventEnvelope = {
      eventId: newEventId(),
      eventType: 'Identity.SessionEnded',
      schemaId: 'domain.identity.session.ended.v1',
      schemaVersion: 1,
      occurredAt,
      tenantId: cmd.tenantId,
      correlationId: cmd.correlationId,
      idempotencyKey: `identity.session.revoke-all.${session.sessionId}.${occurredAt}`,
      causationId: null,
      principalId: cmd.principalId,
      userId: cmd.userId,
      cacheInvalidationTags: [
        `Tenant:${cmd.tenantId}`,
        `User:${cmd.userId}`,
        `Session:${session.sessionId}`,
      ],
      payload: { document: ended, reason: cmd.reason },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    envelopes.push(envelope);
    revokedSessionIds.push(session.sessionId);
  }
  return { envelopes, revokedSessionIds };
}
