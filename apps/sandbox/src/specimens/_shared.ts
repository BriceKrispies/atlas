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

export interface SeedPageDoc {
  pageId: string;
  templateId?: string;
  layoutId?: string;
  meta?: { title?: string; slug?: string };
  [k: string]: unknown;
}

export const sandboxLayoutRegistry = new LayoutRegistry();
for (const layout of presetLayouts as LayoutDocument[]) {
  sandboxLayoutRegistry.register(layout);
}

export const sandboxPageStore = new ValidatingPageStore(new InMemoryPageStore());
for (const doc of seedPages as SeedPageDoc[]) {
  void sandboxPageStore.save(doc.pageId, doc);
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
