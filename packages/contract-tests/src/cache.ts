import { describe, test, expect, beforeEach } from 'vitest';
import type { Cache } from '@atlas/ports';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function cacheContract(makeCache: () => Promise<Cache>): void {
  describe('Cache contract', () => {
    let cache: Cache;
    beforeEach(async () => {
      cache = await makeCache();
    });

    test('get returns null for a missing key', async () => {
      const v = await cache.get('missing');
      expect(v).toBeNull();
    });

    test('set then get round-trips the value', async () => {
      await cache.set('k1', { hello: 'world' }, { ttlSeconds: 0, tags: [] });
      const v = await cache.get('k1');
      expect(v).toEqual({ hello: 'world' });
    });

    test('set with ttlSeconds=0 stores with no expiry', async () => {
      await cache.set('k-noexp', 'v', { ttlSeconds: 0, tags: [] });
      await sleep(10);
      const v = await cache.get('k-noexp');
      expect(v).toBe('v');
    });

    test('get within TTL returns the value, get after TTL returns null', async () => {
      // ttl is in seconds; emulate "very short" by using 1 second and waiting 1100 ms.
      await cache.set('k-ttl', 'v', { ttlSeconds: 1, tags: [] });
      const fresh = await cache.get('k-ttl');
      expect(fresh).toBe('v');
      await sleep(1100);
      const stale = await cache.get('k-ttl');
      expect(stale).toBeNull();
    });

    test('set then set with the same key overwrites the value', async () => {
      await cache.set('k-over', 'first', { ttlSeconds: 0, tags: [] });
      await cache.set('k-over', 'second', { ttlSeconds: 0, tags: [] });
      const v = await cache.get('k-over');
      expect(v).toBe('second');
    });

    test('invalidateByKey returns true when the entry existed', async () => {
      await cache.set('k-del', 'v', { ttlSeconds: 0, tags: [] });
      const removed = await cache.invalidateByKey('k-del');
      expect(removed).toBe(true);
      const v = await cache.get('k-del');
      expect(v).toBeNull();
    });

    test('invalidateByKey returns false when the entry was never set', async () => {
      const removed = await cache.invalidateByKey('never-existed');
      expect(removed).toBe(false);
    });

    test('invalidateByKey is idempotent on repeated calls', async () => {
      await cache.set('k-idem', 'v', { ttlSeconds: 0, tags: [] });
      const r1 = await cache.invalidateByKey('k-idem');
      const r2 = await cache.invalidateByKey('k-idem');
      expect(r1).toBe(true);
      expect(r2).toBe(false);
    });

    test('invalidateByTags purges every entry with at least one matching tag', async () => {
      await cache.set('k-a', 'a', { ttlSeconds: 0, tags: ['t1', 't2'] });
      await cache.set('k-b', 'b', { ttlSeconds: 0, tags: ['t2'] });
      await cache.set('k-c', 'c', { ttlSeconds: 0, tags: ['t3'] });

      const purged = await cache.invalidateByTags(['t2']);
      expect(purged).toBe(2);
      expect(await cache.get('k-a')).toBeNull();
      expect(await cache.get('k-b')).toBeNull();
      expect(await cache.get('k-c')).toBe('c');
    });

    test('invalidateByTags with multiple tags purges entries matching ANY tag', async () => {
      await cache.set('k-1', 1, { ttlSeconds: 0, tags: ['alpha'] });
      await cache.set('k-2', 2, { ttlSeconds: 0, tags: ['beta'] });
      await cache.set('k-3', 3, { ttlSeconds: 0, tags: ['gamma'] });

      const purged = await cache.invalidateByTags(['alpha', 'beta']);
      expect(purged).toBe(2);
      expect(await cache.get('k-3')).toBe(3);
    });

    test('invalidateByTags returns 0 when no entries match', async () => {
      await cache.set('k-only', 'v', { ttlSeconds: 0, tags: ['only'] });
      const purged = await cache.invalidateByTags(['nope']);
      expect(purged).toBe(0);
      expect(await cache.get('k-only')).toBe('v');
    });

    test('invalidateByTags with an empty tag list returns 0 and changes nothing', async () => {
      await cache.set('k-keep', 'v', { ttlSeconds: 0, tags: ['x'] });
      const purged = await cache.invalidateByTags([]);
      expect(purged).toBe(0);
      expect(await cache.get('k-keep')).toBe('v');
    });

    test('multiple tags on a single entry — purging by ANY one of them removes it once', async () => {
      await cache.set('k-multi', 'v', { ttlSeconds: 0, tags: ['a', 'b', 'c'] });
      const purged = await cache.invalidateByTags(['a', 'b']);
      // Entry should only be counted once even though it matches two tags.
      expect(purged).toBe(1);
      expect(await cache.get('k-multi')).toBeNull();
    });

    test('cache keys with the same string but stored separately stay distinct (key-namespacing is the caller’s job)', async () => {
      // Atlas convention: callers prefix tenantId into the key (Invariant I9).
      // The cache port itself is a flat KV; it must treat distinct keys as distinct.
      await cache.set('tenant-a::summary', 'A', { ttlSeconds: 0, tags: [] });
      await cache.set('tenant-b::summary', 'B', { ttlSeconds: 0, tags: [] });
      expect(await cache.get('tenant-a::summary')).toBe('A');
      expect(await cache.get('tenant-b::summary')).toBe('B');
    });

    test('values survive a JSON-shaped round trip including nested arrays/objects', async () => {
      const value = { a: 1, b: [1, 2, 3], c: { nested: true } };
      await cache.set('k-shape', value, { ttlSeconds: 0, tags: [] });
      const v = await cache.get('k-shape');
      expect(v).toEqual(value);
    });

    test('[concurrency] interleaved sets across keys do not lose entries', async () => {
      const ops: Promise<void>[] = [];
      for (let i = 0; i < 10; i++) {
        ops.push(cache.set(`c-${i}`, i, { ttlSeconds: 0, tags: [`t-${i % 3}`] }));
      }
      await Promise.all(ops);
      for (let i = 0; i < 10; i++) {
        expect(await cache.get(`c-${i}`)).toBe(i);
      }
    });

    test('[error-shape] invalidateByTags([]) is a no-op that returns 0 (does not error)', async () => {
      // The empty-tag invalidation has no defined target rows. Contract pins
      // it to "no error, return 0, mutate nothing" so callers can pass tag
      // arrays from event envelopes without pre-checking emptiness.
      await cache.set('keep-me', 1, { ttlSeconds: 0, tags: ['anything'] });
      await expect(cache.invalidateByTags([])).resolves.toBe(0);
      expect(await cache.get('keep-me')).toBe(1);
    });

    test('[concurrency] two invalidateByTags calls racing over overlapping rows do not double-count', async () => {
      // Build cache state with overlapping tags. 12 entries:
      //   k-a-0..3   tagged ['tagA']
      //   k-b-0..3   tagged ['tagB']
      //   k-ab-0..3  tagged ['tagA', 'tagB']  (the racing rows)
      // Both racers ask for tagA AND tagB. Either:
      //   - one racer gets all 12 and the other gets 0, or
      //   - they split the rows across them.
      // What MUST hold: red + blue == 12, and every row is gone.
      // A non-atomic implementation that double-deletes / double-counts
      // would produce red + blue > 12; a torn one would leave rows.
      const setOps: Promise<void>[] = [];
      for (let i = 0; i < 4; i++) {
        setOps.push(
          cache.set(`k-a-${i}`, i, { ttlSeconds: 0, tags: ['tagA'] }),
          cache.set(`k-b-${i}`, i, { ttlSeconds: 0, tags: ['tagB'] }),
          cache.set(`k-ab-${i}`, i, { ttlSeconds: 0, tags: ['tagA', 'tagB'] }),
        );
      }
      await Promise.all(setOps);

      const [red, blue] = await Promise.all([
        cache.invalidateByTags(['tagA', 'tagB']),
        cache.invalidateByTags(['tagA', 'tagB']),
      ]);

      expect(red + blue).toBe(12);

      for (let i = 0; i < 4; i++) {
        expect(await cache.get(`k-a-${i}`)).toBeNull();
        expect(await cache.get(`k-b-${i}`)).toBeNull();
        expect(await cache.get(`k-ab-${i}`)).toBeNull();
      }
    });
  });
}
