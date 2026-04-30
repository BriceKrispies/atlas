import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type { EventEnvelope, SearchDocument } from '@atlas/platform-core';

export interface CacheRow {
  cacheKey: string;
  value: unknown;
  tags: string[];
  expiresAt: number;
}

export interface ProjectionRow {
  projectionKey: string;
  jsonValue: unknown;
  updatedAt: number;
  version: number;
}

export interface SearchRow {
  searchDocumentId: string;
  tenantId: string;
  documentType: string;
  documentId: string;
  doc: SearchDocument;
}

export interface CatalogStateRow {
  tenantId: string;
  seedPackageKey: string;
  seedPackageVersion: string;
  payload: unknown;
  publishedRevisions: Record<string, number>;
}

export interface RenderTreeRow {
  /** Composite key `${tenantId} ${pageId}` — IDB stores need a single string keyPath. */
  renderTreeKey: string;
  tenantId: string;
  pageId: string;
  tree: unknown;
  updatedAt: number;
}

export interface AtlasIdbSchema extends DBSchema {
  events: {
    key: string;
    value: EventEnvelope;
    indexes: {
      by_tenant: string;
      by_type: string;
      by_tenant_idempotency_key: [string, string];
      by_occurred_at: string;
    };
  };
  cache: {
    key: string;
    value: CacheRow;
    indexes: {
      by_tag: string;
      by_expires_at: number;
    };
  };
  projections: {
    key: string;
    value: ProjectionRow;
  };
  search_documents: {
    key: string;
    value: SearchRow;
    indexes: {
      by_tenant_type_doc: [string, string, string];
      by_tenant_type: [string, string];
    };
  };
  catalog_state: {
    key: string;
    value: CatalogStateRow;
  };
  page_render_trees: {
    key: string;
    value: RenderTreeRow;
    indexes: {
      by_tenant_page: [string, string];
    };
  };
}

export type IdbDb = IDBPDatabase<AtlasIdbSchema>;

export async function openAtlasIdb(tenantId: string): Promise<IdbDb> {
  const name = `atlas-sim-${tenantId}`;
  return openDB<AtlasIdbSchema>(name, 3, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        const events = db.createObjectStore('events', { keyPath: 'eventId' });
        events.createIndex('by_tenant', 'tenantId');
        events.createIndex('by_type', 'eventType');
        events.createIndex(
          'by_tenant_idempotency_key',
          ['tenantId', 'idempotencyKey'],
          { unique: true },
        );
        events.createIndex('by_occurred_at', 'occurredAt');

        const cache = db.createObjectStore('cache', { keyPath: 'cacheKey' });
        cache.createIndex('by_tag', 'tags', { multiEntry: true });
        cache.createIndex('by_expires_at', 'expiresAt');

        db.createObjectStore('projections', { keyPath: 'projectionKey' });

        const search = db.createObjectStore('search_documents', { keyPath: 'searchDocumentId' });
        search.createIndex('by_tenant_type_doc', ['tenantId', 'documentType', 'documentId'], {
          unique: true,
        });
        search.createIndex('by_tenant_type', ['tenantId', 'documentType']);

        db.createObjectStore('catalog_state', { keyPath: 'tenantId' });
      }
      if (oldVersion < 2) {
        // v2: tenant-scope idempotency keys. Replace any prior global unique
        // index on `idempotencyKey` with a composite `(tenantId, idempotencyKey)`.
        const events = tx.objectStore('events');
        const existing: string[] = Array.from(events.indexNames);
        if (existing.includes('by_idempotency_key')) {
          events.deleteIndex('by_idempotency_key');
        }
        if (!existing.includes('by_tenant_idempotency_key')) {
          events.createIndex(
            'by_tenant_idempotency_key',
            ['tenantId', 'idempotencyKey'],
            { unique: true },
          );
        }
      }
      if (oldVersion < 3) {
        // v3: render-tree projection store (Chunk 7). Mirrors the Rust
        // `control_plane.page_render_trees` table; keyed by `(tenantId,
        // pageId)`. Used by `IdbRenderTreeStore` in sim mode so the
        // render-tree contract test can run without Postgres.
        const renderTrees = db.createObjectStore('page_render_trees', {
          keyPath: 'renderTreeKey',
        });
        renderTrees.createIndex('by_tenant_page', ['tenantId', 'pageId'], {
          unique: true,
        });
      }
    },
  });
}
