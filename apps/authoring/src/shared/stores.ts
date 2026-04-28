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

export const authoringLayoutRegistry = new LayoutRegistry();
for (const layout of presetLayouts as LayoutDocument[]) {
  authoringLayoutRegistry.register(layout);
}

export const authoringLayoutStore = new ValidatingLayoutStore(
  new InMemoryLayoutStore(
    Object.fromEntries((presetLayouts as LayoutDocument[]).map((l) => [l.layoutId, l])),
  ),
);

export const authoringPageStore = new ValidatingPageStore(new InMemoryPageStore());
for (const doc of seedPages as SeedPageDoc[]) {
  void authoringPageStore.save(doc.pageId, doc);
}
for (const doc of gallerySeedPages as SeedPageDoc[]) {
  void authoringPageStore.save(doc.pageId, doc);
}

export const authoringCapabilities: Record<string, (args: unknown) => Promise<unknown>> = {
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
  page['pageStore'] = authoringPageStore;
  page['layoutRegistry'] = authoringLayoutRegistry;
  page['principal'] = { id: 'u_authoring', roles: [] };
  page['tenantId'] = 'acme';
  page['correlationId'] = `cid-authoring-${pageId}-${Date.now()}`;
  page['capabilities'] = authoringCapabilities;
  page['edit'] = edit === true;
  page['onMediatorTrace'] = (evt: unknown) => onLog('mediator', evt);
  page['onCapabilityTrace'] = (evt: unknown) => onLog('capability', evt);
  demoEl.appendChild(page);
  onLog('page-mount', { pageId, edit: page['edit'] });
  return () => {
    try { page.remove(); } catch { /* already detached */ }
  };
}
