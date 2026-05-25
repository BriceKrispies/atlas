/**
 * The client → BFF read contract (ADR 0017, constitution C14).
 *
 * The kernel's `query(ref, params?)` resolves to `{BFF}/q/:ref`. The BFF maps
 * `ref` to one or more upstream `apps/server` query/read endpoints and MAY
 * aggregate them into the shape the surface needs. The wire result is the
 * data itself (typed by the surface); failures are HTTP status + `WireError`.
 */
import type { JsonValue } from './json.ts';

/** A read addressed by a stable reference + optional params. */
export interface QueryRequest {
  ref: string;
  params?: Record<string, JsonValue>;
}

/**
 * The successful read body. Thin envelope so the kernel can attach metadata
 * (e.g. the tags a result is sensitive to, for cache invalidation) without
 * conflating it with the domain data.
 */
export interface QueryResult<T = unknown> {
  data: T;
  /** Cache-invalidation tags this result is sensitive to (drives refetch). */
  tags?: readonly string[];
}
