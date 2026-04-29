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
import { intentDurationSeconds } from '@atlas/metrics';
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

    // Histogram wraps the full submitIntent call, regardless of outcome.
    // The action label is derived from the envelope payload — schema
    // validation runs inside submitIntent, so we may end up labelling
    // a histogram bucket with a nonsense action id from a malformed
    // payload. That's acceptable: the cardinality stays bounded by the
    // declared action set on success, and the error path's label noise
    // is dwarfed by the success path in steady state. If this ever
    // becomes a cardinality concern, switch to a hardcoded `unknown`
    // bucket on schema-validation failures.
    const action =
      typeof envelope.payload === 'object' &&
      envelope.payload !== null &&
      typeof envelope.payload.actionId === 'string'
        ? envelope.payload.actionId
        : 'unknown';
    const start = process.hrtime.bigint();
    try {
      const response = await submitIntent(bundle.ingress, envelope);
      return c.json(response, 202);
    } catch (e) {
      return mapError(c, e, correlationId);
    } finally {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
      try {
        intentDurationSeconds().observe(elapsed, { action });
      } catch {
        // Metrics MUST NOT fail the request. See submit-intent.ts.
      }
    }
  });

  return app;
}
