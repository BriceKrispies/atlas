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

import type { ProjectionStore, RenderTreeStore, WasmHost } from '@atlas/ports';
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

/**
 * Build the render tree for a page document.
 *
 * If `doc.pluginRef` is set AND a `WasmHost` is provided, the host is
 * invoked with `{ pageDocument, blocks }` as input and the parsed JSON
 * output is returned as the render tree. The shape MUST match the
 * `RenderTree` interface; the WASM host validates it's a JSON object,
 * but the version/nodes invariants are still the plugin's contract.
 *
 * Falls back to the default render tree when:
 *   - `pluginRef` is unset, or
 *   - no `WasmHost` is configured (sim mode without a host wired), or
 *   - the host throws — we log the error and degrade gracefully
 *     because a missing/buggy plugin must not cripple the page (the
 *     same fallback semantics the Rust counterpart uses).
 */
export async function buildRenderTree(
  doc: PageDocument,
  wasmHost?: WasmHost,
): Promise<RenderTree> {
  if (!doc.pluginRef || !wasmHost) {
    return defaultRenderTree(doc.title, doc.slug);
  }
  try {
    const out = await wasmHost.invoke({
      pluginRef: doc.pluginRef,
      input: {
        pageDocument: doc,
        blocks: [],
        pageId: doc.pageId,
        title: doc.title,
        slug: doc.slug,
        tenantId: doc.tenantId,
        createdAt: doc.createdAt,
      },
    });
    // Output should be a render tree IR. We don't re-validate the
    // structural V1-V17 rules in TS today (matches the executor's
    // "must be an object" minimum); a bad plugin will surface via
    // a user-visible render glitch rather than a silent crash.
    return out as RenderTree;
  } catch (e) {
    // Plugin failed — fall back to default. Surface via console so
    // operators can spot a misbehaving plugin without bringing the
    // page down.
    console.warn(
      `[render-tree] plugin '${doc.pluginRef}' for page ${doc.pageId} failed: ${(e as Error).message}; using default tree`,
    );
    return defaultRenderTree(doc.title, doc.slug);
  }
}

export interface RebuildContext {
  projections: ProjectionStore;
  renderTreeStore: RenderTreeStore;
  /**
   * Optional WASM host. When unset, the dispatcher uses the default
   * render tree even if `doc.pluginRef` is set. Sim-mode parity tests
   * thread a `BrowserWasmHost` here; the server threads a
   * `NodeWasmHost`.
   */
  wasmHost?: WasmHost;
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
  const tree = await buildRenderTree(doc, ctx.wasmHost);
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
