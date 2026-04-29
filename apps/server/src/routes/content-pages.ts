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
import { evaluateRead, type IngressState } from '@atlas/ingress';
import type { AppState } from '../bootstrap.ts';
import { errorResponse, mapError } from '../middleware/errors.ts';
import { buildRequestBundle } from '../middleware/state.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

/**
 * Read-side authz check that goes through the unified `evaluateRead`
 * helper — increments `atlas_policy_evaluations_total` and emits
 * `StructuredAuthz.PolicyEvaluated` on deny, just like the write path
 * via `submitIntent`. The previous inline `state.policyEngine.evaluate`
 * call bypassed both metrics + audit (architectural audit Chunk 7).
 */
async function checkPageRead(
  ingress: IngressState,
  resourceId: string,
): Promise<boolean> {
  const decision = await evaluateRead(
    {
      principal: {
        id: ingress.principalId,
        tenantId: ingress.tenantId,
        attributes: {},
      },
      action: 'ContentPages.Page.Read',
      resource: {
        type: 'Page',
        id: resourceId,
        tenantId: ingress.tenantId,
        attributes: {},
      },
      context: { correlationId: ingress.correlationId ?? 'unknown' },
    },
    ingress,
  );
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
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const allowed = await checkPageRead(bundle.ingress, '');
      if (!allowed) {
        return errorResponse(
          c,
          'UNAUTHORIZED',
          'Not authorized to perform this action',
          403,
          correlationId,
        );
      }
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
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const allowed = await checkPageRead(bundle.ingress, pageId);
      if (!allowed) {
        return errorResponse(
          c,
          'UNAUTHORIZED',
          'Not authorized to perform this action',
          403,
          correlationId,
        );
      }
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
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const allowed = await checkPageRead(bundle.ingress, pageId);
      if (!allowed) {
        return errorResponse(
          c,
          'UNAUTHORIZED',
          'Not authorized to perform this action',
          403,
          correlationId,
        );
      }
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
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const allowed = await checkPageRead(bundle.ingress, pageId);
      if (!allowed) {
        return errorResponse(
          c,
          'UNAUTHORIZED',
          'Not authorized to perform this action',
          403,
          correlationId,
        );
      }
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
