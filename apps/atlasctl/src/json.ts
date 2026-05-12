/**
 * Tiny type-guard helpers for narrowing the `unknown` JSON shapes the
 * `request()` client returns. Keeps `as Record<string, unknown>` casts
 * out of every command file — instead, callers do
 *
 *   const obj = asRecord(body);
 *   if (obj === null) return null;
 *   const slug = readString(obj, 'repoSlug');
 *
 * Local to `apps/atlasctl/`: shared helpers belong in `@atlas/ports` or
 * a platform package, but these guards are CLI-specific JSON-response
 * narrowing and don't earn a cross-package dep.
 */

/**
 * Narrow `v` to a plain object if it is one. Returns `null` for arrays,
 * primitives, `null`, and `undefined`. Mirrors the
 * `typeof v === 'object' && v !== null && !Array.isArray(v)` check that
 * is otherwise re-implemented at every body-reading callsite.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  return isRecord(v) ? v : null;
}

/**
 * Read a string-typed field from a JSON-derived record. Returns `null`
 * when the field is absent or non-string. Convenient when the caller is
 * already inside an `asRecord`-narrowed branch.
 */
export function readString(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

/**
 * Read a number-typed field from a JSON-derived record. Returns `null`
 * when the field is absent or non-number.
 */
export function readNumber(
  obj: Record<string, unknown>,
  key: string,
): number | null {
  const v = obj[key];
  return typeof v === 'number' ? v : null;
}

/**
 * Read an array-typed field from a JSON-derived record without binding
 * the element type. Returns `null` when the field is absent or
 * non-array. Callers narrow element types themselves.
 */
export function readArray(
  obj: Record<string, unknown>,
  key: string,
): readonly unknown[] | null {
  const v = obj[key];
  return Array.isArray(v) ? v : null;
}

/**
 * Narrow a caught value to its `Error.message` string. Catch clauses in
 * TypeScript bind `unknown`, so the standard pattern of reading
 * `.message` requires a runtime check. Returns the string verbatim when
 * `e` is an Error; falls back to `String(e)` so non-Error throws still
 * surface a useful message.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : JSON.stringify(e);
}
