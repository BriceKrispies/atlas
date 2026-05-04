/**
 * Relation helpers for content-pages.
 *
 * Two edge types are declared:
 *   - `page.render-tree` (1:1) — every Page links to its PageRenderTree.
 *     Maintained by the create/update/delete handlers.
 *   - `page.widget` (1:N) — declared but **unused today**. Reserved for
 *     when the widgets domain lands; the metadata seed registers the
 *     edge type so consumers can bind to it without a registry write.
 *
 * The render-tree edge could in theory be derived from
 * `renderTreeEntityIdFor(pageId)` directly without a relation row, but
 * keeping the relation explicit lets the L3 query system join through
 * relations uniformly (Phase C).
 */

import type { RelationStore } from '@atlas/ports';
import { renderTreeEntityIdFor } from './page-render-tree.ts';

export const PAGE_RENDER_TREE_EDGE = 'page.render-tree';
/** Declared, unused today. Widgets domain consumes this edge type. */
export const PAGE_WIDGET_EDGE = 'page.widget';

export async function linkRenderTree(
  store: RelationStore,
  tenantId: string,
  pageId: string,
): Promise<void> {
  await store.add({
    tenantId,
    edgeType: PAGE_RENDER_TREE_EDGE,
    fromId: pageId,
    toId: renderTreeEntityIdFor(pageId),
  });
}

export async function unlinkRenderTree(
  store: RelationStore,
  tenantId: string,
  pageId: string,
): Promise<void> {
  await store.remove(
    tenantId,
    PAGE_RENDER_TREE_EDGE,
    pageId,
    renderTreeEntityIdFor(pageId),
  );
}

/**
 * Resolve the render-tree entity id for a page via the relation. Returns
 * the deterministic `renderTreeEntityIdFor(pageId)` when the edge
 * exists; null otherwise. Most callers can skip the lookup and
 * directly call `getRenderTreeEntity(pageId)` since the id is
 * computable, but going through the relation matches the L3 read
 * pattern Phase C will lean on.
 */
export async function findRenderTreeIdFor(
  store: RelationStore,
  tenantId: string,
  pageId: string,
): Promise<string | null> {
  const edges = await store.outgoing(tenantId, PAGE_RENDER_TREE_EDGE, pageId);
  return edges[0]?.toId ?? null;
}
