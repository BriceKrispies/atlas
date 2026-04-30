/**
 * Types specific to the content-pages module.
 */

export type PageStatus = 'draft' | 'published' | 'archived';

/**
 * Canonical page document persisted by the create/update handlers.
 *
 * Subset of `page-document.v1` that we exercise today (the full v1 shape
 * with regions/templates ships with the page-templates package; this
 * subset is what the admin app currently sends and what the render-tree
 * projection consumes).
 */
export interface PageDocument {
  pageId: string;
  tenantId: string;
  title: string;
  slug: string;
  status: PageStatus;
  content?: string;
  authorId?: string | null;
  templateId?: string;
  templateVersion?: string;
  /**
   * Optional WASM plugin to render this page. When set, the dispatcher
   * routes the build through the configured `WasmHost`; when unset, the
   * default render tree is produced. Mirrors `pageDocument.pluginRef`
   * in the Rust worker (`crates/ingress/src/worker.rs`).
   */
  pluginRef?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PageSummary {
  pageId: string;
  title: string;
  slug: string;
  status: PageStatus;
  updatedAt: string;
}

/**
 * RenderTree shape mirrors `specs/schemas/contracts/render_tree.schema.json`.
 * The Rust default render-tree builder produces the same structure (see
 * `crates/ingress/src/worker.rs::default_render_tree`). Cross-compatible
 * by design.
 */
export interface RenderNode {
  type: string;
  props?: Record<string, string | number | boolean | null>;
  children?: RenderNode[];
}

export interface RenderTree {
  version: 1;
  nodes: RenderNode[];
}
