/**
 * Event dispatcher composition port.
 *
 * Each module that needs to react to events exports a *factory* that
 * captures its per-request adapters (projections / search / cache /
 * etc.) and returns an `EventDispatcher` — a closure of shape
 * `(envelope) => Promise<void>`. The wiring layer (apps/server) calls
 * these factories with the per-request adapter set, then chains the
 * resulting closures through `composeDispatchers`.
 *
 * Why factories instead of `ModuleDispatcher<Ctx>` objects?
 *
 *   - Each module has its own context type (`CatalogDispatchContext`,
 *     `ContentPagesDispatchContext`, ...). Carrying that type all the
 *     way through `composeDispatchers` would force a heterogeneous
 *     tuple generic that fights TypeScript variance and produces
 *     painfully large inferred types at the call site.
 *   - The wiring layer is the only place that knows which adapters go
 *     with which module. Binding the context inside the factory means
 *     the composer only deals with `EventDispatcher` (already-bound
 *     closures), and the chain stays trivially typed.
 *   - Adding module #4 is a one-line edit: write `xxxDispatcher(...)`
 *     once, append it to the composer, done.
 *
 * Composition is sequential and order-independent in the success case
 * (each dispatcher is a no-op for events it doesn't care about). On
 * failure, the chain short-circuits via the rejected promise — the
 * composer does not catch errors. That mirrors today's hand-rolled
 * chain semantics.
 *
 * Port-boundary rule (`eslint.config.ts`): this file MUST NOT import
 * from `@atlas/adapters-*` or `@atlas/modules-*`. The whole point is
 * that each module exports a dispatcher-factory the wiring layer
 * composes; the port itself is module-agnostic.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { Cache } from './cache.ts';

/**
 * Per-request, already-context-bound dispatcher closure. Each module's
 * factory returns one of these.
 */
export type EventDispatcher = (envelope: EventEnvelope) => Promise<void>;

/**
 * Cross-cutting cache-tag invalidation dispatcher.
 *
 * Pre-Chunk 8 this lived inside `dispatchCatalogEvent` and only fired
 * because catalog was first in the chain — a leaky-abstraction smell
 * the audit flagged. Now it's a stand-alone dispatcher and the chain
 * order is irrelevant to whether tag invalidation happens.
 *
 * Reads `envelope.cacheInvalidationTags` and calls `cache.invalidateByTags`
 * when non-empty. No-op otherwise. Composes through `composeDispatchers`
 * exactly like every other dispatcher.
 *
 * Lives in `@atlas/ports` (not in any single module) because it's a
 * cross-cutting concern — every event passes through it regardless of
 * module ownership.
 */
export function cacheTagDispatcher(cache: Cache): EventDispatcher {
  return async (envelope) => {
    const tags = envelope.cacheInvalidationTags;
    if (!tags || tags.length === 0) return;
    await cache.invalidateByTags(tags);
  };
}

/**
 * Compose any number of `EventDispatcher` closures into a single
 * `EventDispatcher`. The composed dispatcher invokes each input in
 * registration order, awaiting between them. `null` / `undefined`
 * entries are skipped (lets callers conditionally include a
 * dispatcher without an explicit branch).
 *
 * The compose order matters only when one dispatcher's side effects
 * are observed by a later one. For Atlas's current chain (catalog,
 * content-pages, cache-tag invalidation, policy-bundle invalidation)
 * the projection rebuilds are independent and the two cache flushes
 * run last so callers see the freshly-projected state.
 */
export function composeDispatchers(
  ...dispatchers: ReadonlyArray<EventDispatcher | null | undefined>
): EventDispatcher {
  // Resolve null/undefined eagerly so the per-event hot path is a
  // straight loop with no branching.
  const real: EventDispatcher[] = [];
  for (const d of dispatchers) {
    if (d != null) real.push(d);
  }
  return async (envelope) => {
    for (const d of real) {
      await d(envelope);
    }
  };
}
