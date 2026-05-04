/**
 * `EventDispatcher` adapter that fans freshly-dispatched events out to
 * SSE / WebSocket subscribers via `ServerEventBroadcast`.
 *
 * Plugged into the per-request `composeDispatchers` chain in
 * `middleware/state.ts` after the projection rebuilds + cache-tag
 * invalidations have run, so subscribers only see events whose side
 * effects have already been applied.
 *
 * Event-shape mapping mirrors the Rust worker (see
 * `crates/ingress/src/worker.rs`):
 *
 *   - `ContentPages.PageCreateRequested` → `projection.updated`
 *     (resourceType="page", resourceId=payload.pageId).
 *   - any envelope with non-empty `cacheInvalidationTags` →
 *     `cache.invalidated` (resourceType="cache", resourceId=tags joined
 *     with ",").
 *
 * Other event types are ignored for now — the Rust worker only emits
 * those two server-event categories. Add cases here as the worker grows.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { EventDispatcher } from '@atlas/ports';
import type { ServerEventBroadcast } from './broadcast.ts';

export function serverEventDispatcher(
  broadcast: ServerEventBroadcast,
): EventDispatcher {
  return async (envelope: EventEnvelope): Promise<void> => {
    // The same tag list the cache used to invalidate is what the SSE
    // route filters on (`?tags=…`) and what client surfaces match
    // against. We carry it through verbatim — no re-derivation.
    const envelopeTags = envelope.cacheInvalidationTags ?? undefined;
    const tagsForWire =
      envelopeTags && envelopeTags.length > 0 ? envelopeTags : undefined;

    // 1. Page-create → projection.updated (mirrors worker.rs)
    if (envelope.eventType === 'ContentPages.PageCreateRequested') {
      const payload = envelope.payload as { pageId?: unknown } | null;
      const pageId =
        payload && typeof payload === 'object' && typeof payload.pageId === 'string'
          ? payload.pageId
          : '';
      if (pageId.length > 0) {
        broadcast.publish({
          eventType: 'projection.updated',
          tenantId: envelope.tenantId,
          resourceType: 'page',
          resourceId: pageId,
          correlationId: envelope.correlationId,
          occurredAt: envelope.occurredAt,
          ...(tagsForWire ? { tags: tagsForWire } : {}),
        });
      }
    }

    // 2. Cache invalidation tags → cache.invalidated. Rust publishes
    //    this from the worker after `cache.invalidate_by_tags`; the TS
    //    `cacheTagDispatcher` does the actual invalidation earlier in
    //    the chain, so by the time we run the cache is already cleared.
    if (envelopeTags && envelopeTags.length > 0) {
      broadcast.publish({
        eventType: 'cache.invalidated',
        tenantId: envelope.tenantId,
        resourceType: 'cache',
        resourceId: envelopeTags.join(','),
        correlationId: envelope.correlationId,
        occurredAt: envelope.occurredAt,
        tags: envelopeTags,
      });
    }
  };
}
