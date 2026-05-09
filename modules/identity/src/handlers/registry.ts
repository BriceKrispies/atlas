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
import { handleIdpConfigure } from './idp-configure.ts';
import { handleIdpActivate } from './idp-activate.ts';
import { handleIdpDisable } from './idp-disable.ts';
import { handleIdpRotateJwks } from './idp-rotate-jwks.ts';
import type { SessionEndReason } from '../types.ts';
import { IdentityError } from '../errors.ts';
import { eventTypeToLogShape } from './log-shape.ts';

/**
 * Redact and truncate a free-text value for log output. We never log
 * raw passwords, recovery codes, JWTs, or scrypt hashes — wrappers
 * pass only stable identifiers (eventType, userId, eventId, email,
 * actionId) and any caller-supplied free-text is clamped to ≤200
 * chars defensively.
 */
function clampFreeText(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length === 0) return undefined;
  return v.length > 200 ? `${v.slice(0, 200)}…` : v;
}

/**
 * Wrap an `IntentHandler` so that on success it inspects the resulting
 * primary `eventType` and emits a `Domain.Verb.Outcome` log line via
 * `ctx.logger`, and on uncaught throw emits `Identity.<verb>.Failed`
 * at error level (then rethrows).
 *
 * Handler bodies are NOT modified. The wrapper is a no-op when no
 * logger is on the context (test fixtures, sim).
 *
 * Caller passes a stable `verb` (e.g. `Login`, `User.Create`) so the
 * Failed shape is predictable even when the handler throws before
 * emitting an event. Success / Rejected shapes are derived from the
 * primary `eventType` via `eventTypeToLogShape`.
 */
