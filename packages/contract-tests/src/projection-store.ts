import { describe, test, expect, beforeEach } from 'vitest';
import type { ProjectionStore } from '@atlas/ports';

export function projectionStoreContract(makeStore: () => Promise<ProjectionStore>): void {
  describe('ProjectionStore contract', () => {
    let store: ProjectionStore;
    beforeEach(async () => {
      store = await makeStore();
    });

    test('get returns null for a missing key', async () => {
      const v = await store.get('absent');
      expect(v).toBeNull();
    });

    test('set then get round-trips a JSON-shaped value', async () => {
      const v = { kind: 'familyDetail', familyId: 'svc-anniv', revision: 3 };
      await store.set('FamilyDetail:svc-anniv', v);
      const got = await store.get('FamilyDetail:svc-anniv');
      expect(got).toEqual(v);
    });

    test('set with the same key overwrites the previous value', async () => {
      await store.set('k', { v: 1 });
      await store.set('k', { v: 2 });
      const got = await store.get('k');
      expect(got).toEqual({ v: 2 });
    });

    test('delete returns false for a missing key', async () => {
      const removed = await store.delete('never');
      expect(removed).toBe(false);
    });

    test('delete returns true and removes an existing key', async () => {
      await store.set('to-delete', 'v');
      const removed = await store.delete('to-delete');
      expect(removed).toBe(true);
      const got = await store.get('to-delete');
      expect(got).toBeNull();
    });

    test('delete is idempotent on repeated calls', async () => {
      await store.set('to-delete', 'v');
      const r1 = await store.delete('to-delete');
      const r2 = await store.delete('to-delete');
      expect(r1).toBe(true);
      expect(r2).toBe(false);
    });

    test('keys are treated as opaque strings, not paths — no implicit hierarchy', async () => {
      await store.set('a:b', 1);
      await store.set('a:b:c', 2);
      const a = await store.get('a:b');
      const ac = await store.get('a:b:c');
      expect(a).toBe(1);
      expect(ac).toBe(2);
      // Deleting a:b must not affect a:b:c.
      await store.delete('a:b');
      expect(await store.get('a:b:c')).toBe(2);
    });

    test('values can be primitives (number, string, boolean, null)', async () => {
      await store.set('num', 42);
      await store.set('str', 'hello');
      await store.set('bool', true);
      await store.set('nullish', null);

      expect(await store.get('num')).toBe(42);
      expect(await store.get('str')).toBe('hello');
      expect(await store.get('bool')).toBe(true);
      // Null stored as a value vs. not-stored: contract says get returns null for missing.
      // Storing null is allowed; get may return null in either case. We just assert no throw.
      const n = await store.get('nullish');
      expect(n === null || n === undefined).toBe(true);
    });

    test('values can be deeply nested objects and arrays', async () => {
      const v = {
        rows: [
          { id: 'r1', values: { count: 1, items: [{ k: 'a' }, { k: 'b' }] } },
          { id: 'r2', values: { count: 2, items: [] } },
        ],
        meta: { generated: '2026-04-25T00:00:00Z' },
      };
      await store.set('VariantTable:fam', v);
      expect(await store.get('VariantTable:fam')).toEqual(v);
    });

    test('keys are case-sensitive', async () => {
      await store.set('Lower', 'lower');
      await store.set('LOWER', 'upper');
      expect(await store.get('Lower')).toBe('lower');
      expect(await store.get('LOWER')).toBe('upper');
    });

    test('[concurrency] concurrent set + get on independent keys is consistent', async () => {
      const writes: Promise<void>[] = [];
      for (let i = 0; i < 20; i++) {
        writes.push(store.set(`p-${i}`, i));
      }
      await Promise.all(writes);
      const reads = await Promise.all(
        Array.from({ length: 20 }, (_, i) => store.get(`p-${i}`)),
      );
      expect(reads).toEqual(Array.from({ length: 20 }, (_, i) => i));
    });

    test('[concurrency] concurrent overwrites converge to one of the racing values', async () => {
      const ops: Promise<void>[] = [];
      for (let i = 0; i < 10; i++) {
        ops.push(store.set('race', i));
      }
      await Promise.all(ops);
      const final = await store.get('race');
      // Some value in [0..9] must have won; no torn write.
      expect(typeof final).toBe('number');
      expect(final as number).toBeGreaterThanOrEqual(0);
      expect(final as number).toBeLessThanOrEqual(9);
    });
  });
}
