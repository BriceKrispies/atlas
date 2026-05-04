/**
 * `PageRenderTree` entity — typed wrappers around `EntityStore` for
 * the page render tree.
 *
 * One render tree per page. The entity_id is derived from the page id
 * via `renderTreeEntityIdFor` so it doesn't collide with the page's
 * own entity_id space (we use the same store for multiple types but
 * the (tenant_id, entity_type, entity_id) PK already handles that —
 * the prefixed id is purely for human readability when peeking at
 * `entities.entity_id` directly).
 *
 * The render tree's link to its page is encoded as a relation
 * (`page.render-tree` edge), not a foreign-key column. See
 * `./relations.ts`.
 */

import type { EntityStore } from '@atlas/ports';
import type { RenderNode, RenderTree } from '../types.ts';

export const PAGE_RENDER_TREE_ENTITY_TYPE = 'PageRenderTree';
export const PAGE_RENDER_TREE_LATEST_VERSION = 1;

/**
 * Persisted attribute shape for a `PageRenderTree` entity. Adds
 * `pageId` (so an entity row can be self-describing without a
 * relation lookup) and provenance (`pluginId`, `pluginVersion`,
 * `builtAt`) that the legacy `page_render_trees` table carried in
 * dedicated columns.
 */
export interface PageRenderTreeAttrs {
  pageId: string;
  version: 1;
  nodes: RenderNode[];
  pluginId?: string;
  pluginVersion?: string;
  builtAt: string;
}

export function renderTreeEntityIdFor(pageId: string): string {
  return `rt:${pageId}`;
}

export async function getRenderTreeEntity(
  store: EntityStore,
  tenantId: string,
  pageId: string,
): Promise<PageRenderTreeAttrs | null> {
  const row = await store.get<PageRenderTreeAttrs>(
    tenantId,
    PAGE_RENDER_TREE_ENTITY_TYPE,
    renderTreeEntityIdFor(pageId),
  );
  // Soft-deleted render trees: same rule as `getPageEntity` — treat
  // status!='active' as gone so the page-delete dispatcher's
  // deleteRenderTreeEntity call clears single-row reads too, not just
  // list reads.
  if (!row || row.status !== 'active') return null;
  return row.attrs;
}

export interface PutRenderTreeOptions {
  pluginId?: string;
  pluginVersion?: string;
}

export async function putRenderTreeEntity(
  store: EntityStore,
  tenantId: string,
  pageId: string,
  tree: RenderTree,
  opts: PutRenderTreeOptions = {},
): Promise<void> {
  const attrs: PageRenderTreeAttrs = {
    pageId,
    version: tree.version,
    nodes: tree.nodes,
    builtAt: new Date().toISOString(),
    ...(opts.pluginId !== undefined ? { pluginId: opts.pluginId } : {}),
    ...(opts.pluginVersion !== undefined ? { pluginVersion: opts.pluginVersion } : {}),
  };
  await store.put<PageRenderTreeAttrs>({
    tenantId,
    entityType: PAGE_RENDER_TREE_ENTITY_TYPE,
    entityId: renderTreeEntityIdFor(pageId),
    attrs,
    schemaVersion: PAGE_RENDER_TREE_LATEST_VERSION,
  });
}

export async function deleteRenderTreeEntity(
  store: EntityStore,
  tenantId: string,
  pageId: string,
): Promise<void> {
  await store.delete(
    tenantId,
    PAGE_RENDER_TREE_ENTITY_TYPE,
    renderTreeEntityIdFor(pageId),
  );
}

/**
 * Convenience: project a `PageRenderTreeAttrs` row back to the
 * canonical `RenderTree` shape callers consumed before the migration.
 * Drops the provenance/builtAt fields which weren't part of the wire
 * shape.
 */
export function toRenderTree(attrs: PageRenderTreeAttrs): RenderTree {
  return { version: attrs.version, nodes: attrs.nodes };
}
