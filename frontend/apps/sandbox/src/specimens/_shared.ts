/**
 * Shared sandbox state: layout registry, page stores, capability bridge.
 *
 * Centralised here so Pages, Layout Gallery, Page Editor, Layouts, and
 * Layout Editor specimens all observe the same registry — "edit a layout,
 * see the change in the gallery" works without a reload.
 */

import {
  InMemoryPageStore,
  ValidatingPageStore,
  presetLayouts,
  LayoutRegistry,
  InMemoryLayoutStore,
  ValidatingLayoutStore,
  type LayoutDocument,
} from '@atlas/page-templates';
import { seedPages, gallerySeedPages } from '@atlas/bundle-standard/seed-pages';

export interface SeedPageDoc {
  pageId: string;
  templateId?: string;
  layoutId?: string;
  meta?: { title?: string; slug?: string };
  [k: string]: unknown;
}

// Sandbox-scoped layout registry seeded with every bundled preset. Shared
// across all Layout + Layout Gallery specimens so "edit one, see another"
// can be demoed later without re-seeding.
export const sandboxLayoutRegistry = new LayoutRegistry();
for (const layout of presetLayouts as LayoutDocument[]) {
  sandboxLayoutRegistry.register(layout);
}

// Session-scoped layout store used by the Layout Editor specimens. Saves
// persist across specimen switches until the browser tab reloads.
export const sandboxLayoutStore = new ValidatingLayoutStore(
  new InMemoryLayoutStore(
    Object.fromEntries((presetLayouts as LayoutDocument[]).map((l) => [l.layoutId, l])),
  ),
);

// Session-scoped page store shared by Pages + Layout Gallery specimens.
export const sandboxPageStore = new ValidatingPageStore(new InMemoryPageStore());
for (const doc of seedPages as SeedPageDoc[]) {
  void sandboxPageStore.save(doc.pageId, doc);
}
for (const doc of gallerySeedPages as SeedPageDoc[]) {
  void sandboxPageStore.save(doc.pageId, doc);
}

// Sandbox-local capability bridge — announcements uses `backend.query`
// to fetch media files in "file" mode. The seed pages only use "text"
// mode so this is defensive, but wiring it here means adding a file
// variant later doesn't need a new specimen.
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
  pageId: string;
  edit: boolean;
}

export function mountContentPage(
  demoEl: HTMLElement,
  ctx: { config: Record<string, unknown>; onLog: (kind: string, payload: unknown) => void },
): () => void {
  const { config, onLog } = ctx;
  const { pageId, edit } = config as unknown as ContentPageMountConfig;
  const page = document.createElement('content-page') as HTMLElement & Record<string, unknown>;
  page['pageId'] = pageId;
  page['pageStore'] = sandboxPageStore;
  // layoutRegistry resolves layoutId-based pages. Legacy templateId-based
  // pages keep using templateRegistry (its default wired in by the bundle
  // import). Both paths coexist.
  page['layoutRegistry'] = sandboxLayoutRegistry;
  page['principal'] = { id: 'u_sandbox', roles: [] };
  page['tenantId'] = 'acme';
  page['correlationId'] = `cid-sandbox-${pageId}-${Date.now()}`;
  page['capabilities'] = sandboxCapabilities;
  page['edit'] = edit === true;
  page['onMediatorTrace'] = (evt: unknown) => onLog('mediator', evt);
  page['onCapabilityTrace'] = (evt: unknown) => onLog('capability', evt);
  demoEl.appendChild(page);
  onLog('page-mount', { pageId, edit: page['edit'] });
  return () => {
    try { page.remove(); } catch { /* already detached */ }
  };
}
