import { describe, test, expect, vi } from 'vitest';
import { SingleFlight } from '@atlas/platform-core';

/**
 * Spec for `SingleFlight<K, V>` — TS counterpart of
 * `crates/runtime/src/singleflight.rs`.
 *
 * Single-flight pattern: when N concurrent callers invoke `.do(key, fn)`
 * with the same key, the compute fn runs exactly once and all callers
 * await the same result. The map entry is evicted after the compute
 * settles (success or error) — singleflight does not cache results;
 * that's the cache layer's job.
 *
 * API (matches Rust shape, idiomatic TS):
 *   const sf = new SingleFlight<string, number>();
 *   const v: number = await sf.do('key', async () => 42);
 */

/** Manual deferred — used as a "gate" to hold the compute fn open
 *  until all racing callers have joined the in-flight slot. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SingleFlight', () => {
  test('same key, concurrent: compute fn runs once, all callers get same value', async () => {
    const sf = new SingleFlight<string, number>();
    const gate = deferred<void>();
    const compute = vi.fn(async () => {
      // Hold open until all 10 callers have joined the in-flight slot.
      await gate.promise;
      return 42;
    });

    // Race 10 concurrent calls for the same key.
    const calls = Array.from({ length: 10 }, () => sf.do('key1', compute));

    // Yield to the microtask queue so all 10 callers register before
    // we release the gate. The first caller is the one running compute;
    // the other 9 must attach to the same in-flight entry.
    await Promise.resolve();
    await Promise.resolve();

    gate.resolve();

    const results = await Promise.all(calls);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r).toBe(42);
    }
  });

  test('different keys: compute fns run in parallel', async () => {
    const sf = new SingleFlight<string, string>();
    const gateA = deferred<void>();
    const gateB = deferred<void>();
    const fnA = vi.fn(async () => {
      await gateA.promise;
      return 'A';
    });
    const fnB = vi.fn(async () => {
      await gateB.promise;
      return 'B';
    });

    const pA = sf.do('a', fnA);
    const pB = sf.do('b', fnB);

    // Both compute fns must have started before either resolves.
    await Promise.resolve();
    await Promise.resolve();
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);

    gateA.resolve();
    gateB.resolve();

    await expect(pA).resolves.toBe('A');
    await expect(pB).resolves.toBe('B');
  });

  test('error propagation: all waiters receive the same error', async () => {
    const sf = new SingleFlight<string, number>();
    const gate = deferred<void>();
    const boom = new Error('computation failed');
    const compute = vi.fn(async () => {
      await gate.promise;
      throw boom;
    });

    const calls = Array.from({ length: 5 }, () =>
      sf.do('error-key', compute).then(
        (v) => ({ ok: true as const, v }),
        (e: unknown) => ({ ok: false as const, e }),
      ),
    );

    await Promise.resolve();
    await Promise.resolve();

    gate.resolve();

    const results = await Promise.all(calls);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        // All waiters see the same error message (Rust semantics:
        // String error cloned to all callers).
        expect((r.e as Error).message).toBe('computation failed');
      }
    }
  });

  test('eviction after settle: subsequent call re-runs compute', async () => {
    const sf = new SingleFlight<string, number>();
    let callCount = 0;
    const compute = vi.fn(async () => {
      callCount += 1;
      return callCount;
    });

    const v1 = await sf.do('k', compute);
    const v2 = await sf.do('k', compute);

    expect(compute).toHaveBeenCalledTimes(2);
    expect(v1).toBe(1);
    expect(v2).toBe(2);
  });

  test('eviction after error: subsequent call re-runs compute', async () => {
    const sf = new SingleFlight<string, number>();
    let callCount = 0;
    const compute = vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('first call fails');
      }
      return callCount;
    });

    await expect(sf.do('k', compute)).rejects.toThrow('first call fails');

    // Entry must be evicted on rejection — next call re-runs compute.
    const v2 = await sf.do('k', compute);

    expect(compute).toHaveBeenCalledTimes(2);
    expect(v2).toBe(2);
  });
});
