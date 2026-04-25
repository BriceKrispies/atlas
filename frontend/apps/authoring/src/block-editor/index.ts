import { AtlasElement, AtlasSurface } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';

const BLOCK_SEED_DOC = {
  blocks: [
    { blockId: 'seed-heading', type: 'heading', content: 'Welcome to the block editor' },
    { blockId: 'seed-text',    type: 'text',    content: 'Select a block and use the toolbar.' },
    { blockId: 'seed-list',    type: 'list',    content: ['Insert blocks', 'Move up/down', 'Apply B / I'] },
  ],
};

const EMPTY_DOC = { blocks: [] };

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
    gap: var(--atlas-space-sm);
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

type Variant = 'seeded' | 'empty';

export class AuthoringBlockEditorRoute extends AtlasSurface {
  static override surfaceId = 'authoring.block-editor';

  private readonly _root: ShadowRoot;
  private _variant: Variant = 'seeded';

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this._root);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    queueMicrotask(() => this._render());
  }

  private _render(): void {
    this._root.innerHTML = `
      <style>${styles}</style>
      <atlas-box data-role="picker">
        <atlas-button name="seeded" variant="${this._variant === 'seeded' ? 'primary' : 'ghost'}" size="sm">Seeded</atlas-button>
        <atlas-button name="empty" variant="${this._variant === 'empty' ? 'primary' : 'ghost'}" size="sm">Empty</atlas-button>
      </atlas-box>
      <atlas-box data-role="canvas"></atlas-box>
    `;

    this._root.querySelector('atlas-button[name="seeded"]')?.addEventListener('click', () => {
      if (this._variant === 'seeded') return;
      this._variant = 'seeded';
      this._render();
    });
    this._root.querySelector('atlas-button[name="empty"]')?.addEventListener('click', () => {
      if (this._variant === 'empty') return;
      this._variant = 'empty';
      this._render();
    });

    this._mountEditor();
  }

  private _mountEditor(): void {
    const host = this._root.querySelector('atlas-box[data-role="canvas"]') as HTMLElement | null;
    if (!host) return;
    host.textContent = '';
    const editor = document.createElement('atlas-block-editor') as HTMLElement & {
      document: unknown;
    };
    editor.setAttribute('editor-id', this._variant === 'seeded' ? 'demo' : 'empty');
    editor.document = this._variant === 'seeded' ? BLOCK_SEED_DOC : EMPTY_DOC;
    host.appendChild(editor);
  }
}

AtlasElement.define('authoring-block-editor-route', AuthoringBlockEditorRoute);
