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
    const q = c.req.query('q') ?? '';
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
      // The search query handler throws an Error decorated with a `code`
      // string ('BAD_REQUEST') for empty `q`. Translate to INVALID_QUERY/400
      // to match the Rust ingress handler shape.
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code: unknown }).code === 'BAD_REQUEST'
      ) {
        const message = e instanceof Error ? e.message : String(e);
        return errorResponse(c, 'INVALID_QUERY', message, 400, correlationId);
      }
      return mapError(c, e, correlationId);
    }
  });

  return app;
}
