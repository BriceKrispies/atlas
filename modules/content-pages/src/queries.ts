/**
 * Read-side query helpers exposed to the wiring layer.
 *
 * Post-migration (Phase B.1, Stage 3): reads come from `EntityStore` +
 * `RelationStore`. The legacy `ProjectionStore` + `RenderTreeStore`
 * fast-path / durable-fallback dance is gone — `Page` and
 * `PageRenderTree` rows in `entities` are canonical, with the
 * `page.render-tree` edge linking them.
 */

import type { EntityStore, RelationStore } from '@atlas/ports';
import type { PageDocument, PageSummary, RenderTree } from './types.ts';
import {
  getPageEntity,
  listPageEntities,
} from './entities/page.ts';
import {
  getRenderTreeEntity,
  toRenderTree,
} from './entities/page-render-tree.ts';
import { findRenderTreeIdFor } from './entities/relations.ts';

export interface ContentPagesQueryDeps {
  tenantId: string;
  principalId: string;
  correlationId: string;
  entities: EntityStore;
  relations: RelationStore;
}

export async function listPages(
  deps: ContentPagesQueryDeps,
): Promise<PageSummary[]> {
  const docs = await listPageEntities(deps.entities, deps.tenantId);
  // Sort by updatedAt DESC to match the legacy projection's ordering.
  // EntityStore.list returns rows in entity_id order, so the sort is
  // applied here. Page counts per tenant are small (<10k) — see plan
  // risk #6; if it ever stops being small, add a projection back.
  const sorted = [...docs].sort((a, b) =>
    a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
  );
  return sorted.map((doc) => ({
    pageId: doc.pageId,
    title: doc.title,
    slug: doc.slug,
    status: doc.status,
    updatedAt: doc.updatedAt,
  }));
}

export async function getPage(
  deps: ContentPagesQueryDeps,
  pageId: string,
): Promise<PageDocument | null> {
  return getPageEntity(deps.entities, deps.tenantId, pageId);
}

/**
 * Render-tree read. Single path: relation → entity. The legacy
 * fast-path projection + Postgres-fallback dance is retired; both
 * legs collapsed to one `EntityStore.get('PageRenderTree', ...)` after
 * relation traversal.
 *
 * Perf trade-off (per plan risk #4): two round trips on the cold path
 * (relation lookup, then entity fetch) versus the legacy single-row
 * projection read. If a perf signal warrants it, a `cache_entries`-
 * backed memoization keyed by `RenderTree:<tenantId>:<pageId>` can be
 * layered in here. Defer until measured.
 */
export async function getRenderTree(
  deps: ContentPagesQueryDeps,
  pageId: string,
): Promise<RenderTree | null> {
  const renderTreeId = await findRenderTreeIdFor(
    deps.relations,
    deps.tenantId,
    pageId,
  );
  if (!renderTreeId) return null;

  const attrs = await getRenderTreeEntity(
    deps.entities,
    deps.tenantId,
    pageId,
  );
  // Relation can briefly dangle during a multi-step dispatch — null is
  // the expected fallback when the edge exists but the entity hasn't
  // landed (or has been removed) yet.
  if (!attrs) return null;

  return toRenderTree(attrs);
}
