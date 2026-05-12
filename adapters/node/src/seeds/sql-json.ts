/**
 * Typed wrapper around `sql.json()` for seed payloads.
 *
 * postgres.js types `sql.json()` against a strict structural `JSONValue`
 * recursive type. That type rejects perfectly valid JSON values whose
 * static type is `unknown` / `Record<string, unknown>` (e.g. JSON Schema
 * literals) even though they serialise fine at runtime — and the
 * tagged-template just calls `JSON.stringify` on the value anyway.
 *
 * To keep the cast surface in one place, every seed module routes JSON
 * parameters through `jsonParam(sql, value)`. The single shielded
 * `as never` lives here, justified once.
 */
import type postgres from 'postgres';

/**
 * Minimal JSON Schema shape. Inline rather than imported from
 * `@atlas/openapi` to keep this adapter package's dep graph narrow
 * (it currently has no dep on the openapi package).
 */
export type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * Wrap a serialisable value so postgres.js binds it as a JSON parameter.
 * The caller types the value up-front (e.g. `const X: JsonSchema = …`);
 * the cast inside is a one-shot widening to satisfy postgres.js's
 * over-strict `JSONValue` parameter type.
 */
export function jsonParam<T>(
  sql: postgres.Sql,
  value: T,
): postgres.Parameter {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- library: postgres.js sql.json typing (`JSONValue`) is too narrow for parameterised JSON values whose static type is `unknown` / `Record<string, unknown>`; this is the single shielded cast for the whole adapter
  return sql.json(value as never);
}
