/**
 * Spec for `CachedRead<V>` — TS counterpart of
 * `crates/runtime/src/cache_helpers.rs::CachedRead`.
 *
 * Mirrors the Rust integration scenarios:
 * - cache hit: cached value returned, compute NOT called
 * - cache miss + N concurrent callers: compute runs exactly once
 * - compute error: propagated to all waiters, NO cache write
 * - cache miss success path: writes value with the supplied TTL + tags
 * - subsequent call after settle: cache hit, no re-compute
 */

import { describe, test, expect, vi } from 'vitest';
import { CachedRead, SingleFlight } from '@atlas/platform-core';
import type { CacheSetOptions } from '@atlas/platform-core';
import { assertDefined } from '@atlas/test-fixtures/assert';

/** Manual deferred — gate compute open until concurrent callers join. */
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

interface CacheSetCall {
  key: string;
  value: unknown;
  opts: CacheSetOptions;
}

/**
 * In-memory `Cache` test double — minimal surface CachedRead actually
 * exercises (`get`/`set`), plus a `setCalls` log so tests can assert
 * the TTL and tags written on cache miss.
 */
class InMemoryCache {
  data = new Map<string, unknown>();
  setCalls: CacheSetCall[] = [];

  async get(key: string): Promise<unknown | null> {
    return this.data.has(key) ? this.data.get(key) ?? null : null;
  }

  async set(key: string, value: unknown, opts: CacheSetOptions): Promise<void> {
    this.setCalls.push({ key, value, opts: { ...opts, tags: [...opts.tags] } });
    this.data.set(key, value);
  }

  async invalidateByKey(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async invalidateByTags(_tags: ReadonlyArray<string>): Promise<number> {
    return 0;
  }
}

const opts: CacheSetOptions = {
  ttlSeconds: 300,
  tags: ['tenant:t-1', 'page:p-9'],
};

describe('CachedRead', () => {
  test('cache hit: returns cached value, compute NOT called', async () => {
    const cache = new InMemoryCache();
    cache.data.set('k', { hello: 'world' });

    const cr = new CachedRead<{ hello: string }>(cache);
    const compute = vi.fn(async () => ({ hello: 'should-not-run' }));

    const value = await cr.get('k', opts, compute);

    expect(value).toEqual({ hello: 'world' });
    expect(compute).not.toHaveBeenCalled();
    // Hit path must NOT trigger a write.
    expect(cache.setCalls).toHaveLength(0);
  });

  test('cache miss + concurrent callers: compute runs exactly once', async () => {
    const cache = new InMemoryCache();
    const cr = new CachedRead<number>(cache);

    const gate = deferred<void>();
    const compute = vi.fn(async () => {
      await gate.promise;
      return 42;
    });

    // Race 10 concurrent callers on the same key.
    const calls = Array.from({ length: 10 }, () => cr.get('k', opts, compute));

    // Yield so all callers join the in-flight slot before compute settles.
    await Promise.resolve();
    await Promise.resolve();

    gate.resolve();

    const results = await Promise.all(calls);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r).toBe(42);
    }
    // Single-flight wraps the compute+set, so set is also called once.
    expect(cache.setCalls).toHaveLength(1);
  });

  test('compute error: propagates to all waiters, NO cache write', async () => {
    const cache = new InMemoryCache();
    const cr = new CachedRead<number>(cache);

    const gate = deferred<void>();
    const boom = new Error('compute failed');
    const compute = vi.fn(async () => {
      await gate.promise;
      throw boom;
    });

    const calls = Array.from({ length: 5 }, () =>
      cr.get('k', opts, compute).then(
        (v) => ({ ok: true as const, v }),
        (e: unknown) => ({ ok: false as const, e }),
      ),
    );

    await Promise.resolve();
    await Promise.resolve();

    gate.resolve();

    const results = await Promise.all(calls);

    expect(compute).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.e).toBeInstanceOf(Error);
        expect(r.e instanceof Error ? r.e.message : '').toBe('compute failed');
      }
    }
    // No value should be cached on compute failure.
    expect(cache.setCalls).toHaveLength(0);
    expect(await cache.get('k')).toBeNull();
  });

  test('successful compute writes to cache with correct TTL + tags', async () => {
    const cache = new InMemoryCache();
    const cr = new CachedRead<{ id: string }>(cache);

    const myOpts: CacheSetOptions = {
      ttlSeconds: 600,
      tags: ['tenant:t-7', 'page:p-42'],
    };

    const value = await cr.get('cache:doc:t-7:p-42', myOpts, async () => ({
      id: 'doc-1',
    }));

    expect(value).toEqual({ id: 'doc-1' });
    expect(cache.setCalls).toHaveLength(1);
    const call = assertDefined(cache.setCalls[0], 'setCalls length asserted above');
    expect(call.key).toBe('cache:doc:t-7:p-42');
    expect(call.value).toEqual({ id: 'doc-1' });
    expect(call.opts.ttlSeconds).toBe(600);
    expect(call.opts.tags).toEqual(['tenant:t-7', 'page:p-42']);
  });

  test('subsequent call after settle: hits cache, does NOT re-run compute', async () => {
    const cache = new InMemoryCache();
    const cr = new CachedRead<number>(cache);

    let calls = 0;
    const compute = vi.fn(async () => {
      calls += 1;
      return 7;
    });

    const v1 = await cr.get('k', opts, compute);
    const v2 = await cr.get('k', opts, compute);

    expect(v1).toBe(7);
    expect(v2).toBe(7);
    // First call computed; second call hit cache.
    expect(compute).toHaveBeenCalledTimes(1);
    expect(calls).toBe(1);
    // Single write-through from the first call.
    expect(cache.setCalls).toHaveLength(1);
  });

  test('different keys do not share a single-flight slot', async () => {
    const cache = new InMemoryCache();
    const cr = new CachedRead<string>(cache);

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

    const pA = cr.get('a', opts, fnA);
    const pB = cr.get('b', opts, fnB);

    // Both compute fns must have started before either settles.
    await Promise.resolve();
    await Promise.resolve();
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);

    gateA.resolve();
    gateB.resolve();

    await expect(pA).resolves.toBe('A');
    await expect(pB).resolves.toBe('B');
  });

  test('accepts an injected SingleFlight for shared in-flight slots', async () => {
    const cache = new InMemoryCache();
    const sf = new SingleFlight<string, number>();
    const cr = new CachedRead<number>(cache, sf);

    const value = await cr.get('k', opts, async () => 1);

    expect(value).toBe(1);
    expect(cache.setCalls).toHaveLength(1);
  });
});
