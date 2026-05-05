/**
 * IdentityProvider admin routes (Phase A3.8).
 *
 * Mounted in the AUTHED group — caller must be a TenantAdmin (cedar
 * policy enforces). All four mutating routes go through the standard
 * intent pipeline so authz + audit + idempotency apply uniformly.
 *
 * The REST surface is a convenience over `POST /api/v1/intents` —
 * an admin UI that prefers REST over the action-id intent shape can
 * use these directly.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  PostgresEntityStore,
  PostgresEventStore,
  PostgresRelationStore,
} from '@atlas/adapter-node';
import {
  handleIdpActivate,
  handleIdpConfigure,
  handleIdpDisable,
  handleIdpRotateJwks,
  identityDispatcher,
  listIdentityProviders,
  IdentityError,
} from '@atlas/identity';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse } from '../middleware/errors.ts';
import { correlationIdFor } from '../middleware/correlation.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

function readString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function identityIdpRoutes(
  state: AppState,
): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  app.get('/api/v1/identity/idps', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const sql = await ensureTenantMigrated(state, principal.tenantId);
    const entities = new PostgresEntityStore(sql);
    const idps = await listIdentityProviders(entities, principal.tenantId);
    return c.json({
      idps: idps.map((i) => ({
        idpId: i.idpId,
        kind: i.kind,
        displayName: i.displayName,
        issuer: i.issuer,
        audience: i.audience,
        status: i.status,
        priority: i.priority,
        requireInvite: i.requireInvite,
        defaultRolesOnFirstLogin: i.defaultRolesOnFirstLogin,
        roleMappings: i.roleMappings,
      })),
    });
  });

  app.post('/api/v1/identity/idps', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const displayName = readString(body['displayName']);
    const issuer = readString(body['issuer']);
    const audience = readString(body['audience']);
    if (!displayName || !issuer || !audience) {
      return errorResponse(
        c,
        'SCHEMA_VALIDATION_FAILED',
        'displayName, issuer, audience required',
        400,
        correlationId,
      );
    }
    const sql = await ensureTenantMigrated(state, principal.tenantId);
    const eventStore = new PostgresEventStore(sql);
    const entities = new PostgresEntityStore(sql);
    const relations = new PostgresRelationStore(sql);
    try {
      const result = await handleIdpConfigure(
        {
          tenantId: principal.tenantId,
          correlationId,
          principalId: principal.principalId,
          displayName,
          issuer,
          audience,
          ...(readString(body['jwksUri']) !== null
            ? { jwksUri: readString(body['jwksUri']) as string }
            : {}),
          ...(readString(body['groupClaimPath']) !== null
            ? { groupClaimPath: readString(body['groupClaimPath']) as string }
            : {}),
          ...(typeof body['requireInvite'] === 'boolean'
            ? { requireInvite: body['requireInvite'] as boolean }
            : {}),
          ...(Array.isArray(body['defaultRolesOnFirstLogin'])
            ? {
                defaultRolesOnFirstLogin: (body['defaultRolesOnFirstLogin'] as unknown[])
                  .filter((v): v is string => typeof v === 'string'),
              }
            : {}),
          ...(Array.isArray(body['roleMappings'])
            ? { roleMappings: body['roleMappings'] as never }
            : {}),
          ...(typeof body['priority'] === 'number'
            ? { priority: body['priority'] as number }
            : {}),
        },
        eventStore,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      return c.json({ idpId: result.document.idpId, status: result.document.status }, 201);
    } catch (e) {
      if (e instanceof IdentityError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      throw e;
    }
  });

  app.post('/api/v1/identity/idps/:idpId/activate', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const idpId = c.req.param('idpId') ?? '';
    const sql = await ensureTenantMigrated(state, principal.tenantId);
    const eventStore = new PostgresEventStore(sql);
    const entities = new PostgresEntityStore(sql);
    const relations = new PostgresRelationStore(sql);
    try {
      const result = await handleIdpActivate(
        {
          tenantId: principal.tenantId,
          correlationId,
          principalId: principal.principalId,
          idpId,
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      return c.json({ idpId: result.document.idpId, status: result.document.status });
    } catch (e) {
      if (e instanceof IdentityError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      throw e;
    }
  });

  app.post('/api/v1/identity/idps/:idpId/disable', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const idpId = c.req.param('idpId') ?? '';
    const sql = await ensureTenantMigrated(state, principal.tenantId);
    const eventStore = new PostgresEventStore(sql);
    const entities = new PostgresEntityStore(sql);
    const relations = new PostgresRelationStore(sql);
    try {
      const result = await handleIdpDisable(
        {
          tenantId: principal.tenantId,
          correlationId,
          principalId: principal.principalId,
          idpId,
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      return c.json({ idpId: result.document.idpId, status: result.document.status });
    } catch (e) {
      if (e instanceof IdentityError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      throw e;
    }
  });

  app.post('/api/v1/identity/idps/:idpId/rotate-jwks', async (c: AppCtx) => {
    const correlationId = correlationIdFor(c);
    const principal = c.get('principal');
    if (!principal) {
      return errorResponse(c, 'PRINCIPAL_INVALID', 'auth required', 401, correlationId);
    }
    const idpId = c.req.param('idpId') ?? '';
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const sql = await ensureTenantMigrated(state, principal.tenantId);
    const eventStore = new PostgresEventStore(sql);
    const entities = new PostgresEntityStore(sql);
    const relations = new PostgresRelationStore(sql);
    try {
      const result = await handleIdpRotateJwks(
        {
          tenantId: principal.tenantId,
          correlationId,
          principalId: principal.principalId,
          idpId,
          ...(readString(body['jwksUri']) !== null
            ? { jwksUri: readString(body['jwksUri']) as string }
            : {}),
        },
        eventStore,
        entities,
      );
      await identityDispatcher({ entities, relations })(result.envelope);
      return c.json({ idpId: result.document.idpId, rotated: true });
    } catch (e) {
      if (e instanceof IdentityError) {
        return errorResponse(c, e.code, e.message, e.status, correlationId);
      }
      throw e;
    }
  });

  return app;
}
