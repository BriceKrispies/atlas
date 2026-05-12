/**
 * Identity HTTP routes.
 *
 * Most identity flows go through `POST /api/v1/intents` (so authz +
 * idempotency + event log apply uniformly). The exceptions are routes
 * the *unauthenticated* user reaches before they have a session:
 *
 *   - `POST /api/v1/identity/invite/accept`
 *     Redeem a plaintext invite token for a User + Membership. The
 *     token IS the authorization. No JWT, no debug-principal — this
 *     route is mounted PUBLIC.
 *
 * Phase A1: only the invite-accept route lives here. Password-reset,
 * magic-link request, magic-link redeem land in subsequent phases.
 *
 * The login + change-password flows go through the standard intents
 * pipeline (`Identity.Login.Password`, `Identity.User.SetPassword`).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  PostgresEntityStore,
  PostgresEventStore,
  PostgresRelationStore,
} from '@atlas/adapter-node';
import {
  handleInviteAccept,
  handleSessionRefresh,
  handleSessionRevoke,
  identityDispatcher,
  getSessionEntity,
  listActiveSessionsForUser,
  IdentityError,
} from '@atlas/identity';
import { PLATFORM_ROBOT_PRINCIPAL_ID } from '@atlas/platform-core';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse, publicIdentityCode, errorMessage } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  parseSessionCookie,
} from '../middleware/cookie.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

interface InviteAcceptBody {
  tenantId?: unknown;
  presentedToken?: unknown;
  acceptedEmail?: unknown;
  primaryIdpSubject?: unknown;
  givenName?: unknown;
  familyName?: unknown;
}

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function identityRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  app.post('/api/v1/identity/invite/accept', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    let body: InviteAcceptBody;
    try {
      body = (await c.req.json()) as InviteAcceptBody;
    } catch {
      return errorResponse(c, 'SCHEMA_VALIDATION_FAILED', 'invalid JSON body', 400, correlationId);
    }
    const tenantId = readString(body.tenantId);
    const presentedToken = readString(body.presentedToken);
    const acceptedEmail = readString(body.acceptedEmail);
    if (!tenantId) {
      return errorResponse(
        c,
        'SCHEMA_VALIDATION_FAILED',
        'tenantId is required',
        400,
        correlationId,
      );
    }
    if (!acceptedEmail) {
      return errorResponse(
        c,
        'SCHEMA_VALIDATION_FAILED',
        'acceptedEmail is required',
        400,
        correlationId,
      );
    }
    if (!presentedToken) {
      return errorResponse(
        c,
        'SCHEMA_VALIDATION_FAILED',
        'presentedToken is required',
        400,
        correlationId,
      );
    }
    if (!acceptedEmail) {
      // Email-binding is required by the identity module so that
      // possession of a leaked invite token is not sufficient to claim
      // the invite. Routes are responsible for pre-verifying that the
      // caller actually owns this email — typically via a confirmation
      // link click that presents both fields together.
      return errorResponse(
        c,
        'SCHEMA_VALIDATION_FAILED',
        'acceptedEmail is required',
        400,
        correlationId,
      );
    }

    // Ensure the tenant exists + has migrations applied. `ensureTenantMigrated`
    // throws if the tenant isn't in `control_plane.tenants` — surface as
    // 404 rather than leaking the underlying postgres error.
    let sql: import('postgres').Sql;
    try {
      sql = await ensureTenantMigrated(state, tenantId);
    } catch (e) {
      c.get('ctx').logger.warn('tenant migrate failed; returning 404', {
        event: 'Tenancy.EnsureMigrated.Failed',
        properties: {
          tenantId,
          route: 'identity.invite-accept',
          cause: errorMessage(e),
        },
      });
      return errorResponse(
        c,
        'NOT_FOUND',
        `tenant not found: ${tenantId}`,
        404,
        correlationId,
      );
    }
    const eventStore = new PostgresEventStore(sql);
    const entities = new PostgresEntityStore(sql);
    const relations = new PostgresRelationStore(sql);

    try {
      const givenName = readString(body.givenName);
      const familyName = readString(body.familyName);
      const idpSubject = readString(body.primaryIdpSubject);
      // Pull caller IP / UA off the request for the SessionIssued audit.
      const ip =
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
        c.req.header('x-real-ip') ??
        undefined;
      const userAgent = c.req.header('user-agent') ?? undefined;
      const result = await handleInviteAccept(
        {
          tenantId,
          correlationId,
          // Public invite-accept — the token IS the authorization; the
          // bootstrap robot stands in as the calling principal so audit
          // captures a real actor (ADR 0008 §2).
          principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
          presentedToken,
          acceptedEmail,
          ...(idpSubject !== null ? { primaryIdpSubject: idpSubject } : {}),
          ...(givenName !== null ? { givenName } : {}),
          ...(familyName !== null ? { familyName } : {}),
          ...(ip !== undefined ? { ip } : {}),
          ...(userAgent !== undefined ? { userAgent } : {}),
        },
        eventStore,
        entities,
      );

      // Apply projections inline. Async-mode worker would also pick
      // these up from the event log, but the route response wants the
      // fresh User/Membership reachable via the next read.
      const dispatch = identityDispatcher({ entities, relations });
      for (const f of result.follow) {
        await dispatch(f);
      }
      await dispatch(result.envelope);

      // Set the session cookie. The full cookie+CSRF middleware lands
      // in A2.5 — for now the route writes the headers inline. Format
      // is the wire-shape the refresh route expects.
      if (result.sessionResult) {
        const cookieValue = `atlas_session=${result.sessionResult.cookiePayload}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${24 * 60 * 60}`;
        c.header('Set-Cookie', cookieValue, { append: true });
      }

      return c.json(
        {
          userId: result.user.userId,
          tenantId,
          email: result.user.email,
          membershipRoles: result.membership.roles,
          ...(result.sessionResult
            ? {
                accessToken: result.sessionResult.plaintextAccessToken,
                accessTokenExpiresAt: result.sessionResult.document.accessExpiresAt,
                sessionId: result.sessionResult.document.sessionId,
              }
            : {}),
        },
        201,
      );
    } catch (e) {
      if (e instanceof IdentityError) {
        const pub = publicIdentityCode(e.code);
        if (pub.code !== e.code) {
          return errorResponse(c, pub.code, pub.message, e.status, correlationId);
        }
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      c.get('ctx').logger.error('identity invite-accept unmapped error', {
        event: 'Identity.InviteAccept.UnmappedError',
        error:
          e instanceof Error
            ? {
                code: 'UNMAPPED_ERROR',
                message: e.message,
                ...(e.stack !== undefined ? { stack: e.stack } : {}),
              }
            : { code: 'UNMAPPED_ERROR', message: String(e) },
      });
      return errorResponse(c, 'TRANSACTION_FAILED', 'Internal failure', 500, correlationId);
    }
  });

  // ----- Phase A2.6: session routes ----------------------------------

  app.post('/api/v1/identity/session/refresh', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const cookie = parseSessionCookie(c.req.header('cookie'));
    if (!cookie) {
      return errorResponse(
        c,
        'SESSION_INVALID',
        'session is not valid',
        401,
        correlationId,
      );
    }
    // Custom-domain → tenant resolution should already have run, but
    // refresh is mounted public so we don't have a Principal here.
    // The caller's Host header is the only tenant signal — for now we
    // rely on the principal middleware's earlier hostTenantId
    // resolution to be reachable. Phase A2.10 wires this cleanly; for
    // now we accept a `tenantId` query param as fallback.
    const tenantId =
      c.get('hostTenantId') ?? c.req.query('tenantId') ?? state.config.tenantId;
    if (!tenantId) {
      return errorResponse(
        c,
        'PRINCIPAL_INVALID',
        'cannot resolve tenant for refresh',
        400,
        correlationId,
      );
    }
    let sql: import('postgres').Sql;
    try {
      sql = await ensureTenantMigrated(state, tenantId);
    } catch (e) {
      c.get('ctx').logger.warn('tenant migrate failed; returning 404', {
        event: 'Tenancy.EnsureMigrated.Failed',
        properties: {
          tenantId,
          route: 'identity.session-refresh',
          cause: errorMessage(e),
        },
      });
      return errorResponse(c, 'NOT_FOUND', 'tenant not found', 404, correlationId);
    }
    const eventStore = new PostgresEventStore(sql);
    const entities = new PostgresEntityStore(sql);
    const relations = new PostgresRelationStore(sql);
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
      c.req.header('x-real-ip') ??
      undefined;
    const userAgent = c.req.header('user-agent') ?? undefined;
    try {
      const result = await handleSessionRefresh(
        {
          tenantId,
          correlationId,
          sessionId: cookie.sessionId,
          presentedRefreshSecret: cookie.refreshSecret,
          ...(ip !== undefined ? { ip } : {}),
          ...(userAgent !== undefined ? { userAgent } : {}),
        },
        eventStore,
        entities,
      );
      const dispatch = identityDispatcher({ entities, relations });
      for (const f of result.follow) await dispatch(f);
      await dispatch(result.envelope);

      if (result.document && result.cookiePayload) {
        c.header(
          'Set-Cookie',
          buildSessionCookie({
            payload: result.cookiePayload,
            secure: !state.config.testAuth.enabled,
          }),
          { append: true },
        );
      }
      return c.json({
        sessionId: result.document?.sessionId,
        accessToken: result.plaintextAccessToken,
        accessTokenExpiresAt: result.document?.accessExpiresAt,
      });
    } catch (e) {
      if (e instanceof IdentityError) {
        // Reuse-detection / hard-timeout / idle-timeout all clear the
        // cookie so the client returns to the login page.
        c.header(
          'Set-Cookie',
          buildClearSessionCookie(!state.config.testAuth.enabled),
          { append: true },
        );
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      c.get('ctx').logger.error('identity session-refresh unmapped error', {
        event: 'Identity.SessionRefresh.UnmappedError',
        error:
          e instanceof Error
            ? {
                code: 'UNMAPPED_ERROR',
                message: e.message,
                ...(e.stack !== undefined ? { stack: e.stack } : {}),
              }
            : { code: 'UNMAPPED_ERROR', message: String(e) },
      });
      return errorResponse(c, 'TRANSACTION_FAILED', 'Internal failure', 500, correlationId);
    }
  });

  app.post('/api/v1/identity/session/logout', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    const cookie = parseSessionCookie(c.req.header('cookie'));
    if (!cookie || !principal) {
      // Still clear the cookie + 200 — logout is idempotent from the
      // client's perspective.
      c.header(
        'Set-Cookie',
        buildClearSessionCookie(!state.config.testAuth.enabled),
        { append: true },
      );
      return c.json({ ok: true }, 200);
    }
    let sql: import('postgres').Sql;
    try {
      sql = await ensureTenantMigrated(state, principal.tenantId);
    } catch (e) {
      c.get('ctx').logger.warn('tenant migrate failed; returning 404', {
        event: 'Tenancy.EnsureMigrated.Failed',
        properties: {
          tenantId: principal.tenantId,
          route: 'identity.session-logout',
          cause: errorMessage(e),
        },
      });
      return errorResponse(c, 'NOT_FOUND', 'tenant not found', 404, correlationId);
    }
    const eventStore = new PostgresEventStore(sql);
    const entities = new PostgresEntityStore(sql);
    const relations = new PostgresRelationStore(sql);
    try {
      const result = await handleSessionRevoke(
        {
          tenantId: principal.tenantId,
          correlationId,
          principalId: principal.principalId,
          sessionId: cookie.sessionId,
          reason: 'user_logout',
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
    } catch (e) {
      // Logout is best-effort — even if the session already ended,
      // we clear the cookie and respond 200.
      if (!(e instanceof IdentityError)) throw e;
    }
    c.header(
      'Set-Cookie',
      buildClearSessionCookie(!state.config.testAuth.enabled),
      { append: true },
    );
    return c.json({ ok: true }, 200);
  });

  return app;
}

/**
 * Identity routes that REQUIRE an authenticated principal. Mounted in
 * the authed group — principal middleware runs first, populating
 * `c.get('principal')`. Phase A2.10 extends the principal middleware
 * to authenticate via the session cookie (alongside JWT + debug); for
 * now this only works when the caller presents a JWT or
 * X-Debug-Principal.
 */
