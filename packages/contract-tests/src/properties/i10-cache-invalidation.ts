/**
 * I10 — Event-Driven Cache Invalidation (property).
 *
 * @spec: specs/architecture.md#i10-event-driven-cache-invalidation
 * @spec: specs/crosscut/testing.md#§2.2-invariant-layer
 *
 * Invariant (universally quantified): for every emitted event carrying tag
 * `Tenant:${T}`, the cache performs a matching `invalidateByTags` so every
 * entry tagged `Tenant:${T}` is purged (testing.md §2.2). Cache
 * invalidation is tag-driven, never TTL-driven (I10).
 *
 * The seam is `adapters.invalidateForEvent(cache, tags)` — the dispatcher
 * step that turns an event's `cacheInvalidationTags` into purges (the
 * production wire is `cacheTagDispatcher`). The property:
 *
 *   - seeds the cache with entries under a mix of tags,
 *   - "emits" an event with a set of `cacheInvalidationTags`,
 *   - runs the dispatcher step, then
 *   - asserts EVERY entry that shared a tag with the event is gone, and
 *     every entry that shared NO tag survives (no over- or under-purge).
 *
 * A correct dispatcher calls `invalidateByTags(event.cacheInvalidationTags)`;
 * a broken one drops the tags (stale cache, the I10 violation).
 */
import fc from 'fast-check';
import type { Cache } from '@atlas/ports';
import { runConfig } from './_harness.ts';

export interface I10Adapters {
  makeCache: () => Promise<Cache>;
  /**
   * The dispatcher step: given an event's cacheInvalidationTags, purge the
   * matching cache entries. Correct impl is `invalidateByEventTags`.
   */
  invalidateForEvent: (cache: Cache, tags: string[]) => Promise<number>;
}

/** Reference correct dispatcher step — purge by the event's own tags. */
export async function invalidateByEventTags(cache: Cache, tags: string[]): Promise<number> {
  return cache.invalidateByTags(tags);
}

interface SeedEntry {
  key: string;
  tags: string[];
}

const tagArb = fc.constantFrom(
  'Tenant:t1',
  'Tenant:t2',
  'Family:f1',
  'Page:p1',
  'SearchIndex:catalog',
);

const seedArb: fc.Arbitrary<SeedEntry[]> = fc
  .array(
    fc.record({
      key: fc.string({ minLength: 1, maxLength: 6 }),
      tags: fc.array(tagArb, { minLength: 0, maxLength: 3 }),
    }),
    { minLength: 0, maxLength: 12 },
  )
  // De-dupe keys so a later seed doesn't overwrite an earlier one's tags.
  .map((entries) => {
    const seen = new Set<string>();
    return entries.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
  });

const eventTagsArb: fc.Arbitrary<string[]> = fc.array(tagArb, { minLength: 0, maxLength: 3 });

export function runProperty(adapters: I10Adapters): Promise<void> {
  return fc.assert(
    fc.asyncProperty(seedArb, eventTagsArb, async function (seed, eventTags) {
      const cache = await adapters.makeCache();
      for (const e of seed) {
        await cache.set(e.key, e.key, { ttlSeconds: 0, tags: e.tags });
      }

      const eventTagSet = new Set(eventTags);
      await adapters.invalidateForEvent(cache, eventTags);

      for (const e of seed) {
        const shouldPurge = e.tags.some((t) => eventTagSet.has(t));
        const present = (await cache.get(e.key)) !== null;
        // Entry sharing a tag with the event MUST be gone (no stale cache);
        // an entry sharing no tag MUST survive (no over-purge).
        if (shouldPurge && present) return false;
        if (!shouldPurge && !present) return false;
      }
      return true;
    }),
    runConfig(),
  );
}
