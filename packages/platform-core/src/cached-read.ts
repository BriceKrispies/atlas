/**
 * Stampede-protected cached-read helper.
 *
 * TS counterpart of `crates/runtime/src/cache_helpers.rs::CachedRead`.
 *
 * Flow:
 * 1. `cache.get(key)` — return immediately on hit.
 * 2. On miss, `singleflight.do(key, ...)` ensures only one concurrent
 *    `compute()` runs per key; siblings await the same promise.
 * 3. When `compute()` resolves, write the value to the cache via
 *    `cache.set(key, value, { ttlSeconds, tags })` and return it.
 *
 * Value-type parity note: the Rust source uses `Vec<u8>` (raw bytes)
 * because the Rust `Cache` port operates on bytes. The TS `Cache` port
 * (`ports/src/cache.ts`) operates on JSON-shaped `unknown` instead, so
 * `CachedRead<V>` is generic over the JSON value type. The behavioural
 * contract is identical: hit -> return cached; miss -> singleflight ->
 * compute -> set -> return.
 *
 * @example
 *   const cr = new CachedRead<MyDoc>(cache);
 *   const doc = await cr.get(
 *     'cache:doc:tenant-1:page-9',
 *     { ttlSeconds: 300, tags: ['tenant:tenant-1', 'page:page-9'] },
 *     async () => fetchDocFromDb(),
 *   );
 */

import { SingleFlight } from './singleflight.ts';
import type { CacheSetOptions } from './types.ts';

/**
 * Minimal structural shape of the `Cache` port required by `CachedRead`.
 *
 * Declared structurally (rather than imported from `@atlas/ports`) to
 * avoid a circular dependency: `@atlas/ports` already depends on
 * `@atlas/platform-core`. Anything implementing `@atlas/ports`'s
 * `Cache` interface satisfies this shape automatically.
 */
interface CachePortShape {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown, opts: CacheSetOptions): Promise<void>;
}

export class CachedRead<V = unknown> {
  private readonly cache: CachePortShape;
  private readonly singleFlight: SingleFlight<string, V>;

  /**
   * Create a new `CachedRead`.
   *
   * @param cache - Cache port (the in-flight slot is per `CachedRead`
   *   instance, so siblings sharing the same `Cache` but different
   *   `CachedRead` wrappers will NOT deduplicate compute work — give
   *   them the same wrapper to share single-flight state).
   * @param singleFlight - Optional injected `SingleFlight`; defaults to
   *   a fresh per-instance coordinator. Inject one to share in-flight
   *   slots across multiple `CachedRead` wrappers if needed.
   */
  constructor(cache: CachePortShape, singleFlight?: SingleFlight<string, V>) {
    this.cache = cache;
    this.singleFlight = singleFlight ?? new SingleFlight<string, V>();
  }

  /**
   * Get-or-compute with single-flight protection.
   *
   * On cache miss, the result of `compute()` is written to the cache
   * with the provided `ttlSeconds` and `tags` (Invariants I9 + I10).
   * If `compute()` rejects, no cache write occurs and all concurrent
   * waiters reject with the same error (single-flight semantics).
   *
   * @param key - Cache key.
   * @param opts - TTL + tags applied on cache write.
   * @param compute - Async producer invoked at most once per concurrent
   *   wave per key.
   * @returns Cached or freshly computed value.
   */
  async get(
    key: string,
    opts: CacheSetOptions,
    compute: () => Promise<V>,
  ): Promise<V> {
    // Try cache first — hit returns immediately, no single-flight needed.
    const cached = await this.cache.get(key);
    if (cached !== null) {
      // Cache stores `unknown` (domain-agnostic port). The caller asks
      // for `V`; the runtime invariant is that the writer used the same
      // key under the same `V` — there is no safer typed read here.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: cache port erases V; writer/reader must agree on key→type
      return cached as V;
    }

    // Cache miss — coalesce concurrent compute via single-flight.
    return this.singleFlight.do(key, async () => {
      const value = await compute();
      // Write-through. If `set` throws, the error propagates to all
      // single-flight waiters and the entry is evicted (so the next
      // call re-attempts compute), mirroring the Rust behaviour.
      await this.cache.set(key, value, opts);
      return value;
    });
  }
}
