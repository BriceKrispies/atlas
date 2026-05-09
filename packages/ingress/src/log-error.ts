/**
 * Convert an arbitrary thrown value into the `LogEventError` shape the
 * structured logger expects on the top-level `error` field.
 *
 * The ingress chokepoint catches errors from metrics counters, the entity
 * store, and the audit-emit hook. Any of those can throw a plain string,
 * a non-Error object, or an `Error` subclass — `toLogError` normalises
 * the three so the log line always carries `{ code, message, stack? }`.
 *
 * `code` defaults to `'Error'` (matches the JS `Error.name` default) so
 * downstream log queries can group by code without special-casing
 * non-Error throws.
 */

import type { LogEventError } from '@atlas/platform-core';

export function toLogError(cause: unknown): LogEventError {
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: unknown }).code;
    const out: LogEventError = {
      code: typeof code === 'string' && code.length > 0 ? code : cause.name || 'Error',
      message: cause.message,
    };
    if (cause.stack) {
      out.stack = cause.stack;
    }
    return out;
  }
  if (typeof cause === 'string') {
    return { code: 'Error', message: cause };
  }
  return { code: 'Error', message: safeString(cause) };
}

function safeString(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
