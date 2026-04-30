/**
 * Test-only debug routes. Registered only when both
 * `TEST_AUTH_ENABLED=true` AND `DEBUG_AUTH_ENDPOINT_ENABLED=true`.
 *
 * Mirrors the Rust ingress debug surface (see
 * `crates/ingress/src/main.rs::debug_search_index` and friends). When the
 * env gate is off these routes simply aren't mounted, so an unauthorised
 * caller hits the standard 404 fall-through.
 *
 * Endpoints:
 *   GET  /debug/whoami                  — principal echo (legacy)
 *   GET  /debug/events/:eventId         — raw EventEnvelope incl. cache tags
 *   POST /debug/search/index            — write raw search document
 *   POST /debug/search/rebuild          — truncate search docs for tenant
 *   POST /debug/cache/clear             — flush tenant cache entries
 *   POST /debug/render-tree/clear       — drop the in-memory render-tree
 *                                         fast path for a (tenant, page).
 *                                         Used by the persistence-parity
 *                                         scenario to prove the durable
 *                                         RenderTreeStore fallback works.
 *
 * Tenant isolation: the principal's `tenantId` is the only tenant any
 * endpoint touches. `/debug/search/index` rewrites `doc.tenantId` to match
 * (Rust counterpart does the same — see `debug_search_index`). The event
 * lookup also enforces tenant scoping by rejecting envelopes whose
 * `tenantId` differs from the caller's.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  PostgresEventStore,
  PostgresProjectionStore,
  PostgresSearchEngine,
} from '@atlas/adapters-node';
import {
  renderTreeKey as contentRenderTreeKey,
} from '@atlas/content-pages';
import type { SearchDocument } from '@atlas/platform-core';
import type { AppState } from '../bootstrap.ts';
import { ensureTenantMigrated } from '../bootstrap.ts';
import { errorResponse, mapError } from '../middleware/errors.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

interface IndexBody {
  documentId?: unknown;
  documentType?: unknown;
  tenantId?: unknown;
  fields?: unknown;
  permissionAttributes?: unknown;
}

function parseSearchDocument(
  body: IndexBody,
  forcedTenantId: string,
): SearchDocument | string {
  if (typeof body.documentId !== 'string' || body.documentId === '') {
    return 'documentId must be a non-empty string';
  }
  if (typeof body.documentType !== 'string' || body.documentType === '') {
    return 'documentType must be a non-empty string';
  }
  if (
    typeof body.fields !== 'object' ||
    body.fields === null ||
    Array.isArray(body.fields)
  ) {
    return 'fields must be an object';
  }
  let permissionAttributes: SearchDocument['permissionAttributes'] = null;
  if (body.permissionAttributes !== undefined && body.permissionAttributes !== null) {
    const pa = body.permissionAttributes as { allowedPrincipals?: unknown };
    if (
      typeof pa !== 'object' ||
      pa === null ||
      !Array.isArray(pa.allowedPrincipals) ||
      !pa.allowedPrincipals.every((x): x is string => typeof x === 'string')
    ) {
      return 'permissionAttributes.allowedPrincipals must be an array of strings';
    }
    permissionAttributes = { allowedPrincipals: pa.allowedPrincipals };
  }
  return {
    documentId: body.documentId,
    documentType: body.documentType,
    tenantId: forcedTenantId,
    fields: body.fields as Record<string, unknown>,
    permissionAttributes,
  };
}

export function debugRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  app.get('/debug/whoami', (c: AppCtx) => {
    const principal = c.get('principal');
    return c.json({
      principalId: principal.principalId,
      tenantId: principal.tenantId,
    });
  });

  // GET /debug/events/:eventId — return the raw EventEnvelope (incl.
  // cacheInvalidationTags). Tenant-scoped: a 404 is returned if the event
  // belongs to a different tenant, so this surface cannot be used to peek
  // across tenants.
  app.get('/debug/events/:eventId', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const eventId = c.req.param('eventId') ?? '';
    if (!eventId) {
      return errorResponse(c, 'BAD_REQUEST', 'eventId is required', 400, correlationId);
    }
    try {
      const sql = await ensureTenantMigrated(state, principal.tenantId);
      const eventStore = new PostgresEventStore(sql);
      const envelope = await eventStore.getEvent(eventId);
      if (!envelope) {
        return errorResponse(c, 'NOT_FOUND', `event '${eventId}' not found`, 404, correlationId);
      }
      if (envelope.tenantId !== principal.tenantId) {
        // Don't leak existence across tenants.
        return errorResponse(c, 'NOT_FOUND', `event '${eventId}' not found`, 404, correlationId);
      }
      return c.json(envelope);
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  // POST /debug/search/index — direct index path used by the catalog_search
  // permission-filter parity scenario. Forces the document tenant id to the
  // caller's tenant (mirrors the Rust counterpart).
  app.post('/debug/search/index', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    let body: IndexBody;
    try {
      body = (await c.req.json()) as IndexBody;
    } catch (e) {
      return errorResponse(
        c,
        'BAD_REQUEST',
        `Invalid JSON body: ${(e as Error).message}`,
        400,
        correlationId,
      );
    }
    const parsed = parseSearchDocument(body, principal.tenantId);
    if (typeof parsed === 'string') {
      return errorResponse(c, 'BAD_REQUEST', parsed, 400, correlationId);
    }
    try {
      const sql = await ensureTenantMigrated(state, principal.tenantId);
      const search = new PostgresSearchEngine(sql);
      await search.index(parsed);
      return c.json({ indexed: true }, 202);
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  // POST /debug/search/rebuild — truncate the search docs for the caller's
  // tenant. Tests follow this with a fresh seed apply to assert that the
  // rebuilt index is deterministic.
  app.post('/debug/search/rebuild', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    try {
      const sql = await ensureTenantMigrated(state, principal.tenantId);
      const result = await sql`
        DELETE FROM catalog_search_documents
        WHERE tenant_id = ${principal.tenantId}
      `;
      return c.json({ truncated: true, deleted: result.count });
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  // POST /debug/cache/clear — flush the cache for the caller's tenant.
  // PostgresCache has no per-tenant flush surface, so we mirror the
  // `invalidateByTags(['Tenant:{tenantId}'])` semantics that every cache
  // writer in the platform already uses (see `Tenant:{tenantId}` tag
  // convention in @atlas/catalog / @atlas/authz).
  app.post('/debug/cache/clear', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    try {
      const sql = await ensureTenantMigrated(state, principal.tenantId);
      const tag = `Tenant:${principal.tenantId}`;
      const result = await sql`
        DELETE FROM cache_entries
        WHERE tags && ${[tag]}::text[]
      `;
      return c.json({ cleared: true, deleted: result.count });
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  // POST /debug/render-tree/clear?pageId=... — drop the in-memory
  // render-tree projection for the caller's (tenant, pageId) pair.
  // The durable RenderTreeStore is left intact, so subsequent reads
  // hit the Postgres fallback path. Tenant-scoped: the caller's
  // `tenantId` is the only one we ever delete from.
  app.post('/debug/render-tree/clear', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const pageId = c.req.query('pageId') ?? '';
    if (!pageId) {
      return errorResponse(
        c,
        'BAD_REQUEST',
        'pageId query parameter is required',
        400,
        correlationId,
      );
    }
    try {
      const sql = await ensureTenantMigrated(state, principal.tenantId);
      const projections = new PostgresProjectionStore(sql);
      const removed = await projections.delete(
        contentRenderTreeKey(principal.tenantId, pageId),
      );
      return c.json({ cleared: true, removed });
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  return app;
}
