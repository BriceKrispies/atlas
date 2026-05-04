/**
 * Shadow-mode diff layer for the projection worker (Phase 2).
 *
 * The worker runs the dispatcher chain alongside the still-authoritative
 * inline path. To verify the worker WOULD produce the same projection /
 * cache state without competing with inline writes, we wrap the per-tenant
 * `ProjectionStore` and `Cache` adapters so that:
 *
 *   - reads pass through to the LIVE store (so handlers compute on real
 *     state when they upsert);
 *   - writes (set / delete / invalidate) are recorded into in-memory
 *     "shadow" maps and are NOT applied to the live store;
 *   - calling `report()` diffs the shadow record against the live store
 *     and returns per-key divergences, then clears the recorder so the
 *     next reporting cycle starts clean.
 *
 * The tenant loop owns the cadence and the structured logging; this
 * module is intentionally silent.
 */

import type { Cache, ProjectionStore } from '@atlas/ports';
import type { CacheSetOptions } from '@atlas/platform-core';

// ---------------------------------------------------------------------------
// Public types

export interface ProjectionDivergence {
  key: string;
  expected: unknown;
  actual: unknown;
}

export interface CacheDivergence {
  op: string;
  key: string;
  details: unknown;
}

export interface DiffReport {
  projectionDivergences: ProjectionDivergence[];
  cacheDivergences: CacheDivergence[];
}

export interface ShadowWrapped {
  projections: ProjectionStore;
  cache: Cache;
  report(): Promise<DiffReport>;
}

// ---------------------------------------------------------------------------
// Internal recorder shapes

type ProjectionShadowOp =
  | { op: 'set'; value: unknown }
  | { op: 'delete' };

type CacheShadowOp =
  | { op: 'set'; value: unknown; opts: CacheSetOptions }
  | { op: 'invalidateByKey' }
  | { op: 'invalidateByTags'; tags: ReadonlyArray<string> };

// ---------------------------------------------------------------------------
// JSON-shaped deep equality. Sufficient for projections and cache values:
// the platform stores them as JSON in Postgres anyway. Keys deliberately
// not sorted — JSON.stringify is order-sensitive, but both sides come from
// the same handler code so ordering should be stable in practice. If it
// proves flaky we can swap in a stable stringifier later.
function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Wrapper

export function wrapShadow(opts: {
  projections: ProjectionStore;
  cache: Cache;
}): ShadowWrapped {
  const liveProjections = opts.projections;
  const liveCache = opts.cache;

  // Last-write-wins per key — if a handler sets and then deletes the same
  // key in one batch, only the final intent is what we care to compare.
  const projectionShadow = new Map<string, ProjectionShadowOp>();
  const cacheShadow = new Map<string, CacheShadowOp>();

  const projections: ProjectionStore = {
    get(key) {
      return liveProjections.get(key);
    },
    async set(key, value) {
      projectionShadow.set(key, { op: 'set', value });
    },
    async delete(key) {
      projectionShadow.set(key, { op: 'delete' });
      // The port returns boolean (whether the key existed). In shadow mode
      // we don't actually delete anything, so report what live currently
      // shows so callers that branch on this don't see a phantom result.
      const existing = await liveProjections.get(key);
      return existing !== null && existing !== undefined;
    },
  };

  const cache: Cache = {
    get(key) {
      return liveCache.get(key);
    },
    async set(key, value, options) {
      cacheShadow.set(key, { op: 'set', value, opts: options });
    },
    async invalidateByKey(key) {
      cacheShadow.set(key, { op: 'invalidateByKey' });
      const existing = await liveCache.get(key);
      return existing !== null && existing !== undefined;
    },
    async invalidateByTags(tags) {
      // Tag invalidation isn't keyed; record under a synthetic key per call
      // so multiple invocations don't collide.
      const synthetic = `__tags__:${tags.join(',')}:${cacheShadow.size}`;
      cacheShadow.set(synthetic, { op: 'invalidateByTags', tags });
      // We can't know how many entries would have been purged without
      // reading the live cache's tag index, which the port doesn't
      // expose. Return 0 — Phase 2 callers don't act on this.
      return 0;
    },
  };

  async function report(): Promise<DiffReport> {
    const projectionDivergences: ProjectionDivergence[] = [];
    const cacheDivergences: CacheDivergence[] = [];

    for (const [key, op] of projectionShadow) {
      const live = await liveProjections.get(key);
      if (op.op === 'set') {
        if (!jsonEqual(op.value, live)) {
          projectionDivergences.push({
            key,
            expected: op.value,
            actual: live,
          });
        }
      } else {
        // delete
        if (live !== null && live !== undefined) {
          projectionDivergences.push({
            key,
            expected: null,
            actual: live,
          });
        }
      }
    }

    for (const [key, op] of cacheShadow) {
      if (op.op === 'set') {
        const live = await liveCache.get(key);
        if (!jsonEqual(op.value, live)) {
          cacheDivergences.push({
            op: 'set',
            key,
            details: { expected: op.value, actual: live },
          });
        }
      } else if (op.op === 'invalidateByKey') {
        const live = await liveCache.get(key);
        if (live !== null && live !== undefined) {
          cacheDivergences.push({
            op: 'invalidateByKey',
            key,
            details: { stillPresent: live },
          });
        }
      } else {
        // invalidateByTags — we can't verify outcome without a tag index
        // probe on the live cache. Record for visibility but never as a
        // divergence; the tenant loop can decide what to do with it.
        // Intentionally omitted from divergences.
      }
    }

    projectionShadow.clear();
    cacheShadow.clear();

    return { projectionDivergences, cacheDivergences };
  }

  return { projections, cache, report };
}