function withLogging(
  verb: string,
  inner: IntentHandler,
): IntentHandler {
  return {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope,
    ): Promise<HandlerResult> {
      const logger = ctx.logger;
      try {
        const result = await inner.handle(ctx, envelope);
        if (logger) {
          const shape = eventTypeToLogShape(result.primary.eventType);
          // `ctx.logger.info|warn|error(...)` keyed off shape.level. The
          // properties block carries only stable identifiers — never
          // raw secrets. Email lives on the envelope payload for some
          // events; we surface only the eventType-tied identifiers and
          // any actionId so log readers can correlate.
          const fields = {
            event: shape.event,
            properties: {
              actionId:
                clampFreeText(
                  (envelope.payload as { actionId?: unknown })?.actionId,
                ) ?? '<unknown>',
              eventType: result.primary.eventType,
              eventId: result.primary.eventId,
              followCount: result.follow.length,
              ...(result.primary.userId !== null
                ? { userId: result.primary.userId }
                : {}),
            },
          };
          if (shape.level === 'warn') {
            logger.warn(`identity ${verb} ${shape.event}`, fields);
          } else if (shape.level === 'error') {
            logger.error(`identity ${verb} ${shape.event}`, fields);
          } else {
            logger.info(`identity ${verb} ${shape.event}`, fields);
          }
        }
        return result;
      } catch (e) {
        if (logger) {
          const code =
            e instanceof IdentityError
              ? e.code
              : e instanceof Error
                ? e.name
                : 'UnknownError';
          logger.error(`identity ${verb} failed`, {
            event: `Identity.${verb}.Failed`,
            error: {
              code,
              message: clampFreeText((e as Error).message ?? String(e)) ?? '',
            },
            properties: {
              actionId:
                clampFreeText(
                  (envelope.payload as { actionId?: unknown })?.actionId,
                ) ?? '<unknown>',
            },
          });
        }
        throw e;
      }
    },
  };
}

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

  // ----- Phase A3 — federated OIDC -------------------------------

  const idpConfigureHandler: IntentHandler = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload as Record<string, unknown>;
      const result = await handleIdpConfigure(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          displayName: readString(p, 'displayName'),
          issuer: readString(p, 'issuer'),
          audience: readString(p, 'audience'),
          ...(readOptionalString(p, 'jwksUri') !== undefined
            ? { jwksUri: readOptionalString(p, 'jwksUri') as string }
            : {}),
          ...(readOptionalString(p, 'groupClaimPath') !== undefined
            ? {
                groupClaimPath: readOptionalString(p, 'groupClaimPath') as string,
              }
            : {}),
          ...(p['discoveryDocument'] !== undefined
            ? {
                discoveryDocument: p['discoveryDocument'] as never,
              }
            : {}),
          ...(p['requireInvite'] !== undefined
            ? { requireInvite: Boolean(p['requireInvite']) }
            : {}),
          ...(Array.isArray(p['defaultRolesOnFirstLogin'])
            ? {
                defaultRolesOnFirstLogin: readStringArray(
                  p,
                  'defaultRolesOnFirstLogin',
                ),
              }
            : {}),
          ...(Array.isArray(p['roleMappings'])
            ? { roleMappings: p['roleMappings'] as never }
            : {}),
          ...(typeof p['priority'] === 'number'
            ? { priority: p['priority'] as number }
            : {}),
        },
        ctx.eventStore,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const idpActivateHandler: IntentHandler = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload as Record<string, unknown>;
      const result = await handleIdpActivate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          idpId: readString(p, 'idpId'),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const idpDisableHandler: IntentHandler = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload as Record<string, unknown>;
      const result = await handleIdpDisable(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          idpId: readString(p, 'idpId'),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const idpRotateJwksHandler: IntentHandler = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload as Record<string, unknown>;
      const result = await handleIdpRotateJwks(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          idpId: readString(p, 'idpId'),
          ...(readOptionalString(p, 'jwksUri') !== undefined
            ? { jwksUri: readOptionalString(p, 'jwksUri') as string }
            : {}),
          ...(p['discoveryDocument'] !== undefined
            ? { discoveryDocument: p['discoveryDocument'] as never }
            : {}),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  // Register Phase-A3 IDP wrappers in the table below. Local-scoped
  // here so the closure-captured `entities` is in scope.
  return [
    ['Identity.User.Create', withLogging('User.Create', userCreateHandler)],
    ['Identity.Membership.Create', withLogging('Membership.Create', membershipCreateHandler)],
    ['Identity.Invite.Issue', withLogging('Invite.Issue', inviteIssueHandler)],
    ['Identity.Invite.Accept', withLogging('Invite.Accept', inviteAcceptHandler)],
    ['Identity.User.SetPassword', withLogging('User.SetPassword', passwordSetHandler)],
    ['Identity.Login.Password', withLogging('Login.Password', passwordLoginHandler)],
    // Phase A2 — sessions.
    ['Identity.AuthSession.Issue', withLogging('AuthSession.Issue', sessionIssueHandler)],
    ['Identity.AuthSession.Refresh', withLogging('AuthSession.Refresh', sessionRefreshHandler)],
    ['Identity.AuthSession.Revoke', withLogging('AuthSession.Revoke', sessionRevokeHandler)],
    ['Identity.AuthSession.RevokeAllForUser', withLogging('AuthSession.RevokeAllForUser', sessionRevokeAllHandler)],
    // Phase A2.7-A2.9 — service credentials.
    ['Identity.ApiKey.Create', withLogging('ApiKey.Create', apiKeyCreateHandler)],
    ['Identity.ApiKey.Rotate', withLogging('ApiKey.Rotate', apiKeyRotateHandler)],
    ['Identity.ApiKey.Revoke', withLogging('ApiKey.Revoke', apiKeyRevokeHandler)],
    ['Identity.ServicePrincipal.Create', withLogging('ServicePrincipal.Create', spCreateHandler)],
    ['Identity.ServicePrincipal.SetScopes', withLogging('ServicePrincipal.SetScopes', spSetScopesHandler)],
    ['Identity.ServicePrincipal.Disable', withLogging('ServicePrincipal.Disable', spDisableHandler)],
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
