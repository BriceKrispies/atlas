/**
 * Render-tree projection.
 *
 * Mirrors `crates/ingress/src/worker.rs::build_render_tree` /
 * `default_render_tree` — given a page document, produce the canonical
 * render-tree IR. Persists via:
 *   1. The in-memory `ProjectionStore` at `RenderTree:{tenantId}:{pageId}`
 *      (fast path; matches the Rust read path order).
 *   2. The durable `RenderTreeStore` (Postgres / IDB) so the tree
 *      survives a process restart or an in-memory cache clear.
 *
 * Determinism: the produced tree is a pure function of the page
 * document. Same input -> same bytes — keeps the parity test green
 * (`test_projection_rebuild_is_deterministic`).
 */

import type { ProjectionStore, RenderTreeStore } from '@atlas/ports';
import type { PageDocument, RenderTree } from '../types.ts';
import { renderTreeKey } from '../ids.ts';

/**
 * Default render tree: heading(title) + paragraph("/<slug>"). Mirrors the
 * Rust `default_render_tree` byte-for-byte; deviating breaks the
 * cross-language byte-equivalence guarantee that justifies the shared
 * JSON column shape.
 */
export function defaultRenderTree(title: string, slug: string): RenderTree {
  return {
    version: 1,
    nodes: [
      {
        type: 'heading',
        props: { level: 1 },
        children: [{ type: 'text', props: { content: title } }],
      },
      {
        type: 'paragraph',
        children: [{ type: 'text', props: { content: `/${slug}` } }],
      },
    ],
  };
}

export function buildRenderTree(doc: PageDocument): RenderTree {
  // No WASM plugin path in TS today (mirror of `pluginRef` => default).
  // When the TS WASM host lands, branch here on `doc.pluginRef`.
  return defaultRenderTree(doc.title, doc.slug);
}

export interface RebuildContext {
  projections: ProjectionStore;
  renderTreeStore: RenderTreeStore;
}

/**
 * Rebuild the render tree for a single (tenant, page) pair. Idempotent —
 * call from the dispatcher on PageCreated/PageUpdated events.
 */
export async function rebuildRenderTree(
  tenantId: string,
  pageId: string,
  doc: PageDocument,
  ctx: RebuildContext,
): Promise<RenderTree> {
  const tree = buildRenderTree(doc);
  // 1. In-memory projection for the fast read path.
  await ctx.projections.set(renderTreeKey(tenantId, pageId), tree);
  // 2. Durable write-through. Errors here are NOT swallowed — the caller
  //    decides whether a missing render-tree-store is fatal (sim mode
  //    wires the IDB store; node mode wires Postgres). If the durable
  //    write fails the in-memory copy is still authoritative, but the
  //    caller should know.
  await ctx.renderTreeStore.write(tenantId, pageId, tree);
  return tree;
}

export async function deleteRenderTree(
  tenantId: string,
  pageId: string,
  ctx: RebuildContext,
): Promise<void> {
  await ctx.projections.delete(renderTreeKey(tenantId, pageId));
  await ctx.renderTreeStore.delete(tenantId, pageId);
}
