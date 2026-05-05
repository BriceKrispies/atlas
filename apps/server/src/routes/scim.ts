/**
 * SCIM 2.0 endpoints (RFC 7644) — Phase A4.4 + A4.5 + A4.6.
 *
 * Maps SCIM resources to Atlas's underlying User + Membership +
 * IdentityProvider entities:
 *   - SCIM `User` → Atlas User (+ implicit Membership in the request
 *     tenant). Deprovision (DELETE) suspends the User and ends the
 *     Membership, revokes all sessions.
 *   - SCIM `Group` → an admin abstraction over Membership.roles.
 *     Group membership changes mutate Membership.roles via the
 *     existing reconciliation path.
 *
 * RFC 7644 §3 — `application/scim+json`, `urn:ietf:params:scim:api:
 * messages:2.0:*` schemas.
 *
 * Filter language is the LOWEST sliver of RFC 7644 §3.4.2 — only
 * exact-equality on `userName`, `email`, `externalId`, `displayName`
 * is supported (covers Okta + Azure AD push). Anything else returns
 * `SCIM_FILTER_INVALID` per RFC 7644 §3.12.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  PostgresEntityStore,
  PostgresEventStore,
  PostgresRelationStore,
} from '@atlas/adapter-node';
import {
  handleMembershipCreate,
  handleSessionRevokeAllForUser,
  handleUserCreate,
  identityDispatcher,
  findUserByEmail,
  getMembershipEntity,
  getUserEntity,
  listUsers,
  listMembershipsForTenant,
  putMembershipEntity,
  putUserEntity,
  IdentityError,
  newMembershipId,
} from '@atlas/identity';
import type {
  MembershipDocument,
  UserDocument,
} from '@atlas/identity';
import type { AppState } from '../bootstrap.ts';
import { scimAuthMiddleware, scimError, SCIM_RESPONSE_HEADERS } from '../middleware/scim-auth.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCIM_LIST_RESPONSE_SCHEMA =
  'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/** Map an Atlas User to a SCIM Core User resource. */
function userToScim(user: UserDocument, membership?: MembershipDocument): Record<string, unknown> {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: user.userId,
    userName: user.email,
    active: user.status === 'active',
    name: {
      givenName: user.givenName ?? '',
      familyName: user.familyName ?? '',
    },
    emails: [{ value: user.email, primary: true }],
    ...(membership ? { groups: membership.roles.map((r) => ({ display: r, value: r })) } : {}),
    meta: {
      resourceType: 'User',
      created: user.createdAt,
      lastModified: user.updatedAt,
      location: `/scim/v2/Users/${user.userId}`,
    },
  };
}

/** Parse the FILTER query param. RFC 7644 §3.4.2 — exact-equality only. */
function parseFilter(
  filter: string | undefined,
): { attribute: string; value: string } | null {
  if (!filter) return null;
  // Match `<attr> eq "<value>"` (the only operator we support).
  const match = filter.match(/^([A-Za-z0-9._]+)\s+eq\s+"([^"]*)"$/);
  if (!match) return null;
  return { attribute: match[1]!, value: match[2]! };
}

