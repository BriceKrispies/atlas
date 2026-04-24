import { AtlasElement } from '@atlas/core';
import { freshBlockId } from './atlas-block-editor.js';

/**
 * <atlas-editor-toolbar> — default toolbar for <atlas-block-editor>.
 * Self-wires to the nearest editor ancestor.
 *
 * Each button has `name="action" key={actionName}` so the testids are:
 *   {surfaceId}.action.insert-text
 *   {surfaceId}.action.insert-heading
 *   {surfaceId}.action.insert-list
 *   {surfaceId}.action.insert-image
 *   {surfaceId}.action.remove
 *   {surfaceId}.action.move-up
 *   {surfaceId}.action.move-down
 *   {surfaceId}.action.bold
 *   {surfaceId}.action.italic
 *   {surfaceId}.action.save
 *
 * Toolbar actions all commit through the editor's controller. Save
 * commits a `save` intent but the actual persistence is left to the
 * host page (`editor-toolbar-save` custom event bubbles).
 */
class AtlasEditorToolbar extends AtlasElement {
  get _editor() {
    return this.closest('atlas-block-editor');
  }

  connectedCallback() {
    super.connectedCallback();
    this._render();
  }

  _render() {
    this.textContent = '';
    const row = document.createElement('atlas-row');
    row.setAttribute('gap', 'xs');
    row.setAttribute('wrap', '');

    const add = (key, label, onClick) => {
      const b = document.createElement('atlas-button');
      b.setAttribute('name', 'action');
      b.setAttribute('key', key);
      b.setAttribute('size', 'sm');
      b.setAttribute('variant', 'ghost');
      b.textContent = label;
      b.addEventListener('click', onClick);
      row.appendChild(b);
      return b;
    };

    add('insert-text', '+ Text', () => this._insert('text'));
    add('insert-heading', '+ Heading', () => this._insert('heading'));
    add('insert-list', '+ List', () => this._insert('list'));
    add('insert-image', '+ Image', () => this._insert('image-placeholder'));
    add('move-up', '↑', () => this._move(-1));
    add('move-down', '↓', () => this._move(+1));
    add('bold', 'B', () => this._format('bold'));
    add('italic', 'I', () => this._format('italic'));
    add('remove', 'Delete', () => this._remove());
    const save = add('save', 'Save', () => this._save());
    save.setAttribute('variant', 'primary');

    this.appendChild(row);
  }

  _insert(type) {
    const editor = this._editor;
    if (!editor?.controller) return;
    const blockId = freshBlockId(type);
    const snap = editor.controller.getSnapshot();
    const selected = snap.selection
      ? snap.document.blocks.findIndex((b) => b.blockId === snap.selection)
      : -1;
    const at = selected >= 0 ? selected + 1 : snap.document.blocks.length;
    editor.controller.commit('insertBlock', { blockId, type, at });
    editor.controller.commit('setSelection', { blockId });
  }

  _remove() {
    const editor = this._editor;
    if (!editor?.controller) return;
    const snap = editor.controller.getSnapshot();
    if (!snap.selection) return;
    editor.controller.commit('removeBlock', { blockId: snap.selection });
  }

  _move(delta) {
    const editor = this._editor;
    if (!editor?.controller) return;
    const snap = editor.controller.getSnapshot();
    if (!snap.selection) return;
    const from = snap.document.blocks.findIndex((b) => b.blockId === snap.selection);
    if (from < 0) return;
    const to = from + delta;
    if (to < 0 || to >= snap.document.blocks.length) return;
    editor.controller.commit('moveBlock', { blockId: snap.selection, from, to });
  }

  _format(format) {
    const editor = this._editor;
    if (!editor?.controller) return;
    const snap = editor.controller.getSnapshot();
    if (!snap.selection) return;
    editor.controller.commit('applyFormatting', { blockId: snap.selection, format });
  }

  _save() {
    const editor = this._editor;
    if (!editor?.controller) return;
    editor.controller.commit('save', {});
    editor.controller.markClean();
    this.dispatchEvent(new CustomEvent('editor-save', {
      bubbles: true,
      detail: editor.controller.getSnapshot(),
    }));
  }
}

AtlasElement.define('atlas-editor-toolbar', AtlasEditorToolbar);

export { AtlasEditorToolbar };
