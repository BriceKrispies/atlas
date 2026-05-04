/**
 * Render-tree builder.
 *
 * Pure-ish: `defaultRenderTree` is fully pure; `buildRenderTree`
 * optionally invokes a `WasmHost` for `pluginRef`-routed pages and
 * falls back to the default tree on plugin failure.
 *
 * Determinism for default trees: same (title, slug) → same bytes.
 * Plugin-driven trees are only as deterministic as the plugin.
 */

import type { WasmHost } from '@atlas/ports';
import type { PageDocument, RenderTree } from './types.ts';

/**
 * Default render tree: heading(title) + paragraph("/<slug>").
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
 * invoked with the page document as input and the parsed JSON output is
 * returned as the render tree. The shape MUST match the `RenderTree`
 * interface; the WASM host validates that the output is a JSON object,
 * but version/nodes invariants are the plugin's contract.
 *
 * Falls back to the default render tree when:
 *   - `pluginRef` is unset, or
 *   - no `WasmHost` is configured (sim mode without a host wired), or
 *   - the host throws — logged and degraded so a missing/buggy plugin
 *     does not cripple the page.
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
    return out as RenderTree;
  } catch (e) {
    console.warn(
      `[render-tree] plugin '${doc.pluginRef}' for page ${doc.pageId} failed: ${(e as Error).message}; using default tree`,
    );
    return defaultRenderTree(doc.title, doc.slug);
  }
}
