import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  AuthSessionDocument,
  SessionEndReason,
  SessionPolicy,
} from '../types.ts';
import { DEFAULT_SESSION_POLICY } from '../types.ts';
import { newEventId } from '../ids.ts';
import {
  constantTimeEqual,
  generateSecret,
  hashSecret,
  lookupOf,
} from '../crypto/secret-hash.ts';
import {
  getSessionEntity,
  listActiveSessionsForUser,
} from '../entities/auth-session.ts';

export interface SessionRefreshCommand {
  tenantId: string;
  correlationId: string;
  /**
   * The session being refreshed. Pulled from the cookie's
   * `<sessionId>.<refreshSecret>` payload by the route layer.
   */
  sessionId: string;
  /** Plaintext refresh secret presented by the client. */
  presentedRefreshSecret: string;
  ip?: string;
  userAgent?: string;
  policy?: SessionPolicy;
  accessTokenTtlSeconds?: number;
}

export interface SessionRefreshResult {
  /** Primary: SessionRefreshed (success) or SessionAnomaly (reuse). */
  envelope: EventEnvelope;
  /**
   * Follow events on reuse-detection: a SessionEnded for every active
   * session belonging to this user (defensive RevokeAllForUser).
   */
  follow: ReadonlyArray<EventEnvelope>;
  /**
   * On success: the rotated session + new plaintexts.
   * On reuse-detection (the throw path doesn't reach here, but if a
   * future caller does in-band handling): undefined.
   */
  document?: AuthSessionDocument;
  plaintextRefreshToken?: string;
  plaintextAccessToken?: string;
  cookiePayload?: string;
}

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * `Identity.AuthSession.Refresh` handler.
 *
 * Validates the presented refresh secret against the session's current
 * hash; rotates the refresh + access tokens on success. The previous
 * refresh hash lingers in `previousRefreshTokenHash` for
 * `policy.refreshGraceSeconds` so a network blip on the rotation
 * response can be retried.
 *
 * Reuse-detection: a presentation that matches `previousRefreshTokenHash`
 * AFTER the grace window elapsed triggers `RevokeAllForUser` and emits
 * `Identity.SessionAnomaly`. Throws `SESSION_REUSE_DETECTED` (401).
 *
 * Lifetime checks:
 *   - hardExpiresAt < now → flips to 'expired', throws SESSION_HARD_TIMEOUT
 *   - lastSeenAt + idleTimeoutMinutes < now → flips to 'expired', throws SESSION_IDLE_TIMEOUT
 *
 * The non-existent-session path returns SESSION_NOT_FOUND (deliberately
 * NOT reuse-detected — we can't tell if the cookie is stale from a
 * previous successful logout).
 */
