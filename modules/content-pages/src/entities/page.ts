/**
 * `Page` entity — typed wrappers around `EntityStore` for content-pages.
 *
 * Centralizes the `entity_type='Page'` string and the canonical
 * upcaster registration (none today; bumps land here when the
 * PageDocument shape evolves). The wider module imports from here
 * rather than calling `EntityStore` with raw entity_type strings.
 *
 * Schema version: 1. The `attrs` payload is the existing `PageDocument`
 * shape (see `../types.ts`). When a v2 lands, register an upcaster
 * (`entity_type='Page'`, `fromVersion=1`) on the platform-wide
 * `UpcasterRegistry` so reads coerce v1 rows to v2 on the fly.
 */

import type { EntityStore } from '@atlas/ports';
import type { PageDocument } from '../types.ts';

export const PAGE_ENTITY_TYPE = 'Page';
export const PAGE_LATEST_VERSION = 1;

export async function getPageEntity(
  store: EntityStore,
  tenantId: string,
  pageId: string,
): Promise<PageDocument | null> {
  const row = await store.get<PageDocument>(tenantId, PAGE_ENTITY_TYPE, pageId);
  // Soft-deleted rows still exist with status='deleted'. Treat them as
  // gone for read purposes — matches the listPageEntities default
  // (`EntityListOptions.status` defaults to 'active') so single-row reads
  // and list reads agree.
  if (!row || row.status !== 'active') return null;
  return row.attrs;
}

export async function putPageEntity(
  store: EntityStore,
  doc: PageDocument,
): Promise<void> {
  await store.put<PageDocument>({
    tenantId: doc.tenantId,
    entityType: PAGE_ENTITY_TYPE,
    entityId: doc.pageId,
    attrs: doc,
    schemaVersion: PAGE_LATEST_VERSION,
  });
}

export async function deletePageEntity(
  store: EntityStore,
  tenantId: string,
  pageId: string,
): Promise<void> {
  // Soft delete — sets status='deleted' on the entity row. Hard delete
  // belongs to compliance flows and goes through a separate operator
  // path.
  await store.delete(tenantId, PAGE_ENTITY_TYPE, pageId);
}

/**
 * List every active Page in a tenant. Sort happens in the caller — this
 * helper returns them in `entity_id` order (Postgres PK order). Most
 * callers want sort by `updatedAt` DESC; the listPages query function
 * does that in-memory.
 */
export async function listPageEntities(
  store: EntityStore,
  tenantId: string,
): Promise<PageDocument[]> {
  const rows = await store.list<PageDocument>(tenantId, PAGE_ENTITY_TYPE);
  return rows.map((r) => r.attrs);
}
