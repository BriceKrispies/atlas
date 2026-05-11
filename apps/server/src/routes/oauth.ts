/**
 * OAuth 2.0 routes (RFC 6749 + RFC 7009).
 *
 * Phase A2.9 ships only the `client_credentials` grant. No
 * `password`, no `authorization_code`, no `refresh_token` (sessions
 * have their own refresh path). The wire shape is the standard OAuth
 * one — token responses look identical to a real OAuth/2 server even
 * though the access token is opaque (not a JWT) under the hood.
 *
 * Mounted PUBLIC: the request is authenticated by the
 * client_id + client_secret in the body. Tenant resolution comes from
 * either:
 *   - the host header (custom-domains stub) → preferred
 *   - the `client_id` itself (we look up which tenant owns the
 *     ApiKey) → fallback
 *
 * For Phase A2 we keep it simple: accept a `tenant_id` query param
 * when neither path resolves. Clean up in A3 alongside per-tenant
 * IDP federation.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  PostgresEntityStore,
  PostgresEventStore,
  PostgresRelationStore,
} from '@atlas/adapter-node';
import {
  handleOAuthIssueToken,
  handleOAuthRevokeToken,
  identityDispatcher,
  IdentityError,
} from '@atlas/identity';
import { PLATFORM_ROBOT_PRINCIPAL_ID } from '@atlas/platform-core';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

/**
 * RFC 6749-shaped error envelope. The OAuth spec mandates
 * `error` + optional `error_description` keys on the JSON body —
 * NOT the Atlas standard error envelope. The error codes are also
 * snake_case spec strings.
 */
function oauthError(
  c: AppCtx,
  error: string,
  description: string,
  status: number,
): Response {
  return c.json(
    { error, error_description: description },
    status as 400 | 401 | 403 | 404 | 500,
  );
}

const ATLAS_TO_OAUTH_ERROR: Record<string, { code: string; status: number }> = {
  OAUTH_INVALID_GRANT: { code: 'invalid_grant', status: 400 },
  OAUTH_INVALID_CLIENT: { code: 'invalid_client', status: 401 },
  OAUTH_INVALID_SCOPE: { code: 'invalid_scope', status: 400 },
  OAUTH_UNSUPPORTED_GRANT_TYPE: { code: 'unsupported_grant_type', status: 400 },
  API_KEY_EXPIRED: { code: 'invalid_client', status: 401 },
  API_KEY_REVOKED: { code: 'invalid_client', status: 401 },
};

function tenantIdFromContext(c: AppCtx, state: AppState): string | null {
  const host = c.get('hostTenantId');
  if (host) return host;
  const q = c.req.query('tenant_id');
  if (q) return q;
  return state.config.tenantId ?? null;
}

