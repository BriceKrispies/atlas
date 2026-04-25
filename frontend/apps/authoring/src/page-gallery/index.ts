import { AtlasElement, AtlasSurface } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';
import { gallerySeedPages } from '@atlas/bundle-standard/seed-pages';
import { mountContentPage, type SeedPageDoc } from '../shared/stores.ts';

const styles = `
  :host {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
  }
  atlas-box[data-role="picker"] {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-md);
    padding: var(--atlas-space-md);
    border-bottom: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-surface);
  }
  atlas-box[data-role="canvas"] {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--atlas-space-md);
    background: var(--atlas-color-bg);
  }
`;

export class AuthoringPageGalleryRoute extends AtlasSurface {
  static override surfaceId = 'authoring.page-gallery';

  private readonly _root: ShadowRoot;
  private _activePageId: string;
  private _cleanup: (() => void) | null = null;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this._root);
    const seeds = gallerySeedPages as SeedPageDoc[];
    this._activePageId = seeds[0]?.pageId ?? '';
  }

  override connectedCallback(): void {
    super.connectedCallback();
    queueMicrotask(() => this._render());
  }

  override disconnectedCallback(): void {
    this._cleanup?.();
    this._cleanup = null;
    super.disconnectedCallback?.();
  }

  private _render(): void {
    const seeds = gallerySeedPages as SeedPageDoc[];
    const options = seeds.map((doc) => ({
      value: doc.pageId,
      label:
        doc.meta?.title?.replace(/^Gallery\s*—\s*/i, '') ??
        doc.templateId ??
        doc.pageId,
    }));

    this._root.innerHTML = `
      <style>${styles}</style>
      <atlas-box data-role="picker">
        <atlas-text variant="medium">Layout</atlas-text>
        <atlas-select data-role="page-select" aria-label="Layout"></atlas-select>
      </atlas-box>
      <atlas-box data-role="canvas"></atlas-box>
    `;

    const select = this._root.querySelector('atlas-select[data-role="page-select"]') as
      | (HTMLElement & { options: unknown; value: string })
      | null;
    if (select) {
      select.options = options;
      select.value = this._activePageId;
      select.addEventListener('change', (ev) => {
        const next = (ev as CustomEvent<{ value: string }>).detail?.value ?? select.value;
        this._activePageId = next;
        this._mount();
      });
    }

    this._mount();
  }

  private _mount(): void {
    const host = this._root.querySelector('atlas-box[data-role="canvas"]') as HTMLElement | null;
    if (!host) return;
    this._cleanup?.();
    this._cleanup = null;
    host.textContent = '';
    const result = mountContentPage(host, {
      config: { pageId: this._activePageId, edit: true },
      onLog: () => {},
    });
    this._cleanup = typeof result === 'function' ? result : null;
  }
}

AtlasElement.define('authoring-page-gallery-route', AuthoringPageGalleryRoute);
