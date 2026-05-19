/**
 * Cache-tag → engine.invalidate routing tests.
 */
import { describe, expect, test } from '@atlas/test';
import { applyCacheTags } from '../src/cache-invalidation.ts';
import type { CedarBundleCache } from '../src/cache-invalidation.ts';
class RecordingCache implements CedarBundleCache {
    invalidated: string[] = [];
    invalidatedAll = 0;
    invalidate(tenantId: string): void {
        this.invalidated.push(tenantId);
    }
    invalidateAll(): void {
        this.invalidatedAll += 1;
    }
}
describe('applyCacheTags', function () {
    test('invalidates per Tenant:* tag', function () {
        const cache = new RecordingCache();
        applyCacheTags(cache, ['Tenant:tenant-a']);
        expect(cache.invalidated).toEqual(['tenant-a']);
        expect(cache.invalidatedAll).toBe(0);
    });
    test('handles multiple Tenant:* tags', function () {
        const cache = new RecordingCache();
        applyCacheTags(cache, ['Tenant:a', 'Tenant:b', 'Policy:p1']);
        expect(cache.invalidated.sort()).toEqual(['a', 'b']);
    });
    test('Policy:* without paired Tenant:* falls back to invalidateAll', function () {
        const cache = new RecordingCache();
        applyCacheTags(cache, ['Policy:p1']);
        expect(cache.invalidatedAll).toBe(1);
    });
    test('null/undefined/empty tag list is a no-op', function () {
        const cache = new RecordingCache();
        applyCacheTags(cache, null);
        applyCacheTags(cache, undefined);
        applyCacheTags(cache, []);
        expect(cache.invalidated).toEqual([]);
        expect(cache.invalidatedAll).toBe(0);
    });
    test('ignores Tenant: with empty id', function () {
        const cache = new RecordingCache();
        applyCacheTags(cache, ['Tenant:']);
        expect(cache.invalidated).toEqual([]);
    });
    test('ignores tags outside the Tenant:/Policy: families', function () {
        const cache = new RecordingCache();
        applyCacheTags(cache, ['Family:fam-1', 'Random:foo']);
        expect(cache.invalidated).toEqual([]);
        expect(cache.invalidatedAll).toBe(0);
    });
    test('returns the set of invalidated tenant ids', function () {
        const cache = new RecordingCache();
        const out = applyCacheTags(cache, ['Tenant:a', 'Tenant:b']);
        expect(Array.from(out).sort()).toEqual(['a', 'b']);
    });
});
