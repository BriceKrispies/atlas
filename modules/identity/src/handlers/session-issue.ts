import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import type {
  AuthSessionDocument,
  SessionEndReason,
  SessionPolicy,
} from '../types.ts';
import { DEFAULT_SESSION_POLICY } from '../types.ts';
import { newEventId, newSessionId } from '../ids.ts';
import { generateSecret, hashSecret, lookupOf } from '../crypto/secret-hash.ts';
import { listActiveSessionsForUser } from '../entities/auth-session.ts';
import { IdentityError } from '../errors.ts';

export interface SessionIssueCommand {
  tenantId: string;
  correlationId: string;
  /**
   * Calling principal. Used to enforce that callers may only mint
   * sessions for themselves unless explicitly authorized — without this
   * gate, any authenticated user in a stub-policy environment can mint
   * a session for an arbitrary `userId`. Until policy roles are
   * first-class, the handler fails closed when `principalId !== userId`.
   * Pass `null` only from explicit privileged paths (password-login,
   * invite-accept) where the calling principal is intentionally the
   * unauthenticated front door.
   */
  principalId: string | null;
  /** Whose session this is. Required (no anonymous sessions in A2). */
  userId: string;
  /** Initial IP. Surfaced on the audit event + the AuthSession row. */
  ip?: string;
  userAgent?: string;
  /** Per-tenant session policy. Defaults to `DEFAULT_SESSION_POLICY`. */
  policy?: SessionPolicy;
  /**
   * Access-token TTL override. Defaults to 1 hour. Refresh rotation
   * happens before this if the client is active.
   */
  accessTokenTtlSeconds?: number;
}

export interface SessionIssueResult {
  /** Primary event: SessionIssued. */
  envelope: EventEnvelope;
  /** Follow events: SessionEnded for any sessions evicted by the cap. */
  follow: ReadonlyArray<EventEnvelope>;
  /** The new AuthSession (status='active'). */
  document: AuthSessionDocument;
  /**
   * Plaintext refresh secret. Surfaced ONCE — caller (the route layer)
   * sets it in the HttpOnly cookie alongside the sessionId. Never
   * persisted in the DB or the event log.
   */
  plaintextRefreshToken: string;
  /**
   * Plaintext access secret. Returned in the response body for bearer
   * usage in `Authorization: Bearer atlas_a_<plaintextAccessToken>`.
   * Short-lived (defaults to 1 hour).
   */
  plaintextAccessToken: string;
  /**
   * Convenience: the cookie payload `<sessionId>.<refreshSecret>`.
   * Routes can set this directly on `Set-Cookie: atlas_session=...`.
   */
  cookiePayload: string;
}

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * `Identity.AuthSession.Issue` handler.
 *
 * Mints a new AuthSession + token pair. Enforces the
 * `maxConcurrentSessions` cap by evicting the oldest active session for
 * the user (LRU on `issuedAt`).
 *
 * Returned plaintexts are shown ONCE — events store only hashes.
 */
export async function handleSessionIssue(
  cmd: SessionIssueCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<SessionIssueResult> {
  // Defense-in-depth: even if the policy engine is the stub adapter
  // (allow-all), reject session issuance when the calling principal
  // doesn't match the target user. The unauthenticated front doors
  // (password-login, invite-accept) deliberately pass `principalId:
  // null` because the principal IS the user being authenticated for
  // the first time on this request.
  if (cmd.principalId !== null && cmd.principalId !== cmd.userId) {
    throw new IdentityError(
      'IDENTITY_INVALID',
      'session can only be issued for the calling principal',
      403,
    );
  }
  const policy = cmd.policy ?? DEFAULT_SESSION_POLICY;
  const accessTtl = cmd.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  const occurredAt = new Date().toISOString();
  const now = Date.now();

  // ----- 1. Concurrent-session cap check (evict oldest if at limit) -
  const follow: EventEnvelope[] = [];
  const active = await listActiveSessionsForUser(entities, cmd.tenantId, cmd.userId);
  const overshoot = active.length - (policy.maxConcurrentSessions - 1);
  if (overshoot > 0) {
    // `active` is oldest-first. Evict the front N rows so AFTER the
    // new session lands we're exactly at the cap.
    for (let i = 0; i < overshoot; i += 1) {
      const evicting = active[i];
      if (!evicting) continue;
      const evicted: AuthSessionDocument = {
        ...evicting,
        status: 'evicted',
        endedAt: occurredAt,
        endReason: 'evicted' satisfies SessionEndReason,
      };
      const evictEvent: EventEnvelope = {
        eventId: newEventId(),
        eventType: 'Identity.SessionEnded',
        schemaId: 'domain.identity.session.ended.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `identity.session.evicted.${evicting.sessionId}`,
        causationId: null,
        principalId: cmd.userId,
        userId: cmd.userId,
        cacheInvalidationTags: [
          `Tenant:${cmd.tenantId}`,
          `User:${cmd.userId}`,
          `Session:${evicting.sessionId}`,
        ],
        payload: { document: evicted, reason: 'evicted' },
      };
      follow.push(evictEvent);
    }
  }

  // ----- 2. Mint new session ---------------------------------------
  const sessionId = newSessionId();
  const refreshSecret = generateSecret();
  const accessSecret = generateSecret();
  const refreshTokenHash = hashSecret(refreshSecret);
  const refreshTokenLookup = lookupOf(refreshSecret);
  const accessTokenHash = hashSecret(accessSecret);
  const accessTokenLookup = lookupOf(accessSecret);

  const document: AuthSessionDocument = {
    sessionId,
    tenantId: cmd.tenantId,
    userId: cmd.userId,
    refreshTokenHash,
    refreshTokenLookup,
    accessTokenHash,
    accessTokenLookup,
    accessExpiresAt: new Date(now + accessTtl * 1000).toISOString(),
    issuedAt: occurredAt,
    lastRefreshedAt: occurredAt,
    lastSeenAt: occurredAt,
    hardExpiresAt: new Date(
      now + policy.hardTimeoutHours * 60 * 60 * 1000,
    ).toISOString(),
    status: 'active',
    ...(cmd.ip !== undefined ? { ip: cmd.ip } : {}),
    ...(cmd.userAgent !== undefined ? { userAgent: cmd.userAgent } : {}),
  };

  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.SessionIssued',
    schemaId: 'domain.identity.session.issued.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.session.issue.${sessionId}`,
    causationId: null,
    principalId: cmd.userId,
    userId: cmd.userId,
    cacheInvalidationTags: [
      `Tenant:${cmd.tenantId}`,
      `User:${cmd.userId}`,
      `Session:${sessionId}`,
    ],
    payload: { document },
  };

  // ----- 3. Append events (follow first so dispatch order matches) -
  for (const f of follow) {
    const stored = await eventStore.append(f);
    f.eventId = stored.eventId;
    f.seq = stored.seq;
  }
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  return {
    envelope,
    follow,
    document,
    plaintextRefreshToken: refreshSecret,
    plaintextAccessToken: accessSecret,
    cookiePayload: `${sessionId}.${refreshSecret}`,
  };
}
