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

/**
 * Narrow `unknown` to a human-readable message string. `instanceof Error`
 * covers the common throw shape; everything else falls back to `String(v)`.
 * Mirrors the helper in `middleware/principal.ts` — we keep the duplicate
 * tiny rather than coupling routes to middleware internals.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Type guard for plain JSON objects (not arrays, not null). */
function isJsonObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Read a string `.code` field off an arbitrary thrown value, or null. */
function errorCode(err: unknown): string | null {
  if (!isJsonObject(err)) return null;
  const code = err['code'];
  return typeof code === 'string' ? code : null;
}

export function intentRoutes(state: AppState): Hono<{ Variables: ServerVariables }> {
  const app = new Hono<{ Variables: ServerVariables }>();

  app.post('/api/v1/intents', async (c: AppCtx) => {
    const correlationId = c.get('correlationId');
    const principal = c.get('principal');
    const ctx = c.get('ctx');

    if (!principal) {
      ctx.logger.warn('intent rejected', {
        event: 'Intent.Rejected',
        properties: { code: 'PRINCIPAL_REQUIRED', reason: 'no-principal-on-context' },
      });
      return errorResponse(c, 'PRINCIPAL_REQUIRED', 'authentication required', 401, correlationId);
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch (e) {
      ctx.logger.info('intent rejected', {
        event: 'Intent.Rejected',
        properties: { code: 'BAD_REQUEST', reason: 'invalid-json-body' },
      });
      return errorResponse(
        c,
        'BAD_REQUEST',
        `Invalid JSON body: ${errorMessage(e)}`,
        400,
        correlationId,
      );
    }
    if (!isJsonObject(raw)) {
      ctx.logger.info('intent rejected', {
        event: 'Intent.Rejected',
        properties: { code: 'BAD_REQUEST', reason: 'body-not-object' },
      });
      return errorResponse(
        c,
        'BAD_REQUEST',
        'Invalid JSON body: expected an object',
        400,
        correlationId,
      );
    }
    // Boundary: the envelope's full shape — including the per-action
    // `payload` schema — is validated inside `submitIntent` via the
    // schema registry (see `packages/ingress/src/submit-intent.ts:177`).
    // Re-validating every IntentEnvelope field here would duplicate that
    // surface. The object-shape narrow above closes the "primitive /
    // array / null defeats `.correlationId`" path; submitIntent owns the
    // rest. Same pattern as mfa.ts WebAuthn response handling.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, atlas-widgets/no-double-cast -- boundary: submitIntent's schema validator is the authority on IntentEnvelope shape; object-narrow done above
    const envelope: IntentEnvelope = raw as unknown as IntentEnvelope;

    // Stamp correlation id from the resolved request flow if the body left it
    // empty — submitIntent's defaults expect it populated.
    if (!envelope.correlationId) {
      envelope.correlationId = correlationId;
    }
    if (!envelope.principalId) {
      envelope.principalId = principal.principalId;
    }

    const action =
      typeof envelope.payload === 'object' &&
      envelope.payload !== null &&
      typeof envelope.payload.actionId === 'string'
        ? envelope.payload.actionId
        : 'unknown';

    ctx.logger.info('intent submitted', {
      event: 'Intent.Submitted',
      properties: {
        actionId: action,
        eventType: envelope.eventType,
        idempotencyKey: envelope.idempotencyKey,
      },
    });

    let bundle;
    try {
      bundle = await buildRequestBundle(state, principal, correlationId);
    } catch (e) {
      ctx.logger.info('intent rejected', {
        event: 'Intent.Rejected',
        properties: {
          code: 'BUNDLE_BUILD_FAILED',
          reason: errorMessage(e),
          actionId: action,
        },
      });
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
    const start = process.hrtime.bigint();
    try {
      const response = await submitIntent(bundle.ingress, envelope);
      ctx.logger.info('intent accepted', {
        event: 'Intent.Accepted',
        properties: {
          actionId: action,
          eventId: response.eventId,
          idempotencyKey: envelope.idempotencyKey,
        },
      });
      return c.json(response, 202);
    } catch (e) {
      const message = errorMessage(e);
      // Truncate user-supplied error text (e.g. schema validation strings)
      // before logging at info — avoids unbounded log-line growth and
      // keeps PII / pasted secrets from accidentally landing in the
      // structured log stream.
      const reason = message.length > 200
        ? `${message.slice(0, 200)}…`
        : message;
      ctx.logger.info('intent rejected', {
        event: 'Intent.Rejected',
        properties: {
          code: errorCode(e) ?? 'INTERNAL_ERROR',
          reason,
          actionId: action,
        },
      });
      return mapError(c, e, correlationId);
    } finally {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
      try {
        intentDurationSeconds().observe(elapsed, { action });
      } catch (cause) {
        // Metrics MUST NOT fail the request. See submit-intent.ts.
        ctx.logger.debug('intent metric observe failed', {
          event: 'Intent.MetricObserve.Failed',
          properties: {
            actionId: action,
            cause: errorMessage(cause),
          },
        });
      }
    }
  });

  return app;
}
