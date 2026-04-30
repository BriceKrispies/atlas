/**
 * Read-side query helpers exposed to the wiring layer.
 *
 * These wrap `ProjectionStore` reads + `RenderTreeStore` fallback so the
 * server route handlers don't need to know which key shape any given
 * projection uses.
 */

import type { ProjectionStore, RenderTreeStore } from '@atlas/ports';
import type { PageDocument, PageSummary, RenderTree } from './types.ts';
import { readPageDocument } from './projections/page-document.ts';
import { listPages as listPagesFromProjection } from './projections/page-list.ts';
import { renderTreeKey } from './ids.ts';

export interface ContentPagesQueryDeps {
  tenantId: string;
  principalId: string;
  correlationId: string;
  projections: ProjectionStore;
  renderTreeStore: RenderTreeStore;
}

export async function listPages(
  deps: ContentPagesQueryDeps,
): Promise<PageSummary[]> {
  return listPagesFromProjection(deps.tenantId, deps.projections);
}

export async function getPage(
  deps: ContentPagesQueryDeps,
  pageId: string,
): Promise<PageDocument | null> {
  return readPageDocument(deps.tenantId, pageId, deps.projections);
}

/**
 * Render-tree read with Postgres fallback. Mirrors the Rust read path
 * order: in-memory projection store first, then durable RenderTreeStore.
 * On a fallback hit, repopulates the in-memory projection so subsequent
 * reads in this process don't touch Postgres.
 */
export async function getRenderTree(
  deps: ContentPagesQueryDeps,
  pageId: string,
): Promise<RenderTree | null> {
  const fast = (await deps.projections.get(
    renderTreeKey(deps.tenantId, pageId),
  )) as RenderTree | null;
  if (fast) return fast;

  const durable = (await deps.renderTreeStore.read(deps.tenantId, pageId)) as
    | RenderTree
    | null;
  if (!durable) return null;

  // Repopulate the fast path. Mirrors the Rust handler.
  await deps.projections.set(renderTreeKey(deps.tenantId, pageId), durable);
  return durable;
}
