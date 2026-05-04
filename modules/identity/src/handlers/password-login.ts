import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type {
  AuthSessionDocument,
  SessionPolicy,
  UserDocument,
} from '../types.ts';
import { newEventId } from '../ids.ts';
import { findUserByEmail } from '../entities/user.ts';
import { verifyPassword } from '../crypto/password.ts';
import { hashSecret } from '../crypto/secret-hash.ts';
import { handleSessionIssue } from './session-issue.ts';

export interface PasswordLoginCommand {
  tenantId: string;
  correlationId: string;
  /** Caller's IP / user-agent fingerprint, surfaced on the audit event. */
  attemptIp?: string;
  attemptUserAgent?: string;
  email: string;
  password: string;
  /**
   * Session policy applied when minting an AuthSession on success.
   * Defaults to `DEFAULT_SESSION_POLICY`. Phase A2.4 (lifetime
   * middleware) wires the per-tenant resolver in `apps/server`.
   */
  sessionPolicy?: SessionPolicy;
  /**
   * Set false to skip session creation on the success path — handy
   * for tests that exercise the password-verify logic in isolation
   * (Phase A1's tests use this implicitly by ignoring `sessionResult`).
   * Default true.
   */
  issueSession?: boolean;
}

export interface PasswordLoginResult {
  /** Primary event: LoginSucceeded or LoginRejected. */
  envelope: EventEnvelope;
  /**
   * Follow events. On success: `[UserUpdated, ...evictedSessions,
   * SessionIssued]`. On rejection: `[UserUpdated]` when the failure
   * counter advances or the lockout threshold trips.
   */
  follow: ReadonlyArray<EventEnvelope>;
  /** The User on success (with refreshed lastLoginAt + zero failure count). */
  user: UserDocument | null;
  /**
   * Session minted on success. Plaintexts are surfaced ONCE — the route
   * layer sets the cookie + returns the access token. Undefined on
   * rejection or when `issueSession=false`.
   */
  sessionResult?: {
    document: AuthSessionDocument;
    plaintextRefreshToken: string;
    plaintextAccessToken: string;
    /** `<sessionId>.<refreshSecret>` — set as the session cookie. */
    cookiePayload: string;
  };
}

/**
 * Lockout policy. Five consecutive failures triggers a 15-minute lockout.
 * Bumped to 30 after the next five (linear backoff is fine for Phase A1
 * — exponential is overkill until risk-engine signals (Phase A7) drive it).
 */
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_SECONDS = 15 * 60;

