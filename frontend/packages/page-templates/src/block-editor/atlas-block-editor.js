import { AtlasElement, AtlasSurface } from '@atlas/core';
import { registerTestState } from '@atlas/test-state';
import { BlockEditorController } from './block-editor-controller.js';

let blockCounter = 0;
function freshBlockId(type) {
  blockCounter += 1;
  return `blk-${type}-${Date.now().toString(36)}-${blockCounter}`;
}

/**
 * <atlas-block-editor editor-id="page-42">
 *   (optional child toolbar)
 *   <atlas-editor-toolbar></atlas-editor-toolbar>
 * </atlas-block-editor>
 *
 * Minimal block-based editor. The controller owns the document; the
 * element renders blocks and a default toolbar if none was provided as
 * a child. Each block is rendered as `<atlas-block>` with
 * `name="block" key={blockId}` so its testid is auto-generated.
 *
 * Registers `editor:<editorId>` with the `@atlas/test-state` registry.
 */
class AtlasBlockEditor extends AtlasSurface {
  static surfaceId = 'atlas-block-editor';

  constructor() {
    super();
    this.controller = null;
    this._disposeSub = null;
    this._disposeTest = null;
  }

  static get observedAttributes() { return ['editor-id']; }

  get editorId() { return this.getAttribute('editor-id') ?? 'block-editor'; }
  get surfaceId() { return `editor:${this.editorId}`; }

  /** Set the initial document before mount. */
  set document(doc) {
    this._initialDoc = doc;
    if (this.controller) {
      this.controller = new BlockEditorController({
        surfaceId: this.surfaceId,
        document: doc,
      });
      this._renderBlocks();
    }
  }

  connectedCallback() {
    this._applyTestId();
    if (!this.controller) {
      this.controller = new BlockEditorController({
        surfaceId: this.surfaceId,
        document: this._initialDoc,
      });
    }
    this._renderFrame();
    this._renderBlocks();

    this._disposeSub = this.controller.subscribe(() => this._renderBlocks());
    this._disposeTest = registerTestState(this.surfaceId, () => this.controller.getSnapshot());
  }

  disconnectedCallback() {
    this._disposeSub?.();
    this._disposeTest?.();
    this._disposeSub = null;
    this._disposeTest = null;
  }

  // ── render ──────────────────────────────────────────────────────

  _renderFrame() {
    const hadToolbarChild = !!this.querySelector('atlas-editor-toolbar');
    this.textContent = '';
    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'md');
    if (!hadToolbarChild) {
      wrap.appendChild(document.createElement('atlas-editor-toolbar'));
    }
    const list = document.createElement('atlas-stack');
    list.setAttribute('gap', 'sm');
    list.setAttribute('name', 'blocks');
    list.setAttribute('data-block-list', '');
    wrap.appendChild(list);
    this.appendChild(wrap);
  }

  _renderBlocks() {
    if (!this.isConnected) return;
    const list = this.querySelector('[data-block-list]');
    if (!list) return;
    list.textContent = '';
    const snap = this.controller.getSnapshot();
    for (const block of snap.document.blocks) {
      const el = document.createElement('atlas-block');
      el.setAttribute('name', 'block');
      el.setAttribute('key', block.blockId);
      el.setAttribute('data-block-id', block.blockId);
      el.setAttribute('data-type', block.type);
      if (snap.selection === block.blockId) el.setAttribute('data-selected', 'true');
      el.block = block;
      el.addEventListener('click', () => {
        this.controller.commit('setSelection', { blockId: block.blockId });
      });
      list.appendChild(el);
    }
  }
}

AtlasElement.define('atlas-block-editor', AtlasBlockEditor);

/**
 * <atlas-block> — pure render of a single block. Contents depend on
 * `block.type`. Uses atlas elements only (no raw HTML) per C11.
 */
class AtlasBlock extends AtlasElement {
  constructor() {
    super();
    /** @type {{ blockId: string, type: string, content: any, config: object } | null} */
    this._block = null;
  }

  set block(b) { this._block = b; this._render(); }
  get block() { return this._block; }

  connectedCallback() {
    super.connectedCallback();
    this._render();
  }

  _render() {
    if (!this._block) return;
    this.textContent = '';
    const b = this._block;
    const formats = new Set(b.config?.formats ?? []);

    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('name', 'body');
    wrap.setAttribute('padding', 'sm');

    if (b.type === 'heading') {
      const h = document.createElement('atlas-heading');
      h.setAttribute('level', '2');
      h.textContent = String(b.content ?? '');
      wrap.appendChild(h);
    } else if (b.type === 'list') {
      const items = Array.isArray(b.content) ? b.content : [];
      const stack = document.createElement('atlas-stack');
      stack.setAttribute('gap', 'xs');
      for (const item of items) {
        const row = document.createElement('atlas-text');
        row.textContent = `• ${item}`;
        stack.appendChild(row);
      }
      wrap.appendChild(stack);
    } else if (b.type === 'image-placeholder') {
      const p = document.createElement('atlas-text');
      p.setAttribute('variant', 'muted');
      p.textContent = `[image placeholder: ${b.content?.alt || 'unnamed'}]`;
      wrap.appendChild(p);
    } else {
      const p = document.createElement('atlas-text');
      if (formats.has('bold')) p.setAttribute('weight', 'bold');
      if (formats.has('italic')) p.setAttribute('italic', '');
      p.setAttribute('block', '');
      p.textContent = String(b.content ?? '');
      wrap.appendChild(p);
    }
    this.appendChild(wrap);
  }
}

AtlasElement.define('atlas-block', AtlasBlock);

export { AtlasBlockEditor, AtlasBlock, freshBlockId };
