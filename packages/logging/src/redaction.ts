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
 *
 * Overload: when the input is a plain `Record<string, unknown>` (the
 * `LogFields.properties` shape), the output is the same shape — the
 * function walks and rebuilds the top level as a new object. This lets
 * callers assign the result back to a `Record<string, unknown>` field
 * without re-narrowing.
 */
export function redact(
  value: Readonly<Record<string, unknown>>,
  options?: RedactOptions,
): Record<string, unknown>;
export function redact(value: unknown, options?: RedactOptions): unknown;
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
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, keys, seen));
  }

  // After the typeof + array guards, value is a plain non-null,
  // non-array object — walking its enumerable keys is the redaction
  // contract. `Object.entries` on `object` types as `[string, any][]`,
  // which would trip no-unsafe-* rules; cast to a typed record view of
  // the same runtime value at this one boundary.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: redaction walks enumerable keys of any plain object; runtime guards above pin shape
  const entries = Object.entries(value as Record<string, unknown>);
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (keys.has(k.toLowerCase())) {
      out[k] = REDACTED;
    } else {
      out[k] = walk(v, keys, seen);
    }
  }
  return out;
}
