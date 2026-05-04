import type {
  EntityStore,
  HandlerRegistry,
  IntentHandler,
  IntentHandlerContext,
  HandlerResult,
} from '@atlas/ports';
import type { EventEnvelope, IntentEnvelope } from '@atlas/platform-core';
import { handleUserCreate } from './user-create.ts';
import { handleMembershipCreate } from './membership-create.ts';
import { handleInviteIssue } from './invite-issue.ts';
import { handleInviteAccept } from './invite-accept.ts';
import { handlePasswordSet } from './password-set.ts';
import { handlePasswordLogin } from './password-login.ts';
import { handleSessionIssue } from './session-issue.ts';
import { handleSessionRefresh } from './session-refresh.ts';
import {
  handleSessionRevoke,
  handleSessionRevokeAllForUser,
} from './session-revoke.ts';
import { newEventId } from '../ids.ts';
import { handleApiKeyCreate } from './api-key-create.ts';
import { handleApiKeyRotate } from './api-key-rotate.ts';
import { handleApiKeyRevoke } from './api-key-revoke.ts';
import {
  handleServicePrincipalCreate,
  handleServicePrincipalSetScopes,
  handleServicePrincipalDisable,
} from './service-principal.ts';
import { handleOAuthIssueToken } from './oauth-token-issue.ts';
import { handleOAuthRevokeToken } from './oauth-token-revoke.ts';
import type { SessionEndReason } from '../types.ts';
import { IdentityError } from '../errors.ts';

const VALID_END_REASONS: ReadonlySet<SessionEndReason> = new Set<SessionEndReason>([
  'user_logout',
  'admin_revoke',
  'reuse_detected',
  'idle_timeout',
  'hard_timeout',
  'evicted',
  'password_changed',
  'tenant_force_relogin',
]);

/**
 * Read a `SessionEndReason` from the intent payload. When the field is
 * absent, the caller-supplied `fallback` wins (e.g. session-revoke
 * defaults to `admin_revoke`). When the field is present but not in the
 * `VALID_END_REASONS` set, the request is rejected — silently coercing
 * an unknown value to `admin_revoke` would falsify the audit trail and
 * mislead the risk engine, so we surface the bad input as a 400.
 */
function readEndReason(
  payload: Record<string, unknown>,
  key: string,
  fallback: SessionEndReason,
): SessionEndReason {
  const v = payload[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string' || !VALID_END_REASONS.has(v as SessionEndReason)) {
    throw new IdentityError(
      'IDENTITY_INVALID',
      `payload.${key} must be one of: ${Array.from(VALID_END_REASONS).join(', ')}`,
      400,
    );
  }
  return v as SessionEndReason;
}

function readString(payload: Record<string, unknown>, key: string): string {
  const v = payload[key];
  if (typeof v !== 'string') {
    throw new Error(`expected string for payload.${key}`);
  }
  return v;
}

function readOptionalString(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = payload[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new Error(`expected string|null|undefined for payload.${key}`);
  }
  return v;
}

function readStringArray(
  payload: Record<string, unknown>,
  key: string,
): string[] {
  const v = payload[key];
  if (!Array.isArray(v) || !v.every((item) => typeof item === 'string')) {
    throw new Error(`expected string[] for payload.${key}`);
  }
  return v as string[];
}

function readOptionalNumber(
  payload: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = payload[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number') {
    throw new Error(`expected number|null|undefined for payload.${key}`);
  }
  return v;
}

/**
 * Construct identity handler entries.
 *
 * Membership-create + invite-accept need an `EntityStore` (User /
 * Membership / InviteToken lookups). Threaded via closure since
 * `IntentHandlerContext` doesn't carry it — same pattern as content-pages.
 */
