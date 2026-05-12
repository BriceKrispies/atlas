/**
 * Shared sandbox state for read-only specimens: layout registry, page
 * store, capability bridge.
 *
 * The interactive editor surfaces (page-editor, layout-editor, block-editor,
 * gallery edit variants) live in the authoring app — they own their own
 * layout/page stores. The sandbox keeps only what view-only specimens
 * (Pages content, Layouts) need.
 */

import {
  InMemoryPageStore,
  ValidatingPageStore,
  presetLayouts,
  LayoutRegistry,
  type LayoutDocument,
} from '@atlas/page-templates';
import { seedPages } from '@atlas/bundle-standard/seed-pages';
import { parseMountConfig, v } from '../internal/assert.ts';

export interface SeedPageDoc {
  pageId: string;
  templateId?: string;
  layoutId?: string;
  meta?: { title?: string; slug?: string };
  [k: string]: unknown;
}

/** Type-guard for the minimal `SeedPageDoc` shape — pageId is the only required field. */
export function isSeedPageDoc(d: unknown): d is SeedPageDoc {
  return typeof d === 'object'
    && d !== null
    && typeof (d as { pageId?: unknown }).pageId === 'string';
}

export const sandboxLayoutRegistry = new LayoutRegistry();
for (const layout of presetLayouts as LayoutDocument[]) {
  sandboxLayoutRegistry.register(layout);
}

export const sandboxPageStore = new ValidatingPageStore(new InMemoryPageStore());
// `seedPages` is typed `ReadonlyArray<unknown>` at the bundle boundary —
// the JSON imports don't carry their authored shape. Validate each doc
// against the minimal `SeedPageDoc` contract so the loop is typed
// without an outer `as SeedPageDoc[]` cast.
for (const doc of seedPages) {
  if (isSeedPageDoc(doc)) {
    void sandboxPageStore.save(doc.pageId, doc);
  }
}

export const sandboxCapabilities: Record<string, (args: unknown) => Promise<unknown>> = {
  'backend.query': async (args: unknown) => {
    const { path } = (args ?? {}) as { path?: string };
    if (typeof path === 'string' && path.startsWith('/media/files/')) {
      const fileId = path.slice('/media/files/'.length);
      return {
        id: fileId,
        filename: `${fileId}.png`,
        url: 'https://placehold.co/600x200?text=Sample+Media',
      };
    }
    return null;
  },
};

interface ContentPageMountConfig {
  pageId?: string;
  edit?: boolean;
}

/**
 * Sets a property on an `HTMLElement`. The receiving custom element
 * (`<content-page>`) declares its own property reflection — we forward
 * via `Reflect.set` so no `HTMLElement & Record<string, unknown>` cast
 * is required at this boundary. Mirrors the `html` template binding in
 * `packages/core/src/html.ts`.
 */
function setProp(el: HTMLElement, key: string, value: unknown): void {
  Reflect.set(el, key, value);
}

export function mountContentPage(
  demoEl: HTMLElement,
  ctx: { config: Record<string, unknown>; onLog: (kind: string, payload: unknown) => void },
): () => void {
  const { config, onLog } = ctx;
  // Validate against the optional-field shape and require pageId — the
  // sandbox specimen contract guarantees it. `parseMountConfig` reads
  // each field through its typed validator, so no `as` cast is needed.
  const parsed = parseMountConfig<ContentPageMountConfig>(config, {
    pageId: v.string,
    edit: v.boolean,
  });
  const pageId = parsed.pageId ?? 'unknown';
  const edit = parsed.edit === true;
  const page = document.createElement('content-page');
  setProp(page, 'pageId', pageId);
  setProp(page, 'pageStore', sandboxPageStore);
  setProp(page, 'layoutRegistry', sandboxLayoutRegistry);
  setProp(page, 'principal', { id: 'u_sandbox', roles: [] });
  setProp(page, 'tenantId', 'acme');
  setProp(page, 'correlationId', `cid-sandbox-${pageId}-${Date.now()}`);
  setProp(page, 'capabilities', sandboxCapabilities);
  setProp(page, 'edit', edit);
  setProp(page, 'onMediatorTrace', (evt: unknown) => onLog('mediator', evt));
  setProp(page, 'onCapabilityTrace', (evt: unknown) => onLog('capability', evt));
  demoEl.appendChild(page);
  onLog('page-mount', { pageId, edit });
  return () => {
    try { page.remove(); } catch { /* already detached */ }
  };
}
