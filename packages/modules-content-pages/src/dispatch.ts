/**
 * ContentPages event dispatcher.
 *
 * Mirrors `dispatchCatalogEvent`: the per-request wiring layer chains
 * this dispatcher after `dispatchCatalogEvent` so envelopes flow through
 * a single fan-out point. Triggers projection rebuilds for `ContentPages.*`
 * event types, then leaves cache invalidation to the caller (the catalog
 * dispatcher already invalidates by tags in the request bundle's
 * outer `dispatch` closure).
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type { Cache, ProjectionStore, RenderTreeStore } from '@atlas/ports';
import type { PageDocument } from './types.ts';
import {
  writePageDocument,
  deletePageDocument,
} from './projections/page-document.ts';
import {
  rebuildRenderTree,
  deleteRenderTree,
} from './projections/render-tree.ts';
import {
  upsertPageInList,
  removePageFromList,
} from './projections/page-list.ts';

export interface ContentPagesDispatchContext {
  projections: ProjectionStore;
  renderTreeStore: RenderTreeStore;
  cache: Cache;
}

const HANDLED_EVENT_TYPES = new Set([
  'ContentPages.PageCreated',
  'ContentPages.PageUpdated',
  'ContentPages.PageDeleted',
]);

export async function dispatchContentPagesEvent(
  envelope: EventEnvelope,
  ctx: ContentPagesDispatchContext,
): Promise<void> {
  if (!HANDLED_EVENT_TYPES.has(envelope.eventType)) return;

  const payload = envelope.payload as Record<string, unknown>;

  if (
    envelope.eventType === 'ContentPages.PageCreated' ||
    envelope.eventType === 'ContentPages.PageUpdated'
  ) {
    const doc = payload['document'] as PageDocument | undefined;
    if (!doc) return;
    await writePageDocument(doc, ctx.projections);
    await upsertPageInList(envelope.tenantId, doc, ctx.projections);
    await rebuildRenderTree(envelope.tenantId, doc.pageId, doc, {
      projections: ctx.projections,
      renderTreeStore: ctx.renderTreeStore,
    });
  } else if (envelope.eventType === 'ContentPages.PageDeleted') {
    const pageId = typeof payload['pageId'] === 'string' ? (payload['pageId'] as string) : '';
    if (!pageId) return;
    await deletePageDocument(envelope.tenantId, pageId, ctx.projections);
    await removePageFromList(envelope.tenantId, pageId, ctx.projections);
    await deleteRenderTree(envelope.tenantId, pageId, {
      projections: ctx.projections,
      renderTreeStore: ctx.renderTreeStore,
    });
  }

  // Cache tag invalidation is the wiring layer's responsibility — the
  // outer `dispatch` closure in `apps/server/src/middleware/state.ts`
  // calls `cache.invalidateByTags(envelope.cacheInvalidationTags)`
  // after both module dispatchers run. Leaving it here would
  // double-invalidate.
  void ctx.cache;
}
