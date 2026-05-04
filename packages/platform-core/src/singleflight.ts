/**
 * Single-flight pattern for cache stampede protection.
 *
 * TS counterpart of `crates/runtime/src/singleflight.rs`.
 *
 * When N concurrent callers invoke `.do(key, fn)` with the same key, the
 * compute fn runs exactly once and all callers await the same result.
 * The map entry is evicted after the compute settles (success or error) —
 * SingleFlight does not cache results; that is the cache layer's job.
 *
 * @example
 *   const sf = new SingleFlight<string, number>();
 *   const v: number = await sf.do('key', async () => 42);
 */
export class SingleFlight<K, V> {
  /** In-flight computations: key -> shared promise of the compute result. */
  private readonly inFlight = new Map<K, Promise<V>>();

  /**
   * Execute a computation with single-flight protection.
   *
   * If another caller is already computing the same key, this waits for
   * that computation to settle and returns the same value (or throws the
   * same error). Otherwise, it runs `compute`, shares its promise with
   * any concurrent callers, and evicts the entry once it settles.
   */
  do(key: K, compute: () => Promise<V>): Promise<V> {
    const existing = this.inFlight.get(key);
    if (existing !== undefined) {
      return existing;
    }

    // Wrap compute so we can evict the entry on settle without altering
    // the value/error observed by waiters. `let` rather than `const`
    // because TypeScript's flow analysis can't prove the IIFE body's
    // reference to `promise` happens after assignment (it does at
    // runtime — the `finally` runs after the IIFE has been assigned —
    // but the closure captures the binding lexically).
    let promise!: Promise<V>;
    promise = (async () => {
      try {
        return await compute();
      } finally {
        // Eviction must reference the same promise we inserted — guard
        // against a (theoretical) future overwrite.
        if (this.inFlight.get(key) === promise) {
          this.inFlight.delete(key);
        }
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}
