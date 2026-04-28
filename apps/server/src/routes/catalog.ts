/**
 * Catalog query routes — taxonomy, family, variant table, search.
 *
 * Mirrors `crates/ingress/src/main.rs::handle_catalog_*`. Each route resolves
 * the tenant pool via `buildRequestBundle`, then delegates to the catalog
 * query-router in `@atlas/modules-catalog`.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  getTaxonomyNodes,
  getFamilyDetail,
  getVariantTable,
  searchCatalog,
  parseFilterQuery,
  type SearchParams,
  type VariantTableParams,
} from '@atlas/modules-catalog';
import type { AppState } from '../bootstrap.ts';
import { errorResponse, mapError } from '../middleware/errors.ts';
import { buildRequestBundle } from '../middleware/state.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

export function catalogRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  app.get('/api/v1/catalog/taxonomies/:treeKey/nodes', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const treeKey = c.req.param('treeKey') ?? '';
    try {
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const result = await getTaxonomyNodes(bundle.catalogDeps, treeKey);
      if (!result) {
        return errorResponse(
          c,
          'NOT_FOUND',
          `taxonomy tree '${treeKey}' not found`,
          404,
          correlationId,
        );
      }
      return c.json(result);
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  app.get('/api/v1/catalog/families/:familyKey', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const familyKey = c.req.param('familyKey') ?? '';
    try {
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const result = await getFamilyDetail(bundle.catalogDeps, familyKey);
      if (!result) {
        return errorResponse(
          c,
          'NOT_FOUND',
          `family '${familyKey}' not found`,
          404,
          correlationId,
        );
      }
      return c.json(result);
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  app.get('/api/v1/catalog/families/:familyKey/variants', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const familyKey = c.req.param('familyKey') ?? '';

    // Hono returns the first value for repeated params; we only need a
    // flat record-of-strings for parseFilterQuery, which is shape-compatible
    // with the Rust HashMap<String,String> the existing handler accepts.
    const raw: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.req.query())) {
      if (typeof v === 'string') raw[k] = v;
    }

    const params: VariantTableParams = {
      filters: parseFilterQuery(raw),
    };
    const sortRaw = raw['sort'];
    if (sortRaw !== undefined) params.sort = sortRaw;
    const pageSizeRaw = raw['pageSize'];
    if (pageSizeRaw !== undefined) {
      const n = Number.parseInt(pageSizeRaw, 10);
      if (Number.isFinite(n)) params.pageSize = n;
    }
    // VariantTableParams has no cursor today; the Rust handler also ignores
    // it. Leaving the field unparsed preserves shape parity.

    try {
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const result = await getVariantTable(bundle.catalogDeps, familyKey, params);
      if (!result) {
        return errorResponse(
          c,
          'NOT_FOUND',
          `family '${familyKey}' not found`,
          404,
          correlationId,
        );
      }
      return c.json(result);
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  app.get('/api/v1/catalog/search', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    // Validate `q` at the route boundary so we don't depend on the inner
    // query handler's `code: 'BAD_REQUEST'` decoration to surface a 400 —
    // a refactor of the handler would otherwise silently degrade to 500.
    const q = c.req.query('q')?.trim() ?? '';
    if (q.length === 0) {
      return errorResponse(
        c,
        'INVALID_QUERY',
        'Query parameter "q" must be non-empty',
        400,
        correlationId,
      );
    }
    const docType = c.req.query('type');
    const pageSizeRaw = c.req.query('pageSize');
    const cursorRaw = c.req.query('cursor');

    const params: SearchParams = { q };
    if (docType !== undefined) params.type = docType;
    if (pageSizeRaw !== undefined) {
      const n = Number.parseInt(pageSizeRaw, 10);
      if (Number.isFinite(n)) params.pageSize = n;
    }
    if (cursorRaw !== undefined) params.cursor = cursorRaw;

    try {
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const result = await searchCatalog(bundle.catalogDeps, params);
      return c.json(result);
    } catch (e) {
      // Defence-in-depth: the inner query handler still throws an Error
      // decorated with `code: 'BAD_REQUEST'` if its own internal validators
      // ever escalate. Keep the translation as a fallback so the shape
      // matches the Rust ingress handler.
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code: unknown }).code === 'BAD_REQUEST'
      ) {
        return errorResponse(
          c,
          'INVALID_QUERY',
          'Query parameter "q" must be non-empty',
          400,
          correlationId,
        );
      }
      return mapError(c, e, correlationId);
    }
  });

  return app;
}