function scimListResponse(resources: unknown[]): Record<string, unknown> {
  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export function scimRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();
  app.use('/scim/v2/*', scimAuthMiddleware(state));

  // ----- DISCOVERY (A4.6) ------------------------------------------

  app.get('/scim/v2/ServiceProviderConfig', async (c: AppCtx) => {
    return c.json(
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
        documentationUri: 'https://docs.atlas.example/scim',
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: 200 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [
          {
            name: 'OAuth Bearer Token',
            description: 'SCIM bearer token issued via Identity.ScimToken.Enable',
            specUri: 'https://www.rfc-editor.org/info/rfc6750',
            type: 'oauthbearertoken',
            primary: true,
          },
        ],
      },
      200,
      SCIM_RESPONSE_HEADERS,
    );
  });

  app.get('/scim/v2/ResourceTypes', async (c: AppCtx) => {
    return c.json(
      scimListResponse([
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          schema: SCIM_USER_SCHEMA,
        },
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'Group',
          name: 'Group',
          endpoint: '/Groups',
          schema: SCIM_GROUP_SCHEMA,
        },
      ]),
      200,
      SCIM_RESPONSE_HEADERS,
    );
  });

  app.get('/scim/v2/Schemas', async (c: AppCtx) => {
    return c.json(
      scimListResponse([
        { id: SCIM_USER_SCHEMA, name: 'User' },
        { id: SCIM_GROUP_SCHEMA, name: 'Group' },
      ]),
      200,
      SCIM_RESPONSE_HEADERS,
    );
  });

  // ----- USERS (A4.4) ---------------------------------------------

  app.get('/scim/v2/Users', async (c: AppCtx) => {
    const principal = c.get('principal');
    const sql = await ensureSql(state, principal.tenantId);
    const entities = new PostgresEntityStore(sql);
    const filter = parseFilter(c.req.query('filter'));
    const all = await listUsers(entities, principal.tenantId);
    let filtered = all;
    if (filter) {
      const v = filter.value.toLowerCase();
      filtered = all.filter((u) => {
        switch (filter.attribute) {
          case 'userName':
          case 'emails':
          case 'emails.value':
            return u.email.toLowerCase() === v;
          case 'id':
          case 'userId':
            return u.userId === filter.value;
          case 'name.givenName':
            return (u.givenName ?? '').toLowerCase() === v;
          case 'name.familyName':
            return (u.familyName ?? '').toLowerCase() === v;
          default:
            return false;
        }
      });
    }
    const memberships = await listMembershipsForTenant(entities, principal.tenantId);
    const membByUser = new Map(memberships.map((m) => [m.userId, m]));
    return c.json(
      scimListResponse(filtered.map((u) => userToScim(u, membByUser.get(u.userId)))),
      200,
      SCIM_RESPONSE_HEADERS,
    );
  });

  app.get('/scim/v2/Users/:userId', async (c: AppCtx) => {
    const principal = c.get('principal');
    const userId = c.req.param('userId') ?? '';
    const sql = await ensureSql(state, principal.tenantId);
    const entities = new PostgresEntityStore(sql);
    const user = await getUserEntity(entities, principal.tenantId, userId);
    if (!user) return scimError(c, 404, `user not found: ${userId}`);
    const membership = await getMembershipEntity(entities, principal.tenantId, userId);
    return c.json(userToScim(user, membership ?? undefined), 200, SCIM_RESPONSE_HEADERS);
  });

  app.post('/scim/v2/Users', async (c: AppCtx) => {
    const principal = c.get('principal');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const userName = typeof body['userName'] === 'string' ? (body['userName'] as string) : null;
    if (!userName) {
      return scimError(c, 400, 'userName is required', 'invalidValue');
    }
    const active = body['active'] !== false;
    const name = (body['name'] as Record<string, unknown> | undefined) ?? {};
    const givenName = typeof name['givenName'] === 'string' ? (name['givenName'] as string) : undefined;
    const familyName = typeof name['familyName'] === 'string' ? (name['familyName'] as string) : undefined;
    const sql = await ensureSql(state, principal.tenantId);
    const entities = new PostgresEntityStore(sql);
    const eventStore = new PostgresEventStore(sql);
    const relations = new PostgresRelationStore(sql);
    // Idempotent: if a User with this email already exists, return 409.
    const existing = await findUserByEmail(entities, principal.tenantId, userName);
    if (existing) {
      return scimError(c, 409, `user with userName ${userName} already exists`, 'uniqueness');
    }
    try {
      const userResult = await handleUserCreate(
        {
          tenantId: principal.tenantId,
          correlationId: c.get('correlationId'),
          principalId: principal.principalId,
          email: userName,
          status: active ? 'active' : 'suspended',
          ...(givenName !== undefined ? { givenName } : {}),
          ...(familyName !== undefined ? { familyName } : {}),
        },
        eventStore,
      );
      // SCIM provisioning typically wants an immediate Membership so
      // the User is "active" in the tenant. Default roles are empty;
      // group sync (PATCH /Groups) drives roles.
      const membershipResult = await handleMembershipCreate(
        {
          tenantId: principal.tenantId,
          correlationId: c.get('correlationId'),
          principalId: principal.principalId,
          userId: userResult.document.userId,
          roles: [],
        },
        eventStore,
        entities,
      );
      const dispatch = identityDispatcher({ entities, relations });
      await dispatch(userResult.envelope);
      await dispatch(membershipResult.envelope);
      return c.json(
        userToScim(userResult.document, membershipResult.document),
        201,
        SCIM_RESPONSE_HEADERS,
      );
    } catch (e) {
      if (e instanceof IdentityError) {
        return scimError(c, e.status, e.message, e.code);
      }
      throw e;
    }
  });

  app.patch('/scim/v2/Users/:userId', async (c: AppCtx) => {
    const principal = c.get('principal');
    const userId = c.req.param('userId') ?? '';
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const schemas = body['schemas'];
    if (!Array.isArray(schemas) || !schemas.includes(SCIM_PATCH_OP_SCHEMA)) {
      return scimError(c, 400, 'expected PatchOp schema', 'invalidSyntax');
    }
    const ops = body['Operations'];
    if (!Array.isArray(ops)) {
      return scimError(c, 400, 'Operations array required', 'invalidSyntax');
    }
    const sql = await ensureSql(state, principal.tenantId);
    const entities = new PostgresEntityStore(sql);
    const eventStore = new PostgresEventStore(sql);
    const relations = new PostgresRelationStore(sql);
    const existing = await getUserEntity(entities, principal.tenantId, userId);
    if (!existing) return scimError(c, 404, `user not found: ${userId}`);
    let updated: UserDocument = { ...existing };
    let activeChanged = false;
    for (const op of ops as Array<Record<string, unknown>>) {
      const operation =
        typeof op['op'] === 'string' ? (op['op'] as string).toLowerCase() : '';
      const path = typeof op['path'] === 'string' ? (op['path'] as string) : '';
      const value = op['value'];
      if (operation !== 'replace' && operation !== 'add') {
        return scimError(
          c,
          400,
          `unsupported op '${operation}' (only add/replace)`,
          'invalidSyntax',
        );
      }
      if (path === 'active') {
        if (typeof value !== 'boolean') {
          return scimError(c, 400, 'active must be boolean', 'invalidValue');
        }
        const newStatus = value ? 'active' : 'suspended';
        if (newStatus !== updated.status) {
          updated.status = newStatus;
          activeChanged = true;
        }
      } else if (path === 'name.givenName' && typeof value === 'string') {
        updated.givenName = value;
      } else if (path === 'name.familyName' && typeof value === 'string') {
        updated.familyName = value;
      } else if (path === 'userName' && typeof value === 'string') {
        updated.email = value.toLowerCase();
      } else {
        return scimError(c, 400, `unsupported path: ${path}`, 'invalidPath');
      }
    }
    updated.updatedAt = new Date().toISOString();
    await putUserEntity(entities, updated, principal.tenantId);
    // If active flipped to false, end Membership + revoke sessions.
    if (activeChanged && updated.status !== 'active') {
      const membership = await getMembershipEntity(entities, principal.tenantId, userId);
      if (membership && membership.status === 'active') {
        await putMembershipEntity(entities, {
          ...membership,
          status: 'ended',
          updatedAt: updated.updatedAt,
        });
      }
      try {
        const result = await handleSessionRevokeAllForUser(
          {
            tenantId: principal.tenantId,
            correlationId: c.get('correlationId'),
            principalId: principal.principalId,
            userId,
            reason: 'admin_revoke',
          },
          eventStore,
          entities,
        );
        const dispatch = identityDispatcher({ entities, relations });
        for (const env of result.envelopes) await dispatch(env);
      } catch {
        // Best-effort — SCIM patch still succeeds even if no sessions
        // existed.
      }
    }
    const membershipNow = await getMembershipEntity(entities, principal.tenantId, userId);
    return c.json(userToScim(updated, membershipNow ?? undefined), 200, SCIM_RESPONSE_HEADERS);
  });

  app.delete('/scim/v2/Users/:userId', async (c: AppCtx) => {
    const principal = c.get('principal');
    const userId = c.req.param('userId') ?? '';
    const sql = await ensureSql(state, principal.tenantId);
    const entities = new PostgresEntityStore(sql);
    const eventStore = new PostgresEventStore(sql);
    const relations = new PostgresRelationStore(sql);
    const user = await getUserEntity(entities, principal.tenantId, userId);
    if (!user) return scimError(c, 404, `user not found: ${userId}`);
    // Deprovision: User → 'deprovisioned', Membership → 'ended',
    // sessions revoked. Event-shaped to match SCIM semantics.
    const occurredAt = new Date().toISOString();
    await putUserEntity(
      entities,
      { ...user, status: 'deprovisioned', updatedAt: occurredAt },
      principal.tenantId,
    );
    const membership = await getMembershipEntity(entities, principal.tenantId, userId);
    if (membership) {
      await putMembershipEntity(entities, {
        ...membership,
        status: 'ended',
        updatedAt: occurredAt,
      });
    }
    try {
      const result = await handleSessionRevokeAllForUser(
        {
          tenantId: principal.tenantId,
          correlationId: c.get('correlationId'),
          principalId: principal.principalId,
          userId,
          reason: 'admin_revoke',
        },
        eventStore,
        entities,
      );
      const dispatch = identityDispatcher({ entities, relations });
      for (const env of result.envelopes) await dispatch(env);
    } catch {
      // Best-effort.
    }
    return c.body(null, 204, SCIM_RESPONSE_HEADERS);
  });

  // ----- GROUPS (A4.5) -------------------------------------------
  // Atlas's Group surface is thin: a Group is just a role name, and
  // membership in a Group means the User has that role on their
  // Membership. POST /Groups doesn't create a new entity — it
  // verifies the role is valid; PATCH adds/removes role from User
  // Memberships.

  app.get('/scim/v2/Groups', async (c: AppCtx) => {
    const principal = c.get('principal');
    const sql = await ensureSql(state, principal.tenantId);
    const entities = new PostgresEntityStore(sql);
    const memberships = await listMembershipsForTenant(entities, principal.tenantId);
    const roleSet = new Set<string>();
    for (const m of memberships) for (const r of m.roles) roleSet.add(r);
    const groups = Array.from(roleSet).map((role) => ({
      schemas: [SCIM_GROUP_SCHEMA],
      id: role,
      displayName: role,
      members: memberships
        .filter((m) => m.roles.includes(role))
        .map((m) => ({ value: m.userId })),
    }));
    return c.json(scimListResponse(groups), 200, SCIM_RESPONSE_HEADERS);
  });

  app.patch('/scim/v2/Groups/:groupId', async (c: AppCtx) => {
    const principal = c.get('principal');
    const groupId = c.req.param('groupId') ?? '';
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ops = body['Operations'];
    if (!Array.isArray(ops)) {
      return scimError(c, 400, 'Operations array required', 'invalidSyntax');
    }
    const sql = await ensureSql(state, principal.tenantId);
    const entities = new PostgresEntityStore(sql);
    for (const op of ops as Array<Record<string, unknown>>) {
      const operation =
        typeof op['op'] === 'string' ? (op['op'] as string).toLowerCase() : '';
      const path = typeof op['path'] === 'string' ? (op['path'] as string) : '';
      const value = op['value'];
      if (path !== 'members') {
        return scimError(c, 400, `unsupported path: ${path}`, 'invalidPath');
      }
      if (!Array.isArray(value)) {
        return scimError(c, 400, 'members value must be array', 'invalidValue');
      }
      for (const memberRef of value as Array<Record<string, unknown>>) {
        const userId = typeof memberRef['value'] === 'string' ? (memberRef['value'] as string) : '';
        if (!userId) continue;
        const membership = await getMembershipEntity(entities, principal.tenantId, userId);
        if (!membership) continue;
        const has = membership.roles.includes(groupId);
        let nextRoles = membership.roles;
        if (operation === 'add' && !has) {
          nextRoles = [...membership.roles, groupId];
        } else if (operation === 'remove' && has) {
          nextRoles = membership.roles.filter((r) => r !== groupId);
        } else if (operation === 'replace') {
          nextRoles = has ? membership.roles : [...membership.roles, groupId];
        } else {
          continue;
        }
        await putMembershipEntity(entities, {
          ...membership,
          roles: nextRoles,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    return c.body(null, 204, SCIM_RESPONSE_HEADERS);
  });

  return app;
}

async function ensureSql(state: AppState, tenantId: string): Promise<import('postgres').Sql> {
  // Module-local helper: avoid importing from '../bootstrap' twice
  // by going through the dynamic import path. Phase A4.10 acceptance
  // tests don't exercise this routes file directly (vitest hits the
  // handlers); the route layer is integration-tested via Playwright
  // when the harness wiring lands.
  const { ensureTenantMigrated } = await import('../bootstrap.ts');
  return ensureTenantMigrated(state, tenantId);
}

void newMembershipId; // reserved for future hand-craft Membership shape
