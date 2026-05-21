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
import type { AtlasExecutionContext } from '@atlas/platform-core';
import { IdentityError } from '@atlas/identity';
import {
  TenantDatabaseNotProvisionedError,
  TenantNotFoundError,
} from '@atlas/adapter-node';

/**
 * Collapse user-enumerable identity error codes to opaque ones at the
 * HTTP boundary. Internal codes (`USER_NOT_FOUND`, `PASSWORD_INVALID`,
 * `ACCOUNT_LOCKED`, `SESSION_REVOKED`, etc.) stay in the audit log so
 * operators can diagnose; the client sees one of:
 *   - `IDENTITY_INVALID` for any login failure
 *   - `SESSION_INVALID` for any session-validation failure
 *   - the original code for everything else
 *
 * Without this, an attacker can enumerate which emails are registered
 * (USER_NOT_FOUND vs PASSWORD_INVALID) and probe session lifecycle
 * state (NOT_FOUND vs REVOKED vs EXPIRED).
 */
const LOGIN_FAILURE_CODES = new Set([
  'USER_NOT_FOUND',
  'USER_SUSPENDED',
  'PASSWORD_INVALID',
  'ACCOUNT_LOCKED',
  'RATE_LIMITED',
]);
const SESSION_FAILURE_CODES = new Set([
  'SESSION_NOT_FOUND',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'SESSION_REUSE_DETECTED',
  'SESSION_HARD_TIMEOUT',
  'SESSION_IDLE_TIMEOUT',
]);

export function publicIdentityCode(internalCode: string): {
  code: string;
  message: string;
} {
  if (LOGIN_FAILURE_CODES.has(internalCode)) {
    return { code: 'IDENTITY_INVALID', message: 'invalid credentials' };
  }
  if (SESSION_FAILURE_CODES.has(internalCode)) {
    return { code: 'SESSION_INVALID', message: 'session is not valid' };
  }
  return { code: internalCode, message: '' };
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    correlationId: string;
    supportId: string;
  };
}

/**
 * Narrow an unknown thrown value to a human-readable string. `instanceof
 * Error` covers the common case; any other shape falls back to `String(v)`.
 * Use for catch-block-to-log-property paths so routes never blind-cast a
 * caught `unknown` to `Error` (the type-assertion ESLint rule forbids
 * that — throwables in JS can be anything).
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
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
 * Variant of `errorResponse` that takes a pre-built envelope. Used when
 * the caller needs to log the envelope's `supportId` BEFORE responding
 * so the log line and the user-facing supportId match (the A7 routes
 * pair every failure with this contract — see `routes/identity-a7.ts`).
 *
 * Pays the `ContentfulStatusCode` cast in one place so callers don't
 * each repeat it.
 */
export function jsonErrorEnvelope(
  c: Context,
  envelope: ErrorEnvelope,
  status: number,
): Response {
  return c.json(
    envelope,
    status as ContentfulStatusCode,
  );
}

/**
 * Find an instance of `ctor` either at the top level of `err` or one level
 * down via `Error.cause`. One level is intentional: handlers that wrap a
 * tenant error for logging clarity typically do
 * `throw new Error('outer', { cause: tnfe })` — a single hop. Deeper nesting
 * isn't a real-world Atlas pattern.
 *
 * Used so `mapError` keeps mapping `TenantNotFoundError` and
 * `TenantDatabaseNotProvisionedError` to 404 / 503 even when a caller wraps
 * for context, instead of silently collapsing to TRANSACTION_FAILED / 500.
 */
