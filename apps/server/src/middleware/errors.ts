/**
 * Error envelope shaping + IngressError → HTTP mapping.
 *
 * Matches the Rust ingress error envelope shape exactly:
 *
 *   { "error": { "code", "message", "correlationId", "supportId" } }
 *
 * The `supportId` is a per-error UUID minted server-side for log correlation
 * (Rust counterpart: `errors.rs` INV-ERR-01).
 *
 * IngressError already carries an HTTP status; this module is the single
 * place that turns it into a Hono `Response`. Routes never JSON-shape errors
 * themselves.
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { IngressError } from '@atlas/platform-core';

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    correlationId: string;
    supportId: string;
  };
}

function newSupportId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `sup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function errorEnvelope(
  code: string,
  message: string,
  correlationId: string,
): ErrorEnvelope {
  return {
    error: {
      code,
      message,
      correlationId,
      supportId: newSupportId(),
    },
  };
}

export function errorResponse(
  c: Context,
  code: string,
  message: string,
  status: number,
  correlationId: string,
): Response {
  return c.json(
    errorEnvelope(code, message, correlationId),
    status as ContentfulStatusCode,
  );
}

/**
 * Convert an unknown thrown value into a structured response. Routes wrap
 * their bodies with `try { ... } catch (e) { return mapError(c, e, ...) }`.
 *
 * Unknown thrown values are normalised to `TRANSACTION_FAILED` / 500 with a
 * fixed safe message (mirrors `AppError::storage_failed` in
 * `crates/ingress/src/errors.rs`). Per INV-ERR-03 we MUST NOT forward raw
 * `e.message` to the client — internal paths / SQL fragments / panics could
 * leak. The raw error is logged server-side under the supportId for
 * operator correlation.
 */
export function mapError(
  c: Context,
  e: unknown,
  correlationId: string,
): Response {
  if (e instanceof IngressError) {
    return errorResponse(c, e.code, e.message, e.status, e.correlationId || correlationId);
  }
  const envelope = errorEnvelope(
    'TRANSACTION_FAILED',
    'Internal storage failure',
    correlationId,
  );
  // Log the raw error server-side so operators can join request → root cause
  // via the supportId without exposing internal text to the client.
  console.error('[ingress] unmapped error', {
    correlationId,
    supportId: envelope.error.supportId,
    error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
  });
  return c.json(envelope, 500 as ContentfulStatusCode);
}
