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
import type {
  ApiKeyCreatePayload,
  ApiKeyRevokePayload,
  ApiKeyRotatePayload,
  IdentityIntentPayload,
  IdpActivatePayload,
  IdpConfigurePayload,
  IdpDisablePayload,
  IdpRotateJwksPayload,
  InviteAcceptPayload,
  InviteIssuePayload,
  MembershipCreatePayload,
  PasswordLoginPayload,
  PasswordSetPayload,
  ServicePrincipalCreatePayload,
  ServicePrincipalDisablePayload,
  ServicePrincipalSetScopesPayload,
  SessionIssuePayload,
  SessionRefreshPayload,
  SessionRevokeAllForUserPayload,
  SessionRevokePayload,
  UserCreatePayload,
} from '../intents.ts';

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
 *
 * Generic over `TPayload` so the wrapped handler keeps its typed
 * envelope all the way through — the wrapper just observes outcomes,
 * it doesn't touch payload fields.
 */
function withLogging<TPayload extends IdentityIntentPayload>(
  verb: string,
  inner: IntentHandler<TPayload>,
): IntentHandler<TPayload> {
  return {
    async handle(
      ctx: IntentHandlerContext,
      envelope: IntentEnvelope<TPayload>,
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
              actionId: clampFreeText(envelope.payload.actionId) ?? '<unknown>',
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
          const message = e instanceof Error ? e.message : String(e);
          logger.error(`identity ${verb} failed`, {
            event: `Identity.${verb}.Failed`,
            error: {
              code,
              message: clampFreeText(message) ?? '',
            },
            properties: {
              actionId: clampFreeText(envelope.payload.actionId) ?? '<unknown>',
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
 * Coerce a payload `reason` field to a `SessionEndReason`, falling
 * back when absent and rejecting on unknown strings.
 *
 * The wire shape allows `reason` to be omitted (the registry then
 * uses the caller-supplied `fallback`, e.g. `admin_revoke` for
 * session-revoke). Silently coercing an unknown value to
 * `admin_revoke` would falsify the audit trail and mislead the risk
 * engine, so we surface the bad input as a 400 instead.
 */
function coerceEndReason(
  reason: SessionEndReason | undefined,
  fallback: SessionEndReason,
): SessionEndReason {
  if (reason === undefined) return fallback;
  if (!VALID_END_REASONS.has(reason)) {
    throw new IdentityError(
      'IDENTITY_INVALID',
      `payload.reason must be one of: ${Array.from(VALID_END_REASONS).join(', ')}`,
      400,
    );
  }
  return reason;
}

/**
 * Erase the typed-payload generic when binding a handler into the
 * registry map. The HandlerRegistry's `get(actionId): IntentHandler`
 * surface returns the default-generic shape (`IntentPayload`), so the
 * action-specific narrowing only lives inside each closure — the
 * caller (ingress) still sees the wide interface, which is correct:
 * ingress dispatches by `actionId` and doesn't know payload-shape
 * statically.
 */
function asWide<TPayload extends IdentityIntentPayload>(
  h: IntentHandler<TPayload>,
): IntentHandler {
  return h as unknown as IntentHandler;
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
  const userCreateHandler: IntentHandler<UserCreatePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleUserCreate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          email: p.email,
          ...(p.userId !== undefined ? { userId: p.userId } : {}),
          ...(p.primaryIdpSubject !== undefined
            ? { primaryIdpSubject: p.primaryIdpSubject }
            : {}),
          ...(p.givenName !== undefined ? { givenName: p.givenName } : {}),
          ...(p.familyName !== undefined ? { familyName: p.familyName } : {}),
        },
        ctx.eventStore,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const membershipCreateHandler: IntentHandler<MembershipCreatePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleMembershipCreate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          userId: p.userId,
          roles: p.roles,
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const inviteIssueHandler: IntentHandler<InviteIssuePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleInviteIssue(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          email: p.email,
          rolesOnAccept: p.rolesOnAccept,
          ...(p.ttlSeconds !== undefined ? { ttlSeconds: p.ttlSeconds } : {}),
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

  const inviteAcceptHandler: IntentHandler<InviteAcceptPayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleInviteAccept(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          presentedToken: p.presentedToken,
          acceptedEmail: p.acceptedEmail,
          ...(p.primaryIdpSubject !== undefined
            ? { primaryIdpSubject: p.primaryIdpSubject }
            : {}),
          ...(p.givenName !== undefined ? { givenName: p.givenName } : {}),
          ...(p.familyName !== undefined ? { familyName: p.familyName } : {}),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: result.follow };
    },
  };

  const passwordSetHandler: IntentHandler<PasswordSetPayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handlePasswordSet(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          userId: p.userId,
          newPassword: p.newPassword,
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: result.follow };
    },
  };

  const passwordLoginHandler: IntentHandler<PasswordLoginPayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handlePasswordLogin(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          email: p.email,
          password: p.password,
          ...(p.attemptIp !== undefined ? { attemptIp: p.attemptIp } : {}),
          ...(p.attemptUserAgent !== undefined
            ? { attemptUserAgent: p.attemptUserAgent }
            : {}),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: result.follow };
    },
  };

  // ----- Phase A2 — sessions ---------------------------------------

  const sessionIssueHandler: IntentHandler<SessionIssuePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleSessionIssue(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          userId: p.userId,
          ...(p.ip !== undefined ? { ip: p.ip } : {}),
          ...(p.userAgent !== undefined ? { userAgent: p.userAgent } : {}),
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

  const sessionRefreshHandler: IntentHandler<SessionRefreshPayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleSessionRefresh(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          sessionId: p.sessionId,
          presentedRefreshSecret: p.presentedRefreshSecret,
          ...(p.ip !== undefined ? { ip: p.ip } : {}),
          ...(p.userAgent !== undefined ? { userAgent: p.userAgent } : {}),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: result.follow };
    },
  };

  const sessionRevokeHandler: IntentHandler<SessionRevokePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleSessionRevoke(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          sessionId: p.sessionId,
          reason: coerceEndReason(p.reason, 'admin_revoke'),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const sessionRevokeAllHandler: IntentHandler<SessionRevokeAllForUserPayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const targetUserId = p.userId;
      const result = await handleSessionRevokeAllForUser(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          userId: targetUserId,
          reason: coerceEndReason(p.reason, 'admin_revoke'),
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

  const apiKeyCreateHandler: IntentHandler<ApiKeyCreatePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleApiKeyCreate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          name: p.name,
          scopes: p.scopes,
          ...(p.userId !== undefined ? { userId: p.userId } : {}),
          ...(p.servicePrincipalId !== undefined
            ? { servicePrincipalId: p.servicePrincipalId }
            : {}),
          ...(p.expiresAt !== undefined ? { expiresAt: p.expiresAt } : {}),
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const apiKeyRotateHandler: IntentHandler<ApiKeyRotatePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleApiKeyRotate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          keyId: p.keyId,
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: result.follow };
    },
  };

  const apiKeyRevokeHandler: IntentHandler<ApiKeyRevokePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleApiKeyRevoke(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          keyId: p.keyId,
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const spCreateHandler: IntentHandler<ServicePrincipalCreatePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleServicePrincipalCreate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          ownerUserId: p.ownerUserId,
          displayName: p.displayName,
          scopes: p.scopes,
        },
        ctx.eventStore,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const spSetScopesHandler: IntentHandler<ServicePrincipalSetScopesPayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleServicePrincipalSetScopes(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          spId: p.spId,
          scopes: p.scopes,
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const spDisableHandler: IntentHandler<ServicePrincipalDisablePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleServicePrincipalDisable(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          spId: p.spId,
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  // ----- Phase A3 — federated OIDC -------------------------------

  const idpConfigureHandler: IntentHandler<IdpConfigurePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleIdpConfigure(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          displayName: p.displayName,
          issuer: p.issuer,
          audience: p.audience,
          ...(p.jwksUri !== undefined ? { jwksUri: p.jwksUri } : {}),
          ...(p.groupClaimPath !== undefined
            ? { groupClaimPath: p.groupClaimPath }
            : {}),
          ...(p.discoveryDocument !== undefined
            ? { discoveryDocument: p.discoveryDocument }
            : {}),
          ...(p.requireInvite !== undefined
            ? { requireInvite: p.requireInvite }
            : {}),
          ...(p.defaultRolesOnFirstLogin !== undefined
            ? { defaultRolesOnFirstLogin: p.defaultRolesOnFirstLogin }
            : {}),
          ...(p.roleMappings !== undefined
            ? { roleMappings: p.roleMappings }
            : {}),
          ...(p.priority !== undefined ? { priority: p.priority } : {}),
        },
        ctx.eventStore,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const idpActivateHandler: IntentHandler<IdpActivatePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleIdpActivate(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          idpId: p.idpId,
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const idpDisableHandler: IntentHandler<IdpDisablePayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleIdpDisable(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          idpId: p.idpId,
        },
        ctx.eventStore,
        entities,
      );
      return { primary: result.envelope, follow: [] };
    },
  };

  const idpRotateJwksHandler: IntentHandler<IdpRotateJwksPayload> = {
    async handle(ctx, envelope): Promise<HandlerResult> {
      const p = envelope.payload;
      const result = await handleIdpRotateJwks(
        {
          tenantId: ctx.tenantId,
          correlationId: ctx.correlationId,
          principalId: ctx.principalId,
          idpId: p.idpId,
          ...(p.jwksUri !== undefined ? { jwksUri: p.jwksUri } : {}),
          ...(p.discoveryDocument !== undefined
            ? { discoveryDocument: p.discoveryDocument }
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
  //
  // Each entry uses `asWide` to erase the typed-payload generic at the
  // `HandlerRegistry` boundary — the registry's `get(actionId)` surface
  // returns the wide `IntentHandler` shape (typed against
  // `IntentPayload`), because ingress dispatches by `actionId` string
  // and doesn't know payload-shape statically. The narrowed types only
  // live *inside* the closures, where they bite at compile time.
  return [
    ['Identity.User.Create', asWide(withLogging('User.Create', userCreateHandler))],
    ['Identity.Membership.Create', asWide(withLogging('Membership.Create', membershipCreateHandler))],
    ['Identity.Invite.Issue', asWide(withLogging('Invite.Issue', inviteIssueHandler))],
    ['Identity.Invite.Accept', asWide(withLogging('Invite.Accept', inviteAcceptHandler))],
    ['Identity.User.SetPassword', asWide(withLogging('User.SetPassword', passwordSetHandler))],
    ['Identity.Login.Password', asWide(withLogging('Login.Password', passwordLoginHandler))],
    // Phase A2 — sessions.
    ['Identity.AuthSession.Issue', asWide(withLogging('AuthSession.Issue', sessionIssueHandler))],
    ['Identity.AuthSession.Refresh', asWide(withLogging('AuthSession.Refresh', sessionRefreshHandler))],
    ['Identity.AuthSession.Revoke', asWide(withLogging('AuthSession.Revoke', sessionRevokeHandler))],
    ['Identity.AuthSession.RevokeAllForUser', asWide(withLogging('AuthSession.RevokeAllForUser', sessionRevokeAllHandler))],
    // Phase A2.7-A2.9 — service credentials.
    ['Identity.ApiKey.Create', asWide(withLogging('ApiKey.Create', apiKeyCreateHandler))],
    ['Identity.ApiKey.Rotate', asWide(withLogging('ApiKey.Rotate', apiKeyRotateHandler))],
    ['Identity.ApiKey.Revoke', asWide(withLogging('ApiKey.Revoke', apiKeyRevokeHandler))],
    ['Identity.ServicePrincipal.Create', asWide(withLogging('ServicePrincipal.Create', spCreateHandler))],
    ['Identity.ServicePrincipal.SetScopes', asWide(withLogging('ServicePrincipal.SetScopes', spSetScopesHandler))],
    ['Identity.ServicePrincipal.Disable', asWide(withLogging('ServicePrincipal.Disable', spDisableHandler))],
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
