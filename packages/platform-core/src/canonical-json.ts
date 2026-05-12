/**
 * Stable JSON stringify with deterministic key ordering. Used by the
 * seeder for `contentHash` derivation: `sha256Hex(canonicalJsonStringify(
 * resolvedScenario))` per `specs/crosscut/seed-corpus.md` §4.1.
 *
 * Re-exported from `@atlas/platform-core` per
 * `specs/crosscut/scenario-fuzzing.md` §7 ("Re-export `prngFromSeed`,
 * `sha256Hex`, `canonicalJsonStringify` from `@atlas/platform-core`"). One
 * canonical implementation lives here; the seeder and adapter-seed-memory
 * import it rather than maintaining their own copies.
 *
 * Rules:
 *   - Object keys are emitted in lexical (codepoint) order.
 *   - Arrays preserve their existing order.
 *   - `undefined` values and function values are dropped (matching
 *     `JSON.stringify`).
 *   - Cycles throw — the runner's payloads are tree-shaped JSON.
 *   - `Date` values are serialised via `toJSON()`. Mirrors
 *     `JSON.stringify` Date semantics — Dates serialise to ISO strings,
 *     not `{}`. Two scenarios that differ only in a Date field MUST
 *     produce distinct `contentHash`es (spec §4.1 determinism contract).
 *
 * Hand-rolled (no third-party dep) — Atlas dep hygiene is strict and
 * the surface here is small. Output is not pretty-printed.
 */

export function canonicalJsonStringify(value: unknown): string {
  return stringify(value, new WeakSet());
}

function stringify(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null';

  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    // JSON.stringify already emits `null` for NaN / +-Infinity; mirror
    // that so canonical output matches `JSON.stringify` for primitives.
    if (!Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    // Caller-side: top-level undefined/function returns 'null' to match
    // JSON.stringify's behavior of producing `undefined` (which is then
    // serialised as 'null' inside arrays / dropped in objects).
    return 'null';
  }
  if (typeof value === 'bigint') {
    throw new TypeError('canonicalJsonStringify: bigint values are not JSON-serialisable');
  }

  // Objects + arrays. `typeof value === 'object'` narrows to `object | null`;
  // null was returned above so the value is `object` here.
  const obj: object = value;

  // Honor toJSON() for objects that opt into a serialisation form (Date,
  // most notably). Mirrors JSON.stringify Date semantics — Dates serialise
  // to ISO strings, not `{}`.
  const withToJson: { toJSON?: (this: object, key?: string) => unknown } = obj;
  const maybeToJson = withToJson.toJSON;
  if (typeof maybeToJson === 'function') {
    return stringify(maybeToJson.call(obj), seen);
  }

  if (seen.has(obj)) {
    throw new TypeError('canonicalJsonStringify: cyclic value');
  }
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const parts = obj.map((item: unknown) => {
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
          return 'null';
        }
        return stringify(item, seen);
      });
      return '[' + parts.join(',') + ']';
    }
    const entries = Object.entries(obj).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const out: string[] = [];
    for (const [k, v] of entries) {
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
      out.push(JSON.stringify(k) + ':' + stringify(v, seen));
    }
    return '{' + out.join(',') + '}';
  } finally {
    seen.delete(obj);
  }
}
