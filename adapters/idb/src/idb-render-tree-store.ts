/**
 * IdbRenderTreeStore — sim-mode (`browser / fake-indexeddb`) implementation
 * of `RenderTreeStore`. Mirrors `PostgresRenderTreeStore` byte-for-byte at
 * the value layer so contract tests assert the same shape.
 *
 * Composite key = `${tenantId}${pageId}` — IDB only supports a single
 * string keyPath; the `` separator avoids collision with arbitrary
 * tenant / page id characters that appear in the wild.
 */

import type { RenderTreeStore } from '@atlas/ports';
import type { IdbDb } from './db.ts';

const SEP = '';

function compositeKey(tenantId: string, pageId: string): string {
  return `${tenantId}${SEP}${pageId}`;
}

export class IdbRenderTreeStore implements RenderTreeStore {
  constructor(private readonly db: IdbDb) {}

  async write(tenantId: string, pageId: string, tree: unknown): Promise<void> {
    await this.db.put('page_render_trees', {
      renderTreeKey: compositeKey(tenantId, pageId),
      tenantId,
      pageId,
      tree,
      updatedAt: Date.now(),
    });
  }

  async read(tenantId: string, pageId: string): Promise<unknown | null> {
    const row = await this.db.get('page_render_trees', compositeKey(tenantId, pageId));
    return row ? row.tree : null;
  }

  async delete(tenantId: string, pageId: string): Promise<void> {
    await this.db.delete('page_render_trees', compositeKey(tenantId, pageId));
  }
}
