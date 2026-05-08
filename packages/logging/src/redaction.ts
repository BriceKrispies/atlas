/**
 * Redaction. Two mechanisms (per specs/crosscut/logging.md):
 *
 *   1. Key-name list — values under sensitive keys are masked. Default
 *      list covers password, secret, token, accessToken, refreshToken,
 *      authorization, cookie, set-cookie, apiKey, connectionString,
 *      email, phone. Case-insensitive.
 *
 *   2. Explicit wrapper — `sensitive(value)` returns a tagged object the
 *      redactor unconditionally masks regardless of key name. Useful for
 *      values that don't live under a "sensitive" key but should still
 *      be hidden (e.g., a tenant-supplied token field with a custom name).
 *
 * The redactor walks the top-level object recursively and replaces matched
 * values with the literal string '[REDACTED]'. Cycles are detected and
 * stamped '[Circular]'. Stack traces (in error.stack) are NOT walked —
 * they're considered internal-codebase content per the contract.
 */

const DEFAULT_SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'connectionstring',
  'email',
  'phone',
]);

const REDACTED = '[REDACTED]';

class SensitiveValue {
  constructor(public readonly value: unknown) {}
}

/**
 * Mark a value as sensitive. Redactor will mask regardless of key name.
 *
 * Example:
 *   ctx.logger.info('issued token', { properties: { token: sensitive(tok) } });
 */
export function sensitive(value: unknown): SensitiveValue {
  return new SensitiveValue(value);
}

export function isSensitive(value: unknown): value is SensitiveValue {
  return value instanceof SensitiveValue;
}

export interface RedactOptions {
  /** Additional sensitive key names. Case-insensitive. */
  extraKeys?: ReadonlyArray<string>;
}

/**
 * Recursively redact sensitive keys + sensitive() wrappers.
 * Returns a new structure; never mutates input.
 */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  const keys = new Set<string>(DEFAULT_SENSITIVE_KEYS);
  if (options.extraKeys !== undefined) {
    for (const k of options.extraKeys) keys.add(k.toLowerCase());
  }
  return walk(value, keys, new WeakSet<object>());
}

function walk(value: unknown, keys: ReadonlySet<string>, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (isSensitive(value)) return REDACTED;
  if (typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[Circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, keys, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = walk(v, keys, seen);
    }
  }
  return out;
}
