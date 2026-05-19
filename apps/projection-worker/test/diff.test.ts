/**
 * Unit tests for the shadow-mode diff layer.
 *
 * Uses minimal in-memory ProjectionStore / Cache test doubles. The
 * doubles intentionally only implement the surface the wrapper touches.
 */
import { describe, expect, it } from '@atlas/test';
import type { Cache, ProjectionStore } from '@atlas/ports';
import type { CacheSetOptions } from '@atlas/platform-core';
import { wrapShadow } from '../src/diff.ts';
// ---------------------------------------------------------------------------
// Test doubles
class MemProjections implements ProjectionStore {
    store = new Map<string, unknown>();
    async get(key: string): Promise<unknown | null> {
        return this.store.has(key) ? (this.store.get(key) ?? null) : null;
    }
    async set(key: string, value: unknown): Promise<void> {
        this.store.set(key, value);
    }
    async delete(key: string): Promise<boolean> {
        return this.store.delete(key);
    }
}
class MemCache implements Cache {
    store = new Map<string, unknown>();
    async get(key: string): Promise<unknown | null> {
        return this.store.has(key) ? (this.store.get(key) ?? null) : null;
    }
    async set(key: string, value: unknown, _opts: CacheSetOptions): Promise<void> {
        this.store.set(key, value);
    }
    async invalidateByKey(key: string): Promise<boolean> {
        return this.store.delete(key);
    }
    async invalidateByTags(_tags: ReadonlyArray<string>): Promise<number> {
        return 0;
    }
}
const cacheOpts: CacheSetOptions = { ttlSeconds: 60, tags: [] };
// ---------------------------------------------------------------------------
// Tests
describe('wrapShadow — projection writes are not applied to live store', function () {
    it('records set without mutating live', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        const w = wrapShadow({ projections, cache });
        await w.projections.set('k', { hello: 'world' });
        expect(projections.store.has('k')).toBe(false);
    });
    it('records delete without mutating live', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        projections.store.set('k', { v: 1 });
        const w = wrapShadow({ projections, cache });
        await w.projections.delete('k');
        expect(projections.store.get('k')).toEqual({ v: 1 });
    });
    it('reads pass through to live', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        projections.store.set('k', { v: 42 });
        const w = wrapShadow({ projections, cache });
        expect(await w.projections.get('k')).toEqual({ v: 42 });
    });
});
describe('wrapShadow — projection report', function () {
    it('reports no divergence when shadow set matches live', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        // Live already has the same value the worker wants to write.
        projections.store.set('k', { v: 1 });
        const w = wrapShadow({ projections, cache });
        await w.projections.set('k', { v: 1 });
        const report = await w.report();
        expect(report.projectionDivergences).toEqual([]);
        expect(report.cacheDivergences).toEqual([]);
    });
    it('flags divergence when shadow set disagrees with live', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        projections.store.set('k', { v: 1 });
        const w = wrapShadow({ projections, cache });
        await w.projections.set('k', { v: 2 });
        const report = await w.report();
        expect(report.projectionDivergences).toEqual([
            { key: 'k', expected: { v: 2 }, actual: { v: 1 } },
        ]);
    });
    it('flags divergence when shadow set has no live counterpart', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        const w = wrapShadow({ projections, cache });
        await w.projections.set('k', { v: 2 });
        const report = await w.report();
        expect(report.projectionDivergences).toEqual([
            { key: 'k', expected: { v: 2 }, actual: null },
        ]);
    });
    it('flags divergence when shadow delete and live still has the key', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        projections.store.set('k', { v: 1 });
        const w = wrapShadow({ projections, cache });
        await w.projections.delete('k');
        const report = await w.report();
        expect(report.projectionDivergences).toEqual([
            { key: 'k', expected: null, actual: { v: 1 } },
        ]);
    });
    it('reports no divergence when shadow delete matches absent live', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        const w = wrapShadow({ projections, cache });
        await w.projections.delete('missing');
        const report = await w.report();
        expect(report.projectionDivergences).toEqual([]);
    });
    it('clears the recorder after each report call', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        const w = wrapShadow({ projections, cache });
        await w.projections.set('k', { v: 2 });
        const first = await w.report();
        expect(first.projectionDivergences).toHaveLength(1);
        // Without further writes, second report should be empty.
        const second = await w.report();
        expect(second.projectionDivergences).toEqual([]);
        expect(second.cacheDivergences).toEqual([]);
    });
});
describe('wrapShadow — cache wrapping', function () {
    it('records cache set without mutating live cache', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        const w = wrapShadow({ projections, cache });
        await w.cache.set('ck', { hot: true }, cacheOpts);
        expect(cache.store.has('ck')).toBe(false);
    });
    it('flags cache divergence when shadow set disagrees with live', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        cache.store.set('ck', { hot: false });
        const w = wrapShadow({ projections, cache });
        await w.cache.set('ck', { hot: true }, cacheOpts);
        const report = await w.report();
        expect(report.cacheDivergences).toEqual([
            {
                op: 'set',
                key: 'ck',
                details: { expected: { hot: true }, actual: { hot: false } },
            },
        ]);
    });
    it('flags cache invalidateByKey divergence when live still has key', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        cache.store.set('ck', { hot: true });
        const w = wrapShadow({ projections, cache });
        await w.cache.invalidateByKey('ck');
        const report = await w.report();
        expect(report.cacheDivergences).toHaveLength(1);
        expect(report.cacheDivergences[0]?.op).toBe('invalidateByKey');
        expect(report.cacheDivergences[0]?.key).toBe('ck');
    });
    it('cache get passes through to live', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        cache.store.set('ck', { hot: true });
        const w = wrapShadow({ projections, cache });
        expect(await w.cache.get('ck')).toEqual({ hot: true });
    });
    it('invalidateByTags is recorded but never produces a divergence', async function () {
        const projections = new MemProjections();
        const cache = new MemCache();
        const w = wrapShadow({ projections, cache });
        await w.cache.invalidateByTags(['tag-a', 'tag-b']);
        const report = await w.report();
        expect(report.cacheDivergences).toEqual([]);
    });
});
