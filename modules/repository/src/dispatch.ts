/**
 * Repository event dispatcher.
 *
 * Idempotently re-applies `Repository.*` events to the canonical
 * `RepositoryStore` + `RepositoryRevisionStore`. At write-time it's a
 * no-op (the handler already wrote the row); at worker-mode
 * replay-from-events it materializes any missing metadata. Cross-cutting
 * cache-tag invalidation lives in `cacheTagDispatcher` (composed in the
 * wiring layer); this dispatcher does NOT call `cache.invalidateByTags`.
 *
 * Both projections are rebuildable from event history alone (Invariant
 * I12). The dispatch test in `test/dispatch.test.ts` exercises that by
 * replaying a synthetic event stream into a fresh pair of stores and
 * asserting the resulting state matches the in-line dispatch path.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type {
  Cache,
  EventDispatcher,
  RepositoryStore,
  RepositoryRevisionStore,
} from '@atlas/ports';
import { applyRepositorySummary } from './projections/repository-summary.ts';
import { applyRevisionList } from './projections/revision-list.ts';
import {
  REPOSITORY_CREATED_EVENT_TYPE,
  REPOSITORY_UPLOADED_EVENT_TYPE,
} from './events.ts';

const HANDLED_EVENT_TYPES = new Set([
  REPOSITORY_CREATED_EVENT_TYPE,
  REPOSITORY_UPLOADED_EVENT_TYPE,
]);

export interface RepositoryDispatchContext {
  repositories: RepositoryStore;
  revisions: RepositoryRevisionStore;
  /**
   * Reserved. Cross-cutting cache invalidation lives in the wiring
   * layer's `cacheTagDispatcher`; this dispatcher does not consume
   * `cache` directly.
   */
  cache?: Cache;
}

export async function dispatchRepositoryEvent(
  envelope: EventEnvelope,
  ctx: RepositoryDispatchContext,
): Promise<void> {
  if (!HANDLED_EVENT_TYPES.has(envelope.eventType)) return;
  await applyRepositorySummary(envelope, ctx.repositories);
  await applyRevisionList(envelope, ctx.revisions);
}

/**
 * Factory: bind a `RepositoryDispatchContext` and return an
 * `EventDispatcher`. Designed for `composeDispatchers`.
 */
export function repositoryDispatcher(
  ctx: RepositoryDispatchContext,
): EventDispatcher {
  return (envelope) => dispatchRepositoryEvent(envelope, ctx);
}
