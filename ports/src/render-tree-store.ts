/**
 * RenderTreeStore — durable storage for page render trees.
 *
 * Mirrors `crates/ingress/src/render_tree_store.rs`:
 *   - `write` upserts a (tenant, page) -> render-tree-json record.
 *   - `read`  returns the render tree for a (tenant, page) pair, or `null`.
 *   - `delete` removes the row (e.g. on Page.Delete).
 *
 * The in-memory ProjectionStore remains the fast path; this port is the
 * write-through + fallback durable store. JSON shape is identical to the
 * Rust column type so render trees are byte-equivalent across Rust/TS.
 */
export interface RenderTreeStore {
  write(tenantId: string, pageId: string, tree: unknown): Promise<void>;
  read(tenantId: string, pageId: string): Promise<unknown | null>;
  delete(tenantId: string, pageId: string): Promise<void>;
}
