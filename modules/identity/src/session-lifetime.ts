/**
 * Session-lifetime helpers — idle-timeout, hard-timeout, last-seen-at
 * updates. These are pure-ish helpers shared between the route layer
 * (`/identity/session/refresh` enforces the same checks) and the
 * principal middleware (which validates a presented session on every
 * authed request).
 *
 * The Refresh handler ALREADY enforces idle/hard via inlined checks —
 * this module exists for the middleware path where we want to validate
 * a session WITHOUT rotating tokens.
 */

import type { EntityStore } from '@atlas/ports';
import type { AuthSessionDocument, SessionPolicy } from './types.ts';
import { DEFAULT_SESSION_POLICY } from './types.ts';
import { putSessionEntity } from './entities/auth-session.ts';

export type LifetimeCheckResult =
  | { ok: true }
  | { ok: false; reason: 'session_revoked' | 'session_expired' | 'hard_timeout' | 'idle_timeout' };

/**
 * Inspect a session against the policy lifetime caps. Pure — does NOT
 * update `lastSeenAt` or persist anything. Callers that detect a
 * lifetime violation typically follow up with `expireSession()` to
 * record the state flip + emit the `Identity.SessionEnded` audit event.
 */
export function checkSessionLifetime(
  session: AuthSessionDocument,
  policy: SessionPolicy = DEFAULT_SESSION_POLICY,
  now: number = Date.now(),
): LifetimeCheckResult {
  if (session.status === 'revoked') {
    return { ok: false, reason: 'session_revoked' };
  }
  if (session.status === 'expired' || session.status === 'evicted') {
    return { ok: false, reason: 'session_expired' };
  }
  if (new Date(session.hardExpiresAt).getTime() <= now) {
    return { ok: false, reason: 'hard_timeout' };
  }
  const idleCutoff = now - policy.idleTimeoutMinutes * 60 * 1000;
  if (new Date(session.lastSeenAt).getTime() < idleCutoff) {
    return { ok: false, reason: 'idle_timeout' };
  }
  return { ok: true };
}

/**
 * Update `lastSeenAt` on a session row. Called by the principal
 * middleware on every authenticated request that presented a valid
 * session. No event is emitted — the audit log only carries
 * lifecycle transitions, not heartbeats.
 *
 * This is the only path that mutates a session row WITHOUT going
 * through the dispatcher. The trade-off is event-log fidelity vs
 * write amplification: emitting a `SessionTouched` event on every
 * request would 10x the event volume. The cost: a session row's
 * `updatedAt` and `lastSeenAt` aren't reproducible from the event
 * log alone (Invariant I12 caveat — sessions are an explicit
 * exception to "projections are pure functions of events"). The
 * idle-timeout invariant survives anyway because we read live state
 * on every check.
 */
export async function touchSessionLastSeen(
  store: EntityStore,
  session: AuthSessionDocument,
  now: Date = new Date(),
): Promise<AuthSessionDocument> {
  const updated: AuthSessionDocument = {
    ...session,
    lastSeenAt: now.toISOString(),
  };
  await putSessionEntity(store, updated);
  return updated;
}