export function identityHandlerEntries(
  entities: EntityStore,
): ReadonlyArray<readonly [string, IntentHandler]> {
  const userCreateHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handleUserCreate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          email: readString(payload, 'email'),
          ...(readOptionalString(payload, 'userId') !== undefined
            ? { userId: readOptionalString(payload, 'userId') as string }
            : {}),
          ...(readOptionalString(payload, 'primaryIdpSubject') !== undefined
            ? {
                primaryIdpSubject: readOptionalString(
                  payload,
                  'primaryIdpSubject',
                ) as string,
              }
            : {}),
          ...(readOptionalString(payload, 'givenName') !== undefined
            ? { givenName: readOptionalString(payload, 'givenName') as string }
            : {}),
          ...(readOptionalString(payload, 'familyName') !== undefined
            ? {
                familyName: readOptionalString(payload, 'familyName') as string,
              }
            : {}),
        },
        ctx.eventStore,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const membershipCreateHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handleMembershipCreate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          userId: readString(payload, 'userId'),
          roles: readStringArray(payload, 'roles'),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const inviteIssueHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handleInviteIssue(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          email: readString(payload, 'email'),
          rolesOnAccept: readStringArray(payload, 'rolesOnAccept'),
          ...(readOptionalNumber(payload, 'ttlSeconds') !== undefined
            ? { ttlSeconds: readOptionalNumber(payload, 'ttlSeconds') as number }
            : {}),
        },
        ctx.eventStore,
      );
      // The plaintext token is surfaced via the intent response shape
      // documented in `events/issue.md`. The handler shape here returns
      // only the envelope chain; the route layer reads `result.plaintextToken`
      // separately (see `apps/server/src/routes/identity/invite.ts`).
      return { primary: result.envelope, follow: [] };
    },
  };

  const inviteAcceptHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handleInviteAccept(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          presentedToken: readString(payload, 'presentedToken'),
          acceptedEmail: readString(payload, 'acceptedEmail'),
          ...(readOptionalString(payload, 'primaryIdpSubject') !== undefined
            ? {
                primaryIdpSubject: readOptionalString(
                  payload,
                  'primaryIdpSubject',
                ) as string,
              }
            : {}),
          ...(readOptionalString(payload, 'givenName') !== undefined
            ? { givenName: readOptionalString(payload, 'givenName') as string }
            : {}),
          ...(readOptionalString(payload, 'familyName') !== undefined
            ? {
                familyName: readOptionalString(payload, 'familyName') as string,
              }
            : {}),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: result.follow };
    },
  };

  const passwordSetHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handlePasswordSet(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          userId: readString(payload, 'userId'),
          newPassword: readString(payload, 'newPassword'),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: result.follow };
    },
  };

  const passwordLoginHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handlePasswordLogin(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          email: readString(payload, 'email'),
          password: readString(payload, 'password'),
          ...(readOptionalString(payload, 'attemptIp') !== undefined
            ? { attemptIp: readOptionalString(payload, 'attemptIp') as string }
            : {}),
          ...(readOptionalString(payload, 'attemptUserAgent') !== undefined
            ? {
                attemptUserAgent: readOptionalString(
                  payload,
                  'attemptUserAgent',
                ) as string,
              }
            : {}),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: result.follow };
    },
  };

  // ----- Phase A2 — sessions ---------------------------------------

  const sessionIssueHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handleSessionIssue(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          userId: readString(payload, 'userId'),
          ...(readOptionalString(payload, 'ip') !== undefined
            ? { ip: readOptionalString(payload, 'ip') as string }
            : {}),
          ...(readOptionalString(payload, 'userAgent') !== undefined
            ? { userAgent: readOptionalString(payload, 'userAgent') as string }
            : {}),
        },
        ctx.eventStore,
        entities,
      );
      // Plaintexts are surfaced via the route layer, not the standard
      // intent response shape (the response-side surface is the cookie
      // + access_token body). The intent path returns just the event
      // envelopes; routes that need plaintexts call `handleSessionIssue`
      // directly.
      return { primary: result.envelope, follow: result.follow };
    },
  };

  const sessionRefreshHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handleSessionRefresh(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          sessionId: readString(payload, 'sessionId'),
          presentedRefreshSecret: readString(payload, 'presentedRefreshSecret'),
          ...(readOptionalString(payload, 'ip') !== undefined
            ? { ip: readOptionalString(payload, 'ip') as string }
            : {}),
          ...(readOptionalString(payload, 'userAgent') !== undefined
            ? { userAgent: readOptionalString(payload, 'userAgent') as string }
            : {}),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: result.follow };
    },
  };

  const sessionRevokeHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handleSessionRevoke(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          sessionId: readString(payload, 'sessionId'),
          reason: readEndReason(payload, 'reason', 'admin_revoke'),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const sessionRevokeAllHandler: IntentHandler = {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const payload = envelope.payload as Record<string, unknown>;
      const result = await handleSessionRevokeAllForUser(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          userId: readString(payload, 'userId'),
          reason: readEndReason(payload, 'reason', 'admin_revoke'),
        },
        ctx.eventStore,
        entities,
      );
      // No-op success when the user had no active sessions — emit a
      // synthetic envelope so the intent pipeline has something to
      // record. The dispatcher's HANDLED_EVENT_TYPES ignores it.
      //
      // The synthetic envelope's `idempotencyKey` is derived from the
      // caller's intent envelope key so retries collapse cleanly at the
      // event-store layer (Invariant I3). `userId` is the *target* of
      // the revoke-all, not the acting principal — earlier code
      // mislabelled it as `ctx.principalId`, which broke audit
      // attribution when an admin revoked another user's sessions.
      const targetUserId = readString(payload, 'userId');
      const primary: EventEnvelope = result.envelopes[0] ?? {
        eventId: newEventId(),
        eventType: 'Identity.SessionRevokeAllForUser.NoOp',
        schemaId: 'domain.identity.session.revoke-all.noop.v1',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        tenantId: ctx.tenantId,
        correlationId: ctx.correlationId,
        idempotencyKey: `${envelope.idempotencyKey}.noop`,
        causationId: null,
        principalId: ctx.principalId,
        userId: targetUserId,
        cacheInvalidationTags: [
          `Tenant:${ctx.tenantId}`,
          `User:${targetUserId}`,
        ],
        payload: { revokedSessionIds: [] },
      };
      return {
        primary,
        follow: result.envelopes.slice(1),
      };
    },
  };

  // ----- Phase A2.7-A2.9 — service credentials ---------------------

  function readStringArray(
    payload: Record<string, unknown>,
    key: string,
  ): string[] {
    const v = payload[key];
    if (!Array.isArray(v) || !v.every((item) => typeof item === 'string')) {
      throw new Error(`expected string[] for payload.${key}`);
    }
    return v as string[];
  }

  const apiKeyCreateHandler: IntentHandler = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload as Record<string, unknown>;
      const result = await handleApiKeyCreate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          name: readString(p, 'name'),
          scopes: readStringArray(p, 'scopes'),
          ...(readOptionalString(p, 'userId') !== undefined
            ? { userId: readOptionalString(p, 'userId') as string }
            : {}),
          ...(readOptionalString(p, 'servicePrincipalId') !== undefined
            ? { servicePrincipalId: readOptionalString(p, 'servicePrincipalId') as string }
            : {}),
          ...(readOptionalString(p, 'expiresAt') !== undefined
            ? { expiresAt: readOptionalString(p, 'expiresAt') as string }
            : {}),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const apiKeyRotateHandler: IntentHandler = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload as Record<string, unknown>;
      const result = await handleApiKeyRotate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          keyId: readString(p, 'keyId'),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: result.follow };
    },
  };

  const apiKeyRevokeHandler: IntentHandler = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload as Record<string, unknown>;
      const result = await handleApiKeyRevoke(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          keyId: readString(p, 'keyId'),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const spCreateHandler: IntentHandler = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload as Record<string, unknown>;
      const result = await handleServicePrincipalCreate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          ownerUserId: readString(p, 'ownerUserId'),
          displayName: readString(p, 'displayName'),
          scopes: readStringArray(p, 'scopes'),
        },
        ctx.eventStore,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const spSetScopesHandler: IntentHandler = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload as Record<string, unknown>;
      const result = await handleServicePrincipalSetScopes(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          spId: readString(p, 'spId'),
          scopes: readStringArray(p, 'scopes'),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const spDisableHandler: IntentHandler = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload as Record<string, unknown>;
      const result = await handleServicePrincipalDisable(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          spId: readString(p, 'spId'),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  return [
    ['Identity.User.Create', userCreateHandler],
    ['Identity.Membership.Create', membershipCreateHandler],
    ['Identity.Invite.Issue', inviteIssueHandler],
    ['Identity.Invite.Accept', inviteAcceptHandler],
    ['Identity.User.SetPassword', passwordSetHandler],
    ['Identity.Login.Password', passwordLoginHandler],
    // Phase A2 — sessions.
    ['Identity.AuthSession.Issue', sessionIssueHandler],
    ['Identity.AuthSession.Refresh', sessionRefreshHandler],
    ['Identity.AuthSession.Revoke', sessionRevokeHandler],
    ['Identity.AuthSession.RevokeAllForUser', sessionRevokeAllHandler],
    // Phase A2.7-A2.9 — service credentials.
    ['Identity.ApiKey.Create', apiKeyCreateHandler],
    ['Identity.ApiKey.Rotate', apiKeyRotateHandler],
    ['Identity.ApiKey.Revoke', apiKeyRevokeHandler],
    ['Identity.ServicePrincipal.Create', spCreateHandler],
    ['Identity.ServicePrincipal.SetScopes', spSetScopesHandler],
    ['Identity.ServicePrincipal.Disable', spDisableHandler],
    // OAuth token-issue/revoke flow goes through dedicated /oauth
    // routes (RFC 6749 wire shape, not the standard /api/v1/intents
    // path), so it intentionally has no registry entries here. See
    // `apps/server/src/routes/oauth.ts` (Phase A2.9 wiring).
  ];
}

// Stand-alone exports of the OAuth handlers — the /oauth routes call
// them directly because the wire shape is RFC 6749, not the Atlas
// intent envelope.
export {
  handleOAuthIssueToken as oauthIssueToken,
  handleOAuthRevokeToken as oauthRevokeToken,
};

export function identityHandlerRegistry(
  entities: EntityStore,
): HandlerRegistry {
  const map = new Map<string, IntentHandler>(identityHandlerEntries(entities));
  return {
    get(actionId: string): IntentHandler | undefined {
      return map.get(actionId);
    },
  };
}