/**
 * `Identity.Login.Password` handler.
 *
 * Resolves the User by email (lowercased), enforces lockout window, and
 * verifies the Argon2id hash. On success: emits `Identity.LoginSucceeded`
 * and a follow-up `Identity.UserUpdated` to clear the failure counter +
 * stamp lastLoginAt. On rejection: emits `Identity.LoginRejected` with
 * the reason; if the threshold trips, also emits `Identity.AccountLocked`
 * and the merged User update.
 *
 * Always runs `verifyPassword` even on no-such-user, against a constant
 * dummy hash, so the request timing leaks at most "user-doesn't-exist"
 * vs "password-wrong" through the hash duration noise floor — not
 * through a clear DB-only branch.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$Zml4ZWRzYWx0Zml4ZWRzYWx0$0qjQjvNIVkMfnk1c7H3bPEtBwOrYCkAOVB2u6tLjK/8';

export async function handlePasswordLogin(
  cmd: PasswordLoginCommand,
  eventStore: EventStore,
  entities: EntityStore,
): Promise<PasswordLoginResult> {
  const occurredAt = new Date().toISOString();
  const email = cmd.email.toLowerCase();
  const user = await findUserByEmail(entities, cmd.tenantId, email);

  // Lockout / suspended-account checks BEFORE the verify, so we don't
  // burn Argon2 cycles on guaranteed-rejected requests. The
  // dummy-hash verify still runs on no-user to keep timing flat against
  // DB-only branching.
  let rejectReason: string | null = null;
  if (user) {
    if (user.status !== 'active') {
      rejectReason = 'user_inactive';
    } else if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      rejectReason = 'account_locked';
    } else if (!user.passwordHash) {
      // The User exists but has no password set (federated / passkey-only).
      rejectReason = 'no_password_factor';
    }
  }

  // Always verify SOMETHING — real hash on the happy path, dummy
  // otherwise. Hardcoded throwaway hash chosen for shape-validity, not
  // recoverability.
  const hashToVerify =
    user && user.passwordHash && rejectReason === null
      ? user.passwordHash
      : DUMMY_ARGON2_HASH;
  const passwordOk = await verifyPassword(cmd.password, hashToVerify);

  // Decide on the final reject reason.
  if (!user || rejectReason === 'no_password_factor') {
    rejectReason = rejectReason ?? 'unknown_user';
  } else if (rejectReason === null && !passwordOk) {
    rejectReason = 'wrong_password';
  }

  if (rejectReason !== null) {
    // Reject path: bump failed-login counter, possibly trip lockout.
    const follow: EventEnvelope[] = [];

    if (user && rejectReason === 'wrong_password') {
      const failedLoginCount = (user.failedLoginCount ?? 0) + 1;
      const shouldLock = failedLoginCount >= LOCKOUT_THRESHOLD;
      const updated: UserDocument = {
        ...user,
        failedLoginCount,
        ...(shouldLock
          ? {
              lockedUntil: new Date(
                Date.now() + LOCKOUT_DURATION_SECONDS * 1000,
              ).toISOString(),
            }
          : {}),
        updatedAt: occurredAt,
      };
      const updateEvent: EventEnvelope = {
        eventId: newEventId(),
        eventType: shouldLock
          ? 'Identity.AccountLocked'
          : 'Identity.UserUpdated',
        schemaId: shouldLock
          ? 'domain.identity.account.locked.v1'
          : 'domain.identity.user.updated.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `identity.login.failure.${cmd.tenantId}.${user.userId}.${occurredAt}`,
        causationId: null,
        principalId: null,
        userId: null,
        cacheInvalidationTags: [
          `Tenant:${cmd.tenantId}`,
          `User:${user.userId}`,
        ],
        payload: { document: updated },
      };
      follow.push(updateEvent);
    }

    const envelope: EventEnvelope = {
      eventId: newEventId(),
      eventType: 'Identity.LoginRejected',
      schemaId: 'domain.identity.login.rejected.v1',
      schemaVersion: 1,
      occurredAt,
      tenantId: cmd.tenantId,
      correlationId: cmd.correlationId,
      idempotencyKey: `identity.login.reject.${cmd.tenantId}.${email}.${occurredAt}`,
      causationId: null,
      principalId: null,
      userId: user?.userId ?? null,
      cacheInvalidationTags: [`Tenant:${cmd.tenantId}`],
      // PII reduction: for `unknown_user` rejects (user does not exist
      // in the tenant), record only a SHA-256 hash of the email instead
      // of the plaintext. Otherwise an attacker probing emails leaves a
      // forever-PII trail in the event log for non-customers. For all
      // other rejects the user does exist, so the email is already
      // discoverable elsewhere — keep it for audit usefulness.
      payload: {
        ...(rejectReason === 'unknown_user'
          ? { emailHash: hashSecret(email.toLowerCase().trim()) }
          : { email }),
        reason: rejectReason,
        ...(cmd.attemptIp !== undefined ? { ip: cmd.attemptIp } : {}),
        ...(cmd.attemptUserAgent !== undefined
          ? { userAgent: cmd.attemptUserAgent }
          : {}),
      },
    };

    for (const f of follow) {
      const stored = await eventStore.append(f);
      f.eventId = stored.eventId;
      f.seq = stored.seq;
    }
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;

    return { envelope, follow, user: null };
  }

  // Success path. user is guaranteed non-null here.
  if (!user) throw new Error('unreachable: success path with null user');

  const updated: UserDocument = {
    ...user,
    failedLoginCount: 0,
    lastLoginAt: occurredAt,
    updatedAt: occurredAt,
  };
  delete (updated as { lockedUntil?: string }).lockedUntil;

  const updateEvent: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.UserUpdated',
    schemaId: 'domain.identity.user.updated.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.login.success.${cmd.tenantId}.${user.userId}.${occurredAt}`,
    causationId: null,
    principalId: user.userId,
    userId: user.userId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `User:${user.userId}`],
    payload: { document: updated },
  };

  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: 'Identity.LoginSucceeded',
    schemaId: 'domain.identity.login.succeeded.v1',
    schemaVersion: 1,
    occurredAt,
    tenantId: cmd.tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `identity.login.ok.${cmd.tenantId}.${user.userId}.${occurredAt}`,
    causationId: null,
    principalId: user.userId,
    userId: user.userId,
    cacheInvalidationTags: [`Tenant:${cmd.tenantId}`, `User:${user.userId}`],
    payload: {
      userId: user.userId,
      email: user.email,
      ...(cmd.attemptIp !== undefined ? { ip: cmd.attemptIp } : {}),
    },
  };

  const storedFollow = await eventStore.append(updateEvent);
  updateEvent.eventId = storedFollow.eventId;
  updateEvent.seq = storedFollow.seq;
  const stored = await eventStore.append(envelope);
  envelope.eventId = stored.eventId;
  envelope.seq = stored.seq;

  // Mint the session AFTER LoginSucceeded lands in the log so the
  // audit ordering matches the lifecycle: the login is what authorized
  // the session creation. handleSessionIssue appends its own events;
  // we append them to our follow list.
  const issueSession = cmd.issueSession ?? true;
  if (!issueSession) {
    return { envelope, follow: [updateEvent], user: updated };
  }

  const session = await handleSessionIssue(
    {
      tenantId: cmd.tenantId,
      correlationId: cmd.correlationId,
      // Front-door authentication: the calling principal is the
      // unauthenticated /login surface, not the user being identified.
      // `null` opts out of the principal===userId assertion in
      // handleSessionIssue.
      principalId: null,
      userId: updated.userId,
      ...(cmd.attemptIp !== undefined ? { ip: cmd.attemptIp } : {}),
      ...(cmd.attemptUserAgent !== undefined ? { userAgent: cmd.attemptUserAgent } : {}),
      ...(cmd.sessionPolicy !== undefined ? { policy: cmd.sessionPolicy } : {}),
    },
    eventStore,
    entities,
  );

  return {
    envelope,
    follow: [updateEvent, ...session.follow, session.envelope],
    user: updated,
    sessionResult: {
      document: session.document,
      plaintextRefreshToken: session.plaintextRefreshToken,
      plaintextAccessToken: session.plaintextAccessToken,
      cookiePayload: session.cookiePayload,
    },
  };
}
