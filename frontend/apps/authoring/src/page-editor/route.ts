import { AtlasElement, AtlasSurface } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';
import { InMemoryPageStore, ValidatingPageStore } from '@atlas/page-templates';
import { authoringCapabilities, authoringLayoutRegistry } from '../shared/stores.ts';
import { createMountPageEditor, editorSeedPages } from './index.ts';

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

const pageStore = new ValidatingPageStore(new InMemoryPageStore());
for (const doc of editorSeedPages) {
  void pageStore.save(doc.pageId, doc);
}

const mountEditor = createMountPageEditor({
  pageStore,
  layoutRegistry: authoringLayoutRegistry,
  tenantId: 'acme',
  capabilities: authoringCapabilities,
  principal: { id: 'u_authoring', roles: [] },
});

export class AuthoringPageEditorRoute extends AtlasSurface {
  static override surfaceId = 'authoring.page-editor';

  private readonly _root: ShadowRoot;
  private _activePageId: string = editorSeedPages[0]?.pageId ?? '';
  private _cleanup: (() => void) | null = null;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this._root);
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
    const options = editorSeedPages.map((doc) => ({
      value: doc.pageId,
      label: (doc['meta'] as { title?: string } | undefined)?.title ?? doc.pageId,
    }));
    if (options.length > 0 && !options.some((o) => o.value === this._activePageId)) {
      this._activePageId = options[0]!.value;
    }

    this._root.innerHTML = `
      <style>${styles}</style>
      <atlas-box data-role="picker">
        <atlas-text variant="medium">Page</atlas-text>
        <atlas-select name="page-select" aria-label="Page"></atlas-select>
      </atlas-box>
      <atlas-box data-role="canvas"></atlas-box>
    `;

    const select = this._root.querySelector('atlas-select[name="page-select"]') as
      | (HTMLElement & { options: unknown; value: string })
      | null;
    if (select) {
      select.options = options;
      select.value = this._activePageId;
      select.addEventListener('change', (ev) => {
        const next = (ev as CustomEvent<{ value: string }>).detail?.value ?? select.value;
        this._activePageId = next;
        this._mountEditor();
      });
    }

    this._mountEditor();
  }

  private _mountEditor(): void {
    const host = this._root.querySelector('atlas-box[data-role="canvas"]') as HTMLElement | null;
    if (!host) return;
    this._cleanup?.();
    this._cleanup = null;
    host.textContent = '';
    const result = mountEditor(host, {
      config: { pageId: this._activePageId },
      onLog: () => {},
    });
    this._cleanup = typeof result === 'function' ? result : null;
  }
}

AtlasElement.define('authoring-page-editor-route', AuthoringPageEditorRoute);
