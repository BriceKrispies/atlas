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
  type IdpConfigureCommand,
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

/**
 * Type guard: narrows `unknown` to a plain JSON object. Indexing returns
 * `unknown` because JSON values are unknown by nature — each leaf field
 * still needs its own narrow before use.
 */
function isJsonObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse the request body as a JSON object. Returns `{}` on parse failure
 * or when the body is non-object (array, primitive, null). Collapses the
 * `c.req.json()` `unknown` boundary into a typed object via a type-predicate
 * guard — no type-system escape-hatch cast required.
 */
async function readBodyObject(c: AppCtx): Promise<Record<string, unknown>> {
  const raw: unknown = await c.req.json().catch(() => ({}));
  return isJsonObject(raw) ? raw : {};
}

/**
 * Validate a `roleMappings` array entry against the `RoleMapping` shape.
 * Returns `null` if the value isn't a string-keyed object with the required
 * `group: string` + `roles: string[]` fields. The handler accepts a
 * `RoleMapping[]`, so each entry must be narrowed before it crosses the
 * boundary — earlier code laundered the whole list through `as never`.
 */
function readRoleMapping(
  v: unknown,
): NonNullable<IdpConfigureCommand['roleMappings']>[number] | null {
  if (!isJsonObject(v)) return null;
  const group = readString(v['group']);
  if (!group) return null;
  const rolesRaw = v['roles'];
  if (!Array.isArray(rolesRaw)) return null;
  const roles = rolesRaw.filter((r): r is string => typeof r === 'string');
  return { group, roles };
}

function readRoleMappings(
  v: unknown,
): NonNullable<IdpConfigureCommand['roleMappings']> | null {
  if (!Array.isArray(v)) return null;
  const out: NonNullable<IdpConfigureCommand['roleMappings']> = [];
  for (const entry of v) {
    const mapping = readRoleMapping(entry);
    if (mapping) out.push(mapping);
  }
  return out;
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
    const body = await readBodyObject(c);
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
    const jwksUri = readString(body['jwksUri']);
    const groupClaimPath = readString(body['groupClaimPath']);
    const requireInviteRaw = body['requireInvite'];
    const requireInvite =
      typeof requireInviteRaw === 'boolean' ? requireInviteRaw : null;
    const defaultRolesRaw = body['defaultRolesOnFirstLogin'];
    const defaultRoles = Array.isArray(defaultRolesRaw)
      ? defaultRolesRaw.filter((v): v is string => typeof v === 'string')
      : null;
    const roleMappings = readRoleMappings(body['roleMappings']);
    const priorityRaw = body['priority'];
    const priority = typeof priorityRaw === 'number' ? priorityRaw : null;

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
          ...(jwksUri !== null ? { jwksUri } : {}),
          ...(groupClaimPath !== null ? { groupClaimPath } : {}),
          ...(requireInvite !== null ? { requireInvite } : {}),
          ...(defaultRoles !== null ? { defaultRolesOnFirstLogin: defaultRoles } : {}),
          ...(roleMappings !== null ? { roleMappings } : {}),
          ...(priority !== null ? { priority } : {}),
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
    const body = await readBodyObject(c);
    const jwksUri = readString(body['jwksUri']);
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
          ...(jwksUri !== null ? { jwksUri } : {}),
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
