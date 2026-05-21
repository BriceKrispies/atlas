/**
 * Typed reader for catalog projection store entries.
 *
 * `ProjectionStore.get(key)` returns `unknown | null` — the port is
 * domain-agnostic. Each catalog query knows the response shape its own
 * projection writes; this helper centralizes the boundary cast so the
 * lint suppression lives in one place instead of every query.
 */

/**
 * Reads a projection entry, asserting the stored value matches the
 * expected response type. Returns `null` if missing.
 *
 * The caller is responsible for picking the right `T` for the
 * projection key: queries are paired 1:1 with the projection that
 * writes them.
 */
export function readProjection<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  // Boundary: the projection is the sole writer of this key, writing
  // exactly `T`. The port erases that contract to `unknown`.
  return value as T;
}