function findCause<T>(err: unknown, ctor: new (...args: never[]) => T): T | null {
  if (err instanceof ctor) return err;
  const cause = (err as { cause?: unknown } | null)?.cause;
  return cause instanceof ctor ? cause : null;
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
  if (e instanceof IdentityError) {
    const pub = publicIdentityCode(e.code);
    if (pub.code !== e.code) {
      // Collapsed code — substitute the opaque message too so the
      // client never sees "user not found" vs "wrong password".
      return errorResponse(c, pub.code, pub.message, e.status, correlationId);
    }
    return errorResponse(c, e.code, e.message, e.status, correlationId);
  }
  if (e instanceof IngressError) {
    return errorResponse(c, e.code, e.message, e.status, e.correlationId || correlationId);
  }
  // Both tenant-error branches use `findCause` so a handler that wraps for
  // logging clarity (`throw new Error('outer', { cause: tnfe })`) still
  // gets the right HTTP envelope. The INNER error's code / message / tenantId
  // are what surface to the client and the structured log — the wrapper's
  // text is intentionally discarded (the operational signal is the tenant
  // condition, not the surrounding context). See
  // `tickets/db-per-tenant-followups/wrapped-tenant-errors-unmapped.md`.
  const tdnp = findCause(e, TenantDatabaseNotProvisionedError);
  if (tdnp !== null) {
    // ADR 0005 (db-per-tenant) is fail-closed: when the per-tenant database
    // hasn't been provisioned, the data plane is not ready for this tenant —
    // service-unavailable, NOT an internal storage failure. Log the
    // structured error so operators see the remediation message (dev:
    // `pnpm dev:up`; prod: invoke the tenancy provisioner) under the same
    // supportId surfaced to the client.
    const envelope = errorEnvelope(tdnp.code, tdnp.message, correlationId);
    const ctx = (c.get as (k: 'ctx') => AtlasExecutionContext | undefined)('ctx');
    if (ctx !== undefined) {
      ctx.logger.error('tenant database not provisioned', {
        event: 'Tenancy.DatabaseNotProvisioned',
        error: {
          code: tdnp.code,
          message: tdnp.message,
          ...(tdnp.stack !== undefined ? { stack: tdnp.stack } : {}),
        },
        properties: { supportId: envelope.error.supportId, tenantId: tdnp.tenantId },
      });
    }
    return jsonErrorEnvelope(c, envelope, 503);
  }
  const tnf = findCause(e, TenantNotFoundError);
  if (tnf !== null) {
    // ADR 0005 (db-per-tenant): the provisioner refuses to create orphan
    // databases / roles when there is no `control_plane.tenants` row. That
    // is a "tenant does not exist" condition at the registry, not an
    // internal storage failure — surface it as 404 with the canonical
    // TENANT_NOT_FOUND code so a future signup-approve / provisioning
    // route returns the right shape (sibling to the F3 mapping above).
    const envelope = errorEnvelope(tnf.code, tnf.message, correlationId);
    const ctx = (c.get as (k: 'ctx') => AtlasExecutionContext | undefined)('ctx');
    if (ctx !== undefined) {
      ctx.logger.error('tenant not found', {
        event: 'Tenancy.TenantNotFound',
        error: {
          code: tnf.code,
          message: tnf.message,
          ...(tnf.stack !== undefined ? { stack: tnf.stack } : {}),
        },
        properties: { supportId: envelope.error.supportId, tenantId: tnf.tenantId },
      });
    }
    return jsonErrorEnvelope(c, envelope, 404);
  }
  const envelope = errorEnvelope(
    'TRANSACTION_FAILED',
    'Internal storage failure',
    correlationId,
  );
  // Log the raw error server-side so operators can join request → root cause
  // via the supportId without exposing internal text to the client.
  // Per specs/crosscut/logging.md: ctx.logger pairs the log line's
  // correlationId+supportId with the user-facing error envelope.
  const ctx = (c.get as (k: 'ctx') => AtlasExecutionContext | undefined)('ctx');
  const errorObj =
    e instanceof Error
      ? {
          code: 'UNMAPPED_ERROR',
          message: e.message,
          ...(e.stack !== undefined ? { stack: e.stack } : {}),
        }
      : { code: 'UNMAPPED_ERROR', message: String(e) };
  if (ctx !== undefined) {
    ctx.logger.error('unmapped error reaching the boundary', {
      event: 'Ingress.UnmappedError',
      error: errorObj,
      properties: { supportId: envelope.error.supportId },
    });
  }
  return c.json(envelope, 500 as ContentfulStatusCode);
}
