/**
 * Tests for `apps/server/src/middleware/state.ts` — focused on the I12
 * worker-mirror invariant: the inline dispatcher chain composition MUST
 * match the projection-worker's composition (same module dispatchers,
 * same order, modulo the cross-cutting `principal-cache`, `policy-cache`,
 * and `server-events` which the worker does not run today — all three
 * mutate server-process-local in-memory state that the worker has no
 * handle on).
 *
 * We assert against the canonical name lists exported from each module
 * (`REQUEST_DISPATCHER_CHAIN_NAMES`, `WORKER_DISPATCHER_CHAIN_NAMES`).
 * The lists are the source of truth for the names that the actual
 * `composeDispatchers(...)` call sites pass to `wrap(...)`. If a future
 * change adds, removes, or reorders a dispatcher in only one place, this
 * test fails — that's the I12 mechanical check.
 *
 * The worker module is reached via a relative path because there is no
 * package dependency from `@atlas/server` to `@atlas/projection-worker`
 * (and adding one would introduce a cycle once the worker grows real
 * deps on server-side wiring). Tests are the only consumers.
 *
 * Constructing real adapter instances + running `buildRequestBundle` is
 * outside the scope of this file; integration tests (when added) would
 * exercise the full per-request bundle. This unit test is purely
 * structural.
 */
import { describe, it, expect } from 'vitest';
import { REQUEST_DISPATCHER_CHAIN_NAMES } from './state.ts';
import { WORKER_DISPATCHER_CHAIN_NAMES } from '../../../projection-worker/src/tenant-loop.ts';
describe('inline dispatcher chain composition (I12 worker mirror)', function () {
    it('inline chain lists every per-module dispatcher in the canonical order', function () {
        // The order is intentional and load-bearing — see the comment in
        // `state.ts` next to the `composeDispatchers(...)` call. If you
        // reorder, update both lists AND the comment.
        expect(REQUEST_DISPATCHER_CHAIN_NAMES).toEqual([
            'catalog',
            'content-pages',
            'identity',
            'repository',
            'cache-tag',
            'principal-cache',
            'policy-cache',
            'server-events',
        ]);
    });
    it('worker chain is a structural prefix of the inline chain (parity)', function () {
        // The worker omits `principal-cache` (in-process LRU on AppState),
        // `policy-cache` (Cedar bundle invalidation), and `server-events`
        // (SSE fanout) — all three are server-process-local. Everything else
        // MUST match name-for-name and order-for-order.
        const inlineCore = REQUEST_DISPATCHER_CHAIN_NAMES.filter(function (n) {
            return n !== 'principal-cache' && n !== 'policy-cache' && n !== 'server-events';
        });
        expect(WORKER_DISPATCHER_CHAIN_NAMES).toEqual(inlineCore);
    });
    it('cache-tag runs AFTER every per-module dispatcher in both chains', function () {
        // Cache-tag invalidation must observe tags emitted by per-module
        // projections. If a per-module dispatcher accidentally lands after
        // cache-tag, freshly-emitted tags would not be purged in the same
        // request — silent stale-cache (Invariant I10 violation).
        const moduleDispatchers = ['catalog', 'content-pages', 'identity', 'repository'];
        const inlineCacheTagIdx = REQUEST_DISPATCHER_CHAIN_NAMES.indexOf('cache-tag');
        expect(inlineCacheTagIdx).toBeGreaterThanOrEqual(0);
        for (const name of moduleDispatchers) {
            const idx = REQUEST_DISPATCHER_CHAIN_NAMES.indexOf(name);
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(inlineCacheTagIdx);
        }
        const workerCacheTagIdx = WORKER_DISPATCHER_CHAIN_NAMES.indexOf('cache-tag');
        expect(workerCacheTagIdx).toBeGreaterThanOrEqual(0);
        for (const name of moduleDispatchers) {
            const idx = WORKER_DISPATCHER_CHAIN_NAMES.indexOf(name);
            expect(idx).toBeGreaterThanOrEqual(0);
            expect(idx).toBeLessThan(workerCacheTagIdx);
        }
    });
    it('policy-cache (when present) runs AFTER cache-tag', function () {
        // The next policy evaluation must see the freshly-activated bundle;
        // policy-cache invalidation runs after the cache-tag dispatcher in
        // the inline chain by design.
        const ct = REQUEST_DISPATCHER_CHAIN_NAMES.indexOf('cache-tag');
        const pc = REQUEST_DISPATCHER_CHAIN_NAMES.indexOf('policy-cache');
        expect(pc).toBeGreaterThan(ct);
    });
    it('server-events is last in the inline chain', function () {
        // SSE subscribers only see events after the cache+policy state is
        // consistent. Adding anything after `server-events` would mean the
        // subscriber wakes before downstream side effects settle.
        expect(REQUEST_DISPATCHER_CHAIN_NAMES[REQUEST_DISPATCHER_CHAIN_NAMES.length - 1]).toBe('server-events');
    });
});