export async function handleSessionRefresh(
  cmd: SessionRefreshCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<SessionRefreshResult> {
  const policy = cmd.policy ?? DEFAULT_SESSION_POLICY;
  const accessTtl = cmd.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  const occurredAt = new Date().toISOString();
  const now = Date.now();

  const session = await getSessionEntity(entities, cmd.tenantId, cmd.sessionId);
  if (!session) {
    throw new IdentityError(
      codes.SESSION_NOT_FOUND,
      `session not found: ${cmd.sessionId}`,
      401,
    );
  }
  // Defensive cross-check (see session-revoke for rationale).
  if (session.tenantId !== cmd.tenantId) {
    throw new IdentityError(
      codes.SESSION_NOT_FOUND,
      `session not found: ${cmd.sessionId}`,
      401,
    );
  }
  if (session.status === 'revoked') {
    throw new IdentityError(codes.SESSION_REVOKED, 'session has been revoked', 401);
  }
  if (session.status === 'expired' || session.status === 'evicted') {
    throw new IdentityError(codes.SESSION_EXPIRED, 'session has expired', 401);
  }

  const presentedHash = hashSecret(cmd.presentedRefreshSecret);
  const matchesCurrent = constantTimeEqual(session.refreshTokenHash, presentedHash);
  const matchesPrevious =
    session.previousRefreshTokenHash !== undefined &&
    constantTimeEqual(session.previousRefreshTokenHash, presentedHash);
  // Match against the ring of previously-rotated hashes (older than
  // `previousRefreshTokenHash`). A hit here is unambiguous reuse — the
  // legitimate client has moved past this generation. Constant-time
  // compare against each entry so an attacker can't time-side-channel
  // the ring contents.
  const matchesRevoked =
    !matchesCurrent &&
    !matchesPrevious &&
    (session.revokedRefreshTokenHashes ?? []).some((h) =>
      constantTimeEqual(h, presentedHash),
    );

  if (!matchesCurrent && !matchesPrevious && !matchesRevoked) {
    throw new IdentityError(
      codes.SESSION_NOT_FOUND,
      'refresh token does not match',
      401,
    );
  }

  // ----- Reuse-detection ------------------------------------------
  // Two paths trip reuse-detection:
  //   1. The presented secret matches `previousRefreshTokenHash` AND
  //      we're outside the grace window — a slow attacker.
  //   2. The presented secret matches an entry in
  //      `revokedRefreshTokenHashes` — a stolen original token replayed
  //      after two or more legitimate rotations.
  // Both paths revoke every active session for the user and emit
  // `Identity.SessionAnomaly` so SIEM / risk engine can flag the user.
  if (
    matchesRevoked ||
    (matchesPrevious &&
      !matchesCurrent &&
      now - (session.previousRotatedAt
        ? new Date(session.previousRotatedAt).getTime()
        : 0) >
        policy.refreshGraceSeconds * 1000)
  ) {
      // Defensive: revoke every active session for this user.
      const allSessions = await listActiveSessionsForUser(
        entities,
        cmd.tenantId,
        session.userId,
      );
      const follow: EventEnvelope[] = [];
      for (const s of allSessions) {
        const ended: AuthSessionDocument = {
          ...s,
          status: 'revoked',
          endedAt: occurredAt,
          endReason: 'reuse_detected' satisfies SessionEndReason,
        };
        follow.push({
          eventId: newEventId(),
          eventType: 'Identity.SessionEnded',
          schemaId: 'domain.identity.session.ended.v1',
          schemaVersion: 1,
          occurredAt,
          tenantId: cmd.tenantId,
          correlationId: cmd.correlationId,
          idempotencyKey: `identity.session.reuse-revoke.${s.sessionId}.${occurredAt}`,
          causationId: null,
          principalId: session.userId,
          userId: session.userId,
          cacheInvalidationTags: [
            `Tenant:${cmd.tenantId}`,
            `User:${session.userId}`,
            `Session:${s.sessionId}`,
          ],
          payload: { document: ended, reason: 'reuse_detected' },
        });
      }
      const anomaly: EventEnvelope = {
        eventId: newEventId(),
        eventType: 'Identity.SessionAnomaly',
        schemaId: 'domain.identity.session.anomaly.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `identity.session.anomaly.${session.sessionId}.${occurredAt}`,
        causationId: null,
        principalId: session.userId,
        userId: session.userId,
        cacheInvalidationTags: [
          `Tenant:${cmd.tenantId}`,
          `User:${session.userId}`,
        ],
        payload: {
          sessionId: session.sessionId,
          userId: session.userId,
          reason: 'refresh_token_reuse',
          ...(cmd.ip !== undefined ? { ip: cmd.ip } : {}),
        },
      };
      // Persist follows first, then primary anomaly event.
      for (const f of follow) {
        const stored = await eventStore.append(f);
        f.eventId = stored.eventId;
        f.seq = stored.seq;
      }
      const stored = await eventStore.append(anomaly);
      anomaly.eventId = stored.eventId;
      anomaly.seq = stored.seq;
      // The thrown error surfaces as 401 to the client; the audit
      // events have already landed.
      const error = new IdentityError(
        codes.SESSION_REUSE_DETECTED,
        'refresh token reuse detected; all sessions revoked',
        401,
      );
      // Attach the events so test/integration callers can inspect
      // without re-reading the event store. Untyped escape hatch — the
      // standard route layer just catches the error and returns 401.
      (error as unknown as { events?: EventEnvelope[] }).events = [
        ...follow,
        anomaly,
      ];
      throw error;
  }
  // Otherwise: matchesCurrent, OR matchesPrevious within grace —
  // fall through to rotation. The legitimate post-rotation race
  // (browser fired two refreshes back-to-back) lands in the second
  // case and gets a fresh pair like any normal refresh.

  // ----- Lifetime checks (hard-timeout, idle-timeout) -------------
  if (new Date(session.hardExpiresAt).getTime() <= now) {
    // Hard-timeout: flip to expired and emit SessionEnded so the
    // dispatcher persists the new state. The route returns 401 with
    // SESSION_HARD_TIMEOUT.
    const ended: AuthSessionDocument = {
      ...session,
      status: 'expired',
      endedAt: occurredAt,
      endReason: 'hard_timeout' satisfies SessionEndReason,
    };
    const expireEvent: EventEnvelope = {
      eventId: newEventId(),
      eventType: 'Identity.SessionEnded',
      schemaId: 'domain.identity.session.ended.v1',
      schemaVersion: 1,
      occurredAt,
      tenantId: cmd.tenantId,
      correlationId: cmd.correlationId,
      idempotencyKey: `identity.session.hard-timeout.${session.sessionId}`,
      causationId: null,
      principalId: session.userId,
      userId: session.userId,
      cacheInvalidationTags: [
        `Tenant:${cmd.tenantId}`,
        `User:${session.userId}`,
        `Session:${session.sessionId}`,
      ],
      payload: { document: ended, reason: 'hard_timeout' },
    };
    const stored = await eventStore.append(expireEvent);
    expireEvent.eventId = stored.eventId;
    expireEvent.seq = stored.seq;
    throw new IdentityError(
      codes.SESSION_HARD_TIMEOUT,
      'session has reached its absolute lifetime cap',
      401,
    );
  }
  const idleCutoff = now - policy.idleTimeoutMinutes * 60 * 1000;
  if (new Date(session.lastSeenAt).getTime() < idleCutoff) {
    const ended: AuthSessionDocument = {
      ...session,
      status: 'expired',
      endedAt: occurredAt,
      endReason: 'idle_timeout' satisfies SessionEndReason,
    };
    const expireEvent: EventEnvelope = {
      eventId: newEventId(),
      eventType: 'Identity.SessionEnded',
      schemaId: 'domain.identity.session.ended.v1',
      schemaVersion: 1,
      occurredAt,
      tenantId: cmd.tenantId,
      correlationId: cmd.correlationId,
      idempotencyKey: `identity.session.idle-timeout.${session.sessionId}.${occurredAt}`,
      causationId: null,
      principalId: session.userId,
      userId: session.userId,
      cacheInvalidationTags: [
        `Tenant:${cmd.tenantId}`,
        `User:${session.userId}`,
        `Session:${session.sessionId}`,
      ],
      payload: { document: ended, reason: 'idle_timeout' },
    };
    const stored = await eventStore.append(expireEvent);
    expireEvent.eventId = stored.eventId;
    expireEvent.seq = stored.seq;
    throw new IdentityError(
      codes.SESSION_IDLE_TIMEOUT,
      'session idle-timeout exceeded',
      401,
    );
  }

  // ----- Rotate ---------------------------------------------------
  const newRefreshSecret = generateSecret();
  const newAccessSecret = generateSecret();
  // Promote: current → previous, previous → revoked ring (capped).
  // The ring catches replays of refresh secrets that have already been
  // rotated through the grace window.
  const MAX_REVOKED_REFRESH_HASHES = 16;
  const revoked = [...(session.revokedRefreshTokenHashes ?? [])];
  if (session.previousRefreshTokenHash !== undefined) {
    revoked.push(session.previousRefreshTokenHash);
    if (revoked.length > MAX_REVOKED_REFRESH_HASHES) {
      revoked.splice(0, revoked.length - MAX_REVOKED_REFRESH_HASHES);
    }
  }
  const rotated: AuthSessionDocument = {
    ...session,
    refreshTokenHash: hashSecret(newRefreshSecret),
    refreshTokenLookup: lookupOf(newRefreshSecret),
    previousRefreshTokenHash: session.refreshTokenHash,
    previousRotatedAt: occurredAt,
    revokedRefreshTokenHashes: revoked,
    accessTokenHash: hashSecret(newAccessSecret),
    accessTokenLookup: lookupOf(newAccessSecret),
    accessExpiresAt: new Date(now + accessTtl * 1000).toISOString(),
    lastRefreshedAt: occurredAt,
    lastSeenAt: occurredAt,
    ...(cmd.ip !== undefined ? { ip: cmd.ip } : {}),
    ...(cmd.userAgent !== undefined ? { userAgent: cmd.userAgent } : {}),
  };

  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.SessionRefreshed',
    schemaId: 'domain.identity.session.refreshed.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.session.refresh.${session.sessionId}.${occurredAt}`,
    causationId: null,
    principalId: session.userId,
    userId: session.userId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${session.userId}`,
      `Session:${session.sessionId}`,
    ],
    payload: { document: rotated },
  };

  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  return {
    envelope,
    follow: [],
    document: rotated,
    plaintextRefreshToken: newRefreshSecret,
    plaintextAccessToken: newAccessSecret,
    cookiePayload: `${session.sessionId}.${newRefreshSecret}`,
  };
}
