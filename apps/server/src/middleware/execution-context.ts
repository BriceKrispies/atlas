/**
 * Execution-context middleware.
 *
 * Builds an `AtlasExecutionContext` for every request and stashes it on
 * `c.var.ctx`. Runs FIRST in the middleware chain so every downstream
 * middleware (correlation, principal, route handlers) can use
 * `c.var.ctx.logger.<level>(...)` instead of `console.*`.
 *
 * The context starts as anonymous-principal:
 *   - tenantId: the configured default (`config.tenantId`)
 *   - principalId: 'anonymous'
 *   - correlationId: from inbound X-Correlation-Id header, sanitized;
 *     generated if missing or invalid
 *   - traceId: defaults to correlationId until OTEL lands
 *   - spanId: minted fresh per request
 *   - requestId: minted fresh per request
 *
 * After the principal middleware resolves a real principal, it builds a
 * NEW context (correlationId / traceId preserved via createRootContext's
 * `incomingCorrelationId` field) and replaces `c.var.ctx`. The reason for
 * a fresh context (instead of `.with({ principalId, tenantId })`) is that
 * tenantId is immutable across a single context's `.with*()` lineage —
 * see specs/crosscut/logging.md and the AtlasExecutionContext type doc.
 *
 * Response wiring: this middleware sets `X-Correlation-Id` on the response
 * before returning so the caller can correlate their request to log lines.
 */

import type { MiddlewareHandler } from 'hono';
import { createRootContext, newRequestId } from '@atlas/logging';
import type { AppState } from '../bootstrap.ts';
import { correlationIdFor } from './correlation.ts';
import type { ServerVariables } from './principal.ts';

const CORRELATION_HEADER = 'X-Correlation-Id';

export function executionContextMiddleware(
  state: AppState,
): MiddlewareHandler<{ Variables: ServerVariables }> {
  return async (c, next) => {
    const correlationId = correlationIdFor(c);
    const requestId = newRequestId();

    const ctx = createRootContext({
      pipeline: state.logPipeline,
      tenantId: state.config.tenantId,
      principalId: 'anonymous',
      environment: state.config.environment,
      incomingCorrelationId: correlationId,
      requestId,
    });

    c.set('correlationId', correlationId);
    c.set('ctx', ctx);

    await next();

    // Surface correlation id back to the caller so they can join their
    // request log to ours during incident response.
    c.res.headers.set(CORRELATION_HEADER, correlationId);
  };
}
