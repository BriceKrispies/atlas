/**
 * Content-pages query routes — list, get, get render-tree.
 *
 * Mirrors `crates/ingress/src/main.rs::handle_render_tree` for the
 * render-tree GET. Writes (create/update/delete) flow through the
 * standard `/api/v1/intents` pipeline so the policy engine evaluates
 * them just like any other action — content-pages dogfoods authz the
 * same way the catalog and authz modules do.
 *
 * Read-side endpoints check `policyEngine.evaluate()` for
 * `ContentPages.Page.Read` before touching the projection store. This
 * preserves Invariant I2 (authz before side effects, even read-only
 * ones — the cache write counts) for the read path.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import {
  listPages,
  getPage,
  getRenderTree,
} from '@atlas/modules-content-pages';
import type { AppState } from '../bootstrap.ts';
import { errorResponse, mapError } from '../middleware/errors.ts';
import { buildRequestBundle } from '../middleware/state.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

async function checkPageRead(
  state: AppState,
  principalId: string,
  tenantId: string,
  resourceId: string,
  correlationId: string,
): Promise<boolean> {
  const decision = await state.policyEngine.evaluate({
    principal: { id: principalId, tenantId, attributes: {} },
    action: 'ContentPages.Page.Read',
    resource: {
      type: 'Page',
      id: resourceId,
      tenantId,
      attributes: {},
    },
    context: { correlationId },
  });
  return decision.effect === 'permit';
}

export function contentPagesRoutes(
  state: AppState,
): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  app.get('/api/v1/pages', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    try {
      const allowed = await checkPageRead(
        state,
        principal.principalId,
        principal.tenantId,
        '',
        correlationId,
      );
      if (!allowed) {
        return errorResponse(
          c,
          'UNAUTHORIZED',
          'Not authorized to perform this action',
          403,
          correlationId,
        );
      }
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const rows = await listPages(bundle.contentPagesDeps);
      return c.json(rows);
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  app.get('/api/v1/pages/:pageId', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const pageId = c.req.param('pageId') ?? '';
    try {
      const allowed = await checkPageRead(
        state,
        principal.principalId,
        principal.tenantId,
        pageId,
        correlationId,
      );
      if (!allowed) {
        return errorResponse(
          c,
          'UNAUTHORIZED',
          'Not authorized to perform this action',
          403,
          correlationId,
        );
      }
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const doc = await getPage(bundle.contentPagesDeps, pageId);
      if (!doc) {
        return errorResponse(
          c,
          'NOT_FOUND',
          `page not found: ${pageId}`,
          404,
          correlationId,
        );
      }
      return c.json(doc);
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  app.get('/api/v1/pages/:pageId/render-tree', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const pageId = c.req.param('pageId') ?? '';
    try {
      const allowed = await checkPageRead(
        state,
        principal.principalId,
        principal.tenantId,
        pageId,
        correlationId,
      );
      if (!allowed) {
        return errorResponse(
          c,
          'UNAUTHORIZED',
          'Not authorized to perform this action',
          403,
          correlationId,
        );
      }
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const tree = await getRenderTree(bundle.contentPagesDeps, pageId);
      if (!tree) {
        return errorResponse(
          c,
          'NOT_FOUND',
          `render tree for page '${pageId}' not found`,
          404,
          correlationId,
        );
      }
      return c.json(tree);
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  // Legacy alias matching the Rust ingress route shape — `/api/v1/pages/:pageId/render`.
  // Same behaviour as `/render-tree` above; preserved so the Rust-era viewer
  // HTML keeps working when pointed at the TS server.
  app.get('/api/v1/pages/:pageId/render', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const pageId = c.req.param('pageId') ?? '';
    try {
      const allowed = await checkPageRead(
        state,
        principal.principalId,
        principal.tenantId,
        pageId,
        correlationId,
      );
      if (!allowed) {
        return errorResponse(
          c,
          'UNAUTHORIZED',
          'Not authorized to perform this action',
          403,
          correlationId,
        );
      }
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const tree = await getRenderTree(bundle.contentPagesDeps, pageId);
      if (!tree) {
        return errorResponse(
          c,
          'NOT_FOUND',
          `render tree for page '${pageId}' not found`,
          404,
          correlationId,
        );
      }
      return c.json(tree);
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  return app;
}
