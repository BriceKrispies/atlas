/**
 * POST /api/v1/intents — full submitIntent pipeline.
 *
 * Mirrors `crates/ingress/src/main.rs::handle_intent`. Per-request adapters
 * are constructed against the resolved tenant's Postgres pool, then the
 * envelope is fed through `submitIntent` from `@atlas/ingress`.
 *
 * Success: 202 with `{ eventId, tenantId, principalId }`.
 * Failure: structured error envelope, status from IngressError.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { submitIntent } from '@atlas/ingress';
import type { IntentEnvelope } from '@atlas/platform-core';
import type { AppState } from '../bootstrap.ts';
import { mapError, errorResponse } from '../middleware/errors.ts';
import { buildRequestBundle } from '../middleware/state.ts';
import type { ServerVariables } from '../middleware/principal.ts';

type AppCtx = Context<{ Variables: ServerVariables }>;

export function intentRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  app.post('/api/v1/intents', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');

    let envelope: IntentEnvelope;
    try {
      envelope = (await c.req.json()) as IntentEnvelope;
    } catch (e) {
      return errorResponse(
        c,
        'BAD_REQUEST',
        `Invalid JSON body: ${(e as Error).message}`,
        400,
        correlationId,
      );
    }

    // Stamp correlation id from the resolved request flow if the body left it
    // empty — submitIntent's defaults expect it populated.
    if (!envelope.correlationId) {
      envelope.correlationId = correlationId;
    }
    if (!envelope.principalId) {
      envelope.principalId = principal.principalId;
    }

    let bundle;
    try {
      bundle = await buildRequestBundle(state, principal, correlationId);
    } catch (e) {
      return mapError(c, e, correlationId);
    }

    try {
      const response = await submitIntent(bundle.ingress, envelope);
      return c.json(response, 202);
    } catch (e) {
      return mapError(c, e, correlationId);
    }
  });

  return app;
}
