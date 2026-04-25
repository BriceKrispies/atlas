import { AtlasElement, AtlasSurface } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';
import {
  presetLayouts,
  emptyLayoutDocument,
  type LayoutDocument,
} from '@atlas/page-templates';
import { authoringLayoutRegistry, authoringLayoutStore } from '../shared/stores.ts';

interface LayoutOption {
  value: string;
  label: string;
}

const BLANK_VALUE = '__blank__';

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

export class AuthoringLayoutEditorRoute extends AtlasSurface {
  static override surfaceId = 'authoring.layout-editor';

  private readonly _root: ShadowRoot;
  private _activeLayoutId: string | null = null;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this._root);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    queueMicrotask(() => this._render());
  }

  private _options(): LayoutOption[] {
    const presets = (presetLayouts as LayoutDocument[]).map((l) => ({
      value: l.layoutId,
      label: l.displayName ?? l.layoutId,
    }));
    return [{ value: BLANK_VALUE, label: 'Blank canvas' }, ...presets];
  }

  private _render(): void {
    const options = this._options();
    const initial = options[0]?.value ?? BLANK_VALUE;
    this._activeLayoutId = initial === BLANK_VALUE ? null : initial;

    this._root.innerHTML = `
      <style>${styles}</style>
      <atlas-box data-role="picker">
        <atlas-text variant="medium">Layout</atlas-text>
        <atlas-select data-role="layout-select" aria-label="Layout"></atlas-select>
      </atlas-box>
      <atlas-box data-role="canvas"></atlas-box>
    `;

    const select = this._root.querySelector('atlas-select[data-role="layout-select"]') as
      | (HTMLElement & { options: unknown; value: string })
      | null;
    if (select) {
      select.options = options;
      select.value = initial;
      select.addEventListener('change', (ev) => {
        const next = (ev as CustomEvent<{ value: string }>).detail?.value ?? select.value;
        this._activeLayoutId = next === BLANK_VALUE ? null : next;
        void this._mountEditor();
      });
    }

    void this._mountEditor();
  }

  private async _mountEditor(): Promise<void> {
    const host = this._root.querySelector('atlas-box[data-role="canvas"]') as HTMLElement | null;
    if (!host) return;
    host.textContent = '';

    const seedId = this._activeLayoutId;
    const seedDoc = seedId
      ? null
      : emptyLayoutDocument({
          layoutId: `authoring.${Date.now().toString(36)}`,
          displayName: 'Untitled layout',
        });

    const editor = document.createElement('atlas-layout-editor') as HTMLElement & {
      layout: unknown;
      onChange: (doc: LayoutDocument) => void;
      onSave: (doc: LayoutDocument) => Promise<void>;
    };
    editor.onChange = () => {};
    editor.onSave = async (doc: LayoutDocument) => {
      await authoringLayoutStore.save(doc.layoutId, doc);
      try {
        authoringLayoutRegistry.register(doc);
      } catch {
        /* duplicate name with different shape — registry throws; ignore */
      }
    };

    if (seedId) {
      const stored = await authoringLayoutStore.get(seedId);
      editor.layout = stored ?? authoringLayoutRegistry.get(seedId);
    } else {
      editor.layout = seedDoc;
    }

    host.appendChild(editor);
  }
}

AtlasElement.define('authoring-layout-editor-route', AuthoringLayoutEditorRoute);
