/**
 * ContentPages event dispatcher.
 *
 * Triggers projection rebuilds for `ContentPages.*` event types. Cache-tag
 * invalidation lives in a separate cross-cutting dispatcher in the wiring
 * layer (see `cacheTagDispatcher` consumers in apps/server) — do NOT
 * call `cache.invalidateByTags` here.
 */

import type { EventEnvelope } from '@atlas/platform-core';
import type {
  Cache,
  EventDispatcher,
  ProjectionStore,
  RenderTreeStore,
} from '@atlas/ports';
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
  /**
   * Reserved for future use. The wiring layer's separate
   * `cacheTagDispatcher` performs envelope-level tag flushing — this
   * dispatcher does not consume `cache` today. Kept on the context type
   * so existing call sites compile.
   */
  cache?: Cache;
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
}

/**
 * Factory: bind a `ContentPagesDispatchContext` and return an
 * `EventDispatcher`. Designed for `composeDispatchers`.
 */
export function contentPagesDispatcher(
  ctx: ContentPagesDispatchContext,
): EventDispatcher {
  return (envelope) => dispatchContentPagesEvent(envelope, ctx);
}
