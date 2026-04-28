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
 */
export function mapError(
  c: Context,
  e: unknown,
  correlationId: string,
): Response {
  if (e instanceof IngressError) {
    return errorResponse(c, e.code, e.message, e.status, e.correlationId || correlationId);
  }
  const message = e instanceof Error ? e.message : String(e);
  // Boundary-normalise unknown errors to TRANSACTION_FAILED / 500 — mirrors
  // the Rust `AppError::storage_failed` constructor in
  // `crates/ingress/src/errors.rs`, which emits the `TRANSACTION_FAILED`
  // taxonomy code for unhandled persistence/internal paths.
  return errorResponse(c, 'TRANSACTION_FAILED', message, 500, correlationId);
}
