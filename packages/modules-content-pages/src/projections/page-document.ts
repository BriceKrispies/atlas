/**
 * PageDocument projection — canonical page record.
 *
 * Stored under `PageDocument:{tenantId}:{pageId}` in the ProjectionStore.
 * The render-tree projection consumes this; the GET `/api/v1/pages/:pageId`
 * endpoint serves it. Owned by the create/update/delete handlers via the
 * dispatcher.
 */

import type { ProjectionStore } from '@atlas/ports';
import type { PageDocument } from '../types.ts';
import { pageDocumentKey } from '../ids.ts';

export async function readPageDocument(
  tenantId: string,
  pageId: string,
  projections: ProjectionStore,
): Promise<PageDocument | null> {
  const v = await projections.get(pageDocumentKey(tenantId, pageId));
  return (v as PageDocument | null) ?? null;
}

export async function writePageDocument(
  doc: PageDocument,
  projections: ProjectionStore,
): Promise<void> {
  await projections.set(pageDocumentKey(doc.tenantId, doc.pageId), doc);
}

export async function deletePageDocument(
  tenantId: string,
  pageId: string,
  projections: ProjectionStore,
): Promise<void> {
  await projections.delete(pageDocumentKey(tenantId, pageId));
}
