/**
 * Deterministic id helpers for the content-pages module.
 *
 * Mirrors `@atlas/modules-catalog`'s `ids.ts` shape so dispatch can
 * stamp envelope ids the same way across modules.
 */

export function newEventId(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Projection key for the canonical page document. */
export function pageDocumentKey(tenantId: string, pageId: string): string {
  return `PageDocument:${tenantId}:${pageId}`;
}

/** Projection key for the rendered render tree (mirrors Rust). */
export function renderTreeKey(tenantId: string, pageId: string): string {
  return `RenderTree:${tenantId}:${pageId}`;
}

/** Projection key for the per-tenant page summary list. */
export function pageListKey(tenantId: string): string {
  return `PageList:${tenantId}`;
}
