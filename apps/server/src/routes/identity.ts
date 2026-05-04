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
  identityDispatcher,
  IdentityError,
} from '@atlas/identity';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

interface InviteAcceptBody {
  tenantId?: unknown;
  presentedToken?: unknown;
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
    if (!tenantId) {
      return errorResponse(
        c,
        'SCHEMA_VALIDATION_FAILED',
        'tenantId is required',
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

    // Ensure the tenant exists + has migrations applied. `ensureTenantMigrated`
    // throws if the tenant isn't in `control_plane.tenants` — surface as
    // 404 rather than leaking the underlying postgres error.
    let sql: import('postgres').Sql;
    try {
      sql = await ensureTenantMigrated(state, tenantId);
    } catch {
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
      const result = await handleInviteAccept(
        {
          tenantId,
          correlationId,
          principalId: null,
          presentedToken,
          ...(idpSubject !== null ? { primaryIdpSubject: idpSubject } : {}),
          ...(givenName !== null ? { givenName } : {}),
          ...(familyName !== null ? { familyName } : {}),
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

      return c.json(
        {
          userId: result.user.userId,
          tenantId,
          email: result.user.email,
          membershipRoles: result.membership.roles,
        },
        201,
      );
    } catch (e) {
      if (e instanceof IdentityError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      console.error('[identity.invite.accept] unmapped', {
        correlationId,
        error: e instanceof Error ? { message: e.message, stack: e.stack } : e,
      });
      return errorResponse(c, 'TRANSACTION_FAILED', 'Internal failure', 500, correlationId);
    }
  });

  return app;
}
