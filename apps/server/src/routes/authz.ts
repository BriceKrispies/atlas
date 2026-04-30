/**
 * Authz routes — list + read policy versions.
 *
 * Writes (create / activate / archive) go through the standard intent
 * pipeline (`POST /api/v1/intents`) so authz dogfoods itself: the same
 * `policyEngine.evaluate()` gate that authorizes catalog actions
 * authorizes the policy edits.
 *
 * The two read endpoints below also flow through the policy engine — the
 * route handlers call `policyEngine.evaluate()` for `Authz.Policy.List`
 * / `Authz.Policy.Read` before touching the store. Reads aren't routed
 * through `submitIntent` because they don't produce events; the explicit
 * evaluate-then-read pattern keeps Invariant I2 (authz before side
 * effects) intact for the read path.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { PostgresPolicyStore } from '@atlas/authz';
import { evaluateRead } from '@atlas/ingress';
import type { AppState } from '../bootstrap.ts';
import { errorResponse, mapError } from '../middleware/errors.ts';
import { buildRequestBundle } from '../middleware/state.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

export function authzRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();
  const store = new PostgresPolicyStore(state.controlPlaneSql);

  app.get('/api/v1/policies', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    try {
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const decision = await evaluateRead(
        {
          principal: {
            id: principal.principalId,
            tenantId: principal.tenantId,
            attributes: {},
          },
          action: 'Authz.Policy.List',
          resource: {
            type: 'Policy',
            id: '',
            tenantId: principal.tenantId,
            attributes: {},
          },
          context: { correlationId },
        },
        bundle.ingress,
      );
      if (decision.effect === 'deny') {
        return errorResponse(
          c,
          'UNAUTHORIZED',
          'Not authorized to perform this action',
          403,
          correlationId,
        );
      }
      const rows = await store.list(principal.tenantId);
      return c.json(rows);
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  app.get('/api/v1/policies/:version', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const versionStr = c.req.param('version') ?? '';
    const version = Number.parseInt(versionStr, 10);
    if (!Number.isFinite(version) || version < 1) {
      return errorResponse(
        c,
        'BAD_REQUEST',
        `Invalid version: ${versionStr}`,
        400,
        correlationId,
      );
    }
    try {
      const bundle = await buildRequestBundle(state, principal, correlationId);
      const decision = await evaluateRead(
        {
          principal: {
            id: principal.principalId,
            tenantId: principal.tenantId,
            attributes: {},
          },
          action: 'Authz.Policy.Read',
          resource: {
            type: 'Policy',
            id: String(version),
            tenantId: principal.tenantId,
            attributes: {},
          },
          context: { correlationId },
        },
        bundle.ingress,
      );
      if (decision.effect === 'deny') {
        return errorResponse(
          c,
          'UNAUTHORIZED',
          'Not authorized to perform this action',
          403,
          correlationId,
        );
      }
      const detail = await store.get(principal.tenantId, version);
      if (!detail) {
        return errorResponse(
          c,
          'NOT_FOUND',
          `policy version not found: ${version}`,
          404,
          correlationId,
        );
      }
      return c.json(detail);
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  return app;
}