export function identityAuthedRoutes(
  state: AppState,
): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  app.get('/api/v1/identity/sessions', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal?.userId) {
      return errorResponse(
        c,
        'PRINCIPAL_INVALID',
        'missing userId',
        401,
        correlationId,
      );
    }
    const sql = await ensureTenantMigrated(state, principal.tenantId);
    const entities = new PostgresEntityStore(sql);
    const sessions = await listActiveSessionsForUser(
      entities,
      principal.tenantId,
      principal.userId,
    );
    // Strip secret material before serializing — client only needs the
    // metadata (ids, lifetimes, ip, userAgent).
    return c.json({
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        issuedAt: s.issuedAt,
        lastSeenAt: s.lastSeenAt,
        hardExpiresAt: s.hardExpiresAt,
        ip: s.ip,
        userAgent: s.userAgent,
      })),
    });
  });

  app.delete('/api/v1/identity/sessions/:sessionId', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal?.userId) {
      return errorResponse(
        c,
        'PRINCIPAL_INVALID',
        'missing userId',
        401,
        correlationId,
      );
    }
    const sessionId = c.req.param('sessionId');
    if (!sessionId) {
      return errorResponse(
        c,
        'SCHEMA_VALIDATION_FAILED',
        'sessionId is required',
        400,
        correlationId,
      );
    }
    const sql = await ensureTenantMigrated(state, principal.tenantId);
    const eventStore = new PostgresEventStore(sql);
    const entities = new PostgresEntityStore(sql);
    const relations = new PostgresRelationStore(sql);
    // Authorization: a User can only revoke their OWN sessions via
    // this route. Admin revoke goes through the standard intent path.
    const target = await getSessionEntity(entities, principal.tenantId, sessionId);
    if (!target || target.userId !== principal.userId) {
      return errorResponse(c, 'SESSION_NOT_FOUND', 'not your session', 404, correlationId);
    }
    try {
      const result = await handleSessionRevoke(
        {
          tenantId: principal.tenantId,
          correlationId,
          principalId: principal.principalId,
          sessionId,
          reason: 'user_logout',
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      return c.json({ ok: true }, 200);
    } catch (e) {
      if (e instanceof IdentityError) {
        const pub = publicIdentityCode(e.code);
        if (pub.code !== e.code) {
          return errorResponse(c, pub.code, pub.message, e.status, correlationId);
        }
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      throw e;
    }
  });

  return app;
}

// `identityRoutes` ends above. Authed routes follow.
