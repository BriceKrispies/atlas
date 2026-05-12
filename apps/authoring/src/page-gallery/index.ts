import { AtlasElement, AtlasSurface } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';
import { galleryPickerEntries, mountContentPage } from '../shared/stores.ts';

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
    flex-wrap: wrap;
    align-items: center;
    gap: var(--atlas-space-sm) var(--atlas-space-md);
    padding: var(--atlas-space-md);
    border-bottom: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-surface);
  }
  atlas-box[data-role="picker"] atlas-select {
    flex: 1 1 200px;
    min-width: 0;
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
    this._activePageId = galleryPickerEntries[0]?.pageId ?? '';
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
    const options = galleryPickerEntries.map((entry) => ({
      value: entry.pageId,
      label:
        entry.title?.replace(/^Gallery\s*—\s*/i, '') ??
        entry.templateId ??
        entry.pageId,
    }));

    this._root.innerHTML = `
      <style>${styles}</style>
      <atlas-box data-role="picker">
        <atlas-text variant="medium">Layout</atlas-text>
        <atlas-select name="page-select" aria-label="Layout"></atlas-select>
      </atlas-box>
      <atlas-box data-role="canvas"></atlas-box>
    `;

    const select = this._root.querySelector<HTMLElement>('atlas-select[name="page-select"]');
    if (isOptionsHost(select)) {
      select.options = options;
      select.value = this._activePageId;
      select.addEventListener('change', (ev) => {
        const next = readChangeValue(ev) ?? select.value;
        this._activePageId = next;
        this._mount();
      });
    }

    this._mount();
  }

  private _mount(): void {
    const host = this._root.querySelector<HTMLElement>('atlas-box[data-role="canvas"]');
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

/**
 * Runtime guard for the `<atlas-select>` element shape. `querySelector`
 * returns `HTMLElement`; the select's `options`/`value` setters are
 * declared on the custom element class but `HTMLElement` doesn't see
 * them. The guard sets the property if writable and narrows the type so
 * subsequent assignments compile.
 */
function isOptionsHost(
  el: HTMLElement | null,
): el is HTMLElement & { options: unknown; value: string } {
  if (!el) return false;
  // `value` exists on every form element class; `options` is the
  // custom-element setter. Both are runtime-defined; the guard simply
  // proves the element was the queried <atlas-select>.
  return 'options' in el && 'value' in el;
}

function readChangeValue(ev: Event): string | undefined {
  if (!(ev instanceof CustomEvent)) return undefined;
  const detail: unknown = ev.detail;
  if (detail === null || typeof detail !== 'object') return undefined;
  // `Reflect.get` returns `unknown` so the field read doesn't need a
  // structural narrowing of `detail` itself.
  const v: unknown = Reflect.get(detail, 'value');
  return typeof v === 'string' ? v : undefined;
}

AtlasElement.define('authoring-page-gallery-route', AuthoringPageGalleryRoute);
