/**
 * ContentPages event dispatcher.
 *
 * Triggers entity writes for `ContentPages.*` event types. Cache-tag
 * invalidation lives in a separate cross-cutting dispatcher in the
 * wiring layer (see `cacheTagDispatcher` consumers in `apps/server`) —
 * do NOT call `cache.invalidateByTags` here.
 *
 * Storage model: Page + PageRenderTree are entities (`entities` table)
 * linked by a `page.render-tree` edge in `relations`. The render tree
 * itself is a pure function of the page document plus an optional WASM
 * plugin output (`pluginRef`).
 */

import type { EventEnvelope, Logger } from '@atlas/platform-core';
import type {
  Cache,
  EntityStore,
  EventDispatcher,
  RelationStore,
  WasmHost,
} from '@atlas/ports';
import type { PageDocument } from './types.ts';
import { buildRenderTree } from './render-tree.ts';
import { putPageEntity, deletePageEntity } from './entities/page.ts';
import {
  putRenderTreeEntity,
  deleteRenderTreeEntity,
} from './entities/page-render-tree.ts';
import { linkRenderTree, unlinkRenderTree } from './entities/relations.ts';

export interface ContentPagesDispatchContext {
  entities: EntityStore;
  relations: RelationStore;
  /**
   * Reserved. Cross-cutting cache invalidation lives in the wiring
   * layer's `cacheTagDispatcher`; this dispatcher does not consume
   * `cache` directly.
   */
  cache?: Cache;
  /**
   * Optional WASM host for `pluginRef`-routed render trees. When
   * unset, pages with `pluginRef` still render the default tree.
   */
  wasmHost?: WasmHost;
  /**
   * Optional logger for projection-time diagnostics (e.g. WASM plugin
   * failures during render-tree build). When unset, those events
   * silently fall back to the default tree.
   */
  logger?: Logger;
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
    await putPageEntity(ctx.entities, doc);
    const tree = await buildRenderTree(doc, ctx.wasmHost, ctx.logger);
    await putRenderTreeEntity(
      ctx.entities,
      doc.tenantId,
      doc.pageId,
      tree,
      doc.pluginRef !== undefined ? { pluginId: doc.pluginRef } : {},
    );
    await linkRenderTree(ctx.relations, doc.tenantId, doc.pageId);
  } else if (envelope.eventType === 'ContentPages.PageDeleted') {
    const pageId = typeof payload['pageId'] === 'string' ? (payload['pageId'] as string) : '';
    if (!pageId) return;
    await deletePageEntity(ctx.entities, envelope.tenantId, pageId);
    await unlinkRenderTree(ctx.relations, envelope.tenantId, pageId);
    await deleteRenderTreeEntity(ctx.entities, envelope.tenantId, pageId);
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
