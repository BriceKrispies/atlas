import { AtlasElement, AtlasSurface } from '@atlas/core';
import { registerTestState } from '@atlas/test-state';
import {
  BlockEditorController,
  type Block,
  type BlockDocument,
} from './block-editor-controller.ts';

let blockCounter = 0;

export function freshBlockId(type: string): string {
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
  static override surfaceId = 'atlas-block-editor';

  controller: BlockEditorController | null = null;
  private _disposeSub: (() => void) | null = null;
  private _disposeTest: (() => void) | null = null;
  private _initialDoc: BlockDocument | null | undefined = undefined;

  static override get observedAttributes(): string[] {
    return ['editor-id'];
  }

  get editorId(): string {
    return this.getAttribute('editor-id') ?? 'block-editor';
  }

  override get surfaceId(): string {
    return `editor:${this.editorId}`;
  }

  /** Set the initial document before mount. */
  set document(doc: BlockDocument | null | undefined) {
    this._initialDoc = doc;
    if (this.controller) {
      this.controller = new BlockEditorController({
        surfaceId: this.surfaceId,
        document: doc ?? null,
      });
      this._renderBlocks();
    }
  }

  override connectedCallback(): void {
    (this as unknown as { _applyTestId: () => void })._applyTestId();
    if (!this.controller) {
      this.controller = new BlockEditorController({
        surfaceId: this.surfaceId,
        document: this._initialDoc ?? null,
      });
    }
    this._renderFrame();
    this._renderBlocks();

    this._disposeSub = this.controller.subscribe(() => this._renderBlocks());
    this._disposeTest = registerTestState(this.surfaceId, () =>
      this.controller!.getSnapshot(),
    );
  }

  override disconnectedCallback(): void {
    this._disposeSub?.();
    this._disposeTest?.();
    this._disposeSub = null;
    this._disposeTest = null;
  }

  // ── render ──────────────────────────────────────────────────────

  private _renderFrame(): void {
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

  private _renderBlocks(): void {
    if (!this.isConnected) return;
    const list = this.querySelector('[data-block-list]');
    if (!list || !this.controller) return;
    list.textContent = '';
    const snap = this.controller.getSnapshot();
    for (const block of snap.document.blocks) {
      const el = document.createElement('atlas-block') as AtlasBlock;
      el.setAttribute('name', 'block');
      el.setAttribute('key', block.blockId);
      el.setAttribute('data-block-id', block.blockId);
      el.setAttribute('data-type', block.type);
      if (snap.selection === block.blockId) el.setAttribute('data-selected', 'true');
      el.block = block;
      el.addEventListener('click', () => {
        this.controller!.commit('setSelection', { blockId: block.blockId });
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
  private _block: Block | null = null;

  set block(b: Block | null) {
    this._block = b;
    this._render();
  }
  get block(): Block | null {
    return this._block;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._render();
  }

  private _render(): void {
    if (!this._block) return;
    this.textContent = '';
    const b = this._block;
    const formats = new Set<string>(
      (b.config?.['formats'] as string[] | undefined) ?? [],
    );

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
      const img = b.content as { alt?: string } | undefined;
      p.textContent = `[image placeholder: ${img?.alt || 'unnamed'}]`;
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

export { AtlasBlockEditor, AtlasBlock };
