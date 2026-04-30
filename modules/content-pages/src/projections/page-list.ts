/**
 * PageList projection — per-tenant summary list of pages.
 *
 * `ProjectionStore` is a key-value port with no iteration, so we maintain
 * a single `PageList:{tenantId}` projection that the create/update/delete
 * handlers mutate via the dispatcher. This is the source for the GET
 * `/api/v1/pages` endpoint.
 *
 * Concurrency note: this is a read-modify-write on a string key. The
 * port doesn't expose CAS today, so concurrent writers can stomp each
 * other. For Chunk 7 the admin's per-request flow is single-writer —
 * this is acceptable. A follow-up should either:
 *   1. Add a `ProjectionStore.update(key, fn)` CAS hook, or
 *   2. Move the page list to the events store (rebuildable from event
 *      history alone — Invariant I12).
 */

import type { ProjectionStore } from '@atlas/ports';
import type { PageDocument, PageSummary } from '../types.ts';
import { pageListKey } from '../ids.ts';

function toSummary(doc: PageDocument): PageSummary {
  return {
    pageId: doc.pageId,
    title: doc.title,
    slug: doc.slug,
    status: doc.status,
    updatedAt: doc.updatedAt,
  };
}

async function readList(
  projections: ProjectionStore,
  tenantId: string,
): Promise<PageSummary[]> {
  const raw = (await projections.get(pageListKey(tenantId))) as
    | PageSummary[]
    | null;
  return raw ? raw.slice() : [];
}

async function writeList(
  projections: ProjectionStore,
  tenantId: string,
  list: PageSummary[],
): Promise<void> {
  // Sort deterministically so projection bytes are stable across rebuilds
  // (matches the catalog projection rebuild-determinism contract).
  list.sort((a, b) => a.pageId.localeCompare(b.pageId));
  await projections.set(pageListKey(tenantId), list);
}

export async function upsertPageInList(
  tenantId: string,
  doc: PageDocument,
  projections: ProjectionStore,
): Promise<void> {
  const list = await readList(projections, tenantId);
  const idx = list.findIndex((p) => p.pageId === doc.pageId);
  const summary = toSummary(doc);
  if (idx >= 0) list[idx] = summary;
  else list.push(summary);
  await writeList(projections, tenantId, list);
}

export async function removePageFromList(
  tenantId: string,
  pageId: string,
  projections: ProjectionStore,
): Promise<void> {
  const list = await readList(projections, tenantId);
  const idx = list.findIndex((p) => p.pageId === pageId);
  if (idx < 0) return;
  list.splice(idx, 1);
  await writeList(projections, tenantId, list);
}

export async function listPages(
  tenantId: string,
  projections: ProjectionStore,
): Promise<PageSummary[]> {
  return readList(projections, tenantId);
}
