/**
 * PostgresRenderTreeStore — Postgres-backed `RenderTreeStore` adapter.
 *
 * TS port of `crates/ingress/src/render_tree_store.rs`. Same `(tenant_id,
 * page_id)` upsert key + `render_tree_json jsonb` column shape so the
 * stored bytes round-trip across Rust and TS deployments without
 * conversion.
 *
 * Schema is installed by `migrations/tenant/20260429000001_page_render_trees.sql`.
 *
 * Unlike the Rust adapter, we do not track `plugin_id` / `plugin_version`
 * on the port surface (they're persisted as nullable columns in case a
 * future TS WASM runtime wants to reuse the same row shape, but the
 * port-level write signature stays narrow — the dispatch layer doesn't
 * have the plugin metadata in scope today).
 */

import type { RenderTreeStore } from '@atlas/ports';
import type postgres from 'postgres';

export class PostgresRenderTreeStore implements RenderTreeStore {
  constructor(private readonly sql: postgres.Sql) {}

  async write(tenantId: string, pageId: string, tree: unknown): Promise<void> {
    await this.sql`
      INSERT INTO page_render_trees (tenant_id, page_id, render_tree_json, updated_at)
      VALUES (${tenantId}, ${pageId}, ${this.sql.json(tree as never)}, now())
      ON CONFLICT (tenant_id, page_id) DO UPDATE SET
        render_tree_json = EXCLUDED.render_tree_json,
        updated_at       = now()
    `;
  }

  async read(tenantId: string, pageId: string): Promise<unknown | null> {
    const rows = await this.sql<Array<{ render_tree_json: unknown }>>`
      SELECT render_tree_json
      FROM page_render_trees
      WHERE tenant_id = ${tenantId} AND page_id = ${pageId}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? row.render_tree_json : null;
  }

  async delete(tenantId: string, pageId: string): Promise<void> {
    await this.sql`
      DELETE FROM page_render_trees
      WHERE tenant_id = ${tenantId} AND page_id = ${pageId}
    `;
  }
}