export function oauthRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  // POST /oauth/token — RFC 6749 §4.4 client_credentials.
  // Accepts `application/x-www-form-urlencoded` (the spec's MUST) AND
  // `application/json` (a common deviation that's ergonomic).
  app.post('/oauth/token', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const tenantId = tenantIdFromContext(c, state);
    if (!tenantId) {
      return oauthError(c, 'invalid_request', 'tenant unresolved', 400);
    }

    let grantType: string | undefined;
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    let scope: string | undefined;
    const contentType = c.req.header('content-type') ?? '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const form = await c.req.parseBody();
      grantType = typeof form['grant_type'] === 'string' ? (form['grant_type'] as string) : undefined;
      clientId = typeof form['client_id'] === 'string' ? (form['client_id'] as string) : undefined;
      clientSecret = typeof form['client_secret'] === 'string' ? (form['client_secret'] as string) : undefined;
      scope = typeof form['scope'] === 'string' ? (form['scope'] as string) : undefined;
    } else {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      grantType = typeof body['grant_type'] === 'string' ? (body['grant_type'] as string) : undefined;
      clientId = typeof body['client_id'] === 'string' ? (body['client_id'] as string) : undefined;
      clientSecret = typeof body['client_secret'] === 'string' ? (body['client_secret'] as string) : undefined;
      scope = typeof body['scope'] === 'string' ? (body['scope'] as string) : undefined;
    }

    // HTTP Basic auth fallback for client credentials (RFC 6749 §2.3.1).
    const authHeader = c.req.header('authorization');
    if (!clientId && !clientSecret && authHeader?.toLowerCase().startsWith('basic ')) {
      try {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        const colon = decoded.indexOf(':');
        if (colon > 0) {
          clientId = decoded.slice(0, colon);
          clientSecret = decoded.slice(colon + 1);
        }
      } catch {
        // Falls through to invalid_client below.
      }
    }

    if (grantType !== 'client_credentials') {
      return oauthError(
        c,
        'unsupported_grant_type',
        `grant_type must be client_credentials (got ${grantType ?? 'missing'})`,
        400,
      );
    }
    if (!clientId || !clientSecret) {
      return oauthError(c, 'invalid_client', 'missing client_id / client_secret', 401);
    }

    let sql: import('postgres').Sql;
    try {
      sql = await ensureTenantMigrated(state, tenantId);
    } catch (e) {
      c.get('ctx').logger.warn('tenant migrate failed; returning 404', {
        event: 'Tenancy.EnsureMigrated.Failed',
        properties: {
          tenantId,
          route: 'oauth.token',
          cause: (e as Error).message,
        },
      });
      return oauthError(c, 'invalid_request', 'tenant not found', 404);
    }
    const eventStore = new PostgresEventStore(sql);
    const entities = new PostgresEntityStore(sql);
    const relations = new PostgresRelationStore(sql);

    try {
      const result = await handleOAuthIssueToken(
        {
          tenantId,
          correlationId,
          clientId,
          clientSecret,
          ...(scope ? { requestedScopes: scope.split(/\s+/).filter(Boolean) } : {}),
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      return c.json(result.response);
    } catch (e) {
      if (e instanceof IdentityError) {
        const map = ATLAS_TO_OAUTH_ERROR[e.code];
        if (map) {
          return oauthError(c, map.code, e.message, map.status);
        }
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      c.get('ctx').logger.error('oauth token unmapped error', {
        event: 'OAuth.Token.UnmappedError',
        error:
          e instanceof Error
            ? {
                code: 'UNMAPPED_ERROR',
                message: e.message,
                ...(e.stack !== undefined ? { stack: e.stack } : {}),
              }
            : { code: 'UNMAPPED_ERROR', message: String(e) },
      });
      return oauthError(c, 'server_error', 'internal failure', 500);
    }
  });

  // POST /oauth/revoke — RFC 7009. Spec says respond 200 even for
  // unknown tokens; the handler returns null envelope in that case.
  app.post('/oauth/revoke', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const tenantId = tenantIdFromContext(c, state);
    if (!tenantId) {
      return oauthError(c, 'invalid_request', 'tenant unresolved', 400);
    }
    let token: string | undefined;
    const contentType = c.req.header('content-type') ?? '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const form = await c.req.parseBody();
      token = typeof form['token'] === 'string' ? (form['token'] as string) : undefined;
    } else {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      token = typeof body['token'] === 'string' ? (body['token'] as string) : undefined;
    }
    if (!token) {
      return oauthError(c, 'invalid_request', 'missing token', 400);
    }
    let sql: import('postgres').Sql;
    try {
      sql = await ensureTenantMigrated(state, tenantId);
    } catch (e) {
      c.get('ctx').logger.warn('tenant migrate failed; returning 404', {
        event: 'Tenancy.EnsureMigrated.Failed',
        properties: {
          tenantId,
          route: 'oauth.revoke',
          cause: (e as Error).message,
        },
      });
      return oauthError(c, 'invalid_request', 'tenant not found', 404);
    }
    const eventStore = new PostgresEventStore(sql);
    const entities = new PostgresEntityStore(sql);
    const relations = new PostgresRelationStore(sql);
    const result = await handleOAuthRevokeToken(
      {
        tenantId,
        correlationId,
        // Public revoke endpoint — caller is the OAuth client (auth via
        // client_id/secret), not a User. The bootstrap robot stands in
        // as principal so audit gets a real actor (ADR 0008 §2).
        principalId: PLATFORM_ROBOT_PRINCIPAL_ID,
        presentedToken: token,
      },
      eventStore,
      entities,
    );
    if (result.envelope) {
      await identityDispatcher({ entities, relations })(result.envelope);
    }
    // Always 200 per RFC 7009 §2.2.
    return c.body(null, 200);
  });

  return app;
}
