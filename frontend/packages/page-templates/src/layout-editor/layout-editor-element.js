/**
 * layout-editor-element.js — `<atlas-layout-editor>`, the visual editor
 * for layout documents.
 *
 * Composition:
 *   - Toolbar (top):  [name input] [Add slot]            [Save]
 *   - Canvas (left):  a live <atlas-layout> with draggable sections +
 *                     resize handles (east / south / south-east)
 *   - Panel  (right): properties for the selected slot
 *                     (name, col/row/colSpan/rowSpan, delete)
 *
 * Interaction:
 *   - Click a section to select. Click empty canvas to deselect.
 *   - Drag the body of a section to move it; coordinates snap to grid
 *     cells (integer col/row).
 *   - Drag a handle to resize; sizes snap to integer colSpan/rowSpan.
 *   - Edit any field in the panel to change that slot imperatively.
 *
 * State lives in `this._doc` (the working layout document). Every mutation
 * clones the doc, applies the change, validates, and re-renders. The
 * consumer receives `onChange(doc)` on every mutation and `onSave(doc)`
 * when the save button is pressed.
 */

import { AtlasElement, html } from '@atlas/core';

import {
  validateLayoutDocument,
  cloneLayoutDocument,
  emptyLayoutDocument,
  nextFreeRect,
} from '../layout/layout-document.js';
import { AtlasLayoutElement } from '../layout/layout-element.js';
import { ensureLayoutStyles } from '../layout/layout-styles.js';
import { ensureLayoutEditorStyles } from './layout-editor-styles.js';

/**
 * @typedef {import('../layout/layout-document.js').LayoutDocument} LayoutDocument
 * @typedef {import('../layout/layout-document.js').LayoutSlot} LayoutSlot
 */

export class AtlasLayoutEditorElement extends AtlasElement {
  static surfaceId = 'atlas-layout-editor';

  constructor() {
    super();
    /** @type {LayoutDocument | null} */
    this._doc = null;
    /** @type {string | null} */
    this._selectedSlotName = null;
    /** @type {((doc: LayoutDocument) => void) | null} */
    this.onChange = null;
    /** @type {((doc: LayoutDocument) => Promise<void> | void) | null} */
    this.onSave = null;
    /** @type {boolean} */
    this._rendered = false;
    /** Pointer-drag transient state. */
    this._drag = null;
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  connectedCallback() {
    this._applyTestId?.();
    ensureLayoutStyles(this);
    ensureLayoutEditorStyles(this);
    this._render();
    window.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    this._cancelDrag();
    window.removeEventListener('keydown', this._onKeyDown);
  }

  set layout(value) {
    this._doc = value ? cloneLayoutDocument(value) : null;
    if (this.isConnected) this._render();
  }

  get layout() {
    return this._doc ? cloneLayoutDocument(this._doc) : null;
  }

  // ---- top-level render -------------------------------------------------

  _render() {
    if (!this._doc) {
      this._doc = emptyLayoutDocument({ layoutId: 'untitled' });
    }
    if (!this._rendered) {
      this.textContent = '';
      this.appendChild(
        html`
          <div data-editor-toolbar>
            <atlas-input
              name="layout-name"
              data-layout-name
              placeholder="Layout name"
            ></atlas-input>
            <atlas-button name="add-slot" data-action="add-slot" size="sm">
              Add slot
            </atlas-button>
            <div data-spacer></div>
            <atlas-button
              name="save-layout"
              data-action="save"
              variant="primary"
              size="sm"
            >
              Save
            </atlas-button>
          </div>
          <div data-editor-canvas name="editor-canvas">
            <atlas-layout></atlas-layout>
          </div>
          <div data-editor-panel name="editor-panel"></div>
        `,
      );
      this._wireToolbar();
      this._wireCanvas();
      this._rendered = true;
    }
    this._applyLayoutToCanvas();
    this._decorateSections();
    this._renderPanel();
    this._syncToolbarInputs();
  }

  _wireToolbar() {
    const nameInput = this.querySelector('[data-layout-name]');
    if (nameInput) {
      nameInput.addEventListener('input', (ev) => {
        const v = ev.target?.value ?? '';
        this._mutate((doc) => {
          doc.displayName = v;
        });
      });
    }
    const addBtn = this.querySelector('[data-action="add-slot"]');
    if (addBtn) addBtn.addEventListener('click', () => this._addSlot());
    const saveBtn = this.querySelector('[data-action="save"]');
    if (saveBtn) saveBtn.addEventListener('click', () => this._save());
  }

  _wireCanvas() {
    const canvas = this.querySelector('[data-editor-canvas]');
    if (!canvas) return;
    // Click empty canvas area → deselect.
    canvas.addEventListener('click', (ev) => {
      if (ev.target === canvas || ev.target.tagName === 'ATLAS-LAYOUT') {
        this._select(null);
      }
    });
  }

  _syncToolbarInputs() {
    const nameInput = this.querySelector('[data-layout-name]');
    if (nameInput && nameInput.value !== (this._doc.displayName ?? '')) {
      nameInput.value = this._doc.displayName ?? '';
    }
    // Expose the gap as a CSS var so the canvas background grid matches.
    const canvas = this.querySelector('[data-editor-canvas]');
    if (canvas) {
      canvas.style.setProperty('--editor-gap', `${this._doc.grid.gap}px`);
    }
  }

  _applyLayoutToCanvas() {
    const layoutEl = this.querySelector(
      '[data-editor-canvas] > atlas-layout',
    );
    if (!layoutEl) return;
    /** @type {AtlasLayoutElement} */ (layoutEl).layout = this._doc;
  }

  // ---- section chrome + drag wiring -----------------------------------

  _decorateSections() {
    const layoutEl = this.querySelector(
      '[data-editor-canvas] > atlas-layout',
    );
    if (!layoutEl) return;
    const sections = layoutEl.querySelectorAll(':scope > section[data-slot]');
    for (const sec of sections) {
      const name = sec.getAttribute('data-slot');
      sec.setAttribute('name', `slot-${name}`);
      if (this._selectedSlotName === name) {
        sec.setAttribute('data-selected', 'true');
      } else {
        sec.removeAttribute('data-selected');
      }
      if (!sec.querySelector(':scope > [data-slot-label]')) {
        const label = document.createElement('div');
        label.setAttribute('data-slot-label', '');
        label.textContent = name;
        sec.appendChild(label);

        for (const edge of ['e', 's', 'se']) {
          const handle = document.createElement('div');
          handle.setAttribute('data-resize-handle', edge);
          handle.setAttribute('name', `resize-${name}-${edge}`);
          sec.appendChild(handle);
        }
        sec.addEventListener('pointerdown', (ev) => this._onSectionPointerDown(ev, name));
        sec.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this._select(name);
        });
      } else {
        // Keep label in sync if the slot name ever changes.
        const label = sec.querySelector(':scope > [data-slot-label]');
        if (label && label.textContent !== name) label.textContent = name;
      }
    }
  }

  _onSectionPointerDown(ev, slotName) {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    const handleEl = ev.target.closest?.('[data-resize-handle]');
    const canvas = this.querySelector('[data-editor-canvas]');
    const layoutEl = this.querySelector(
      '[data-editor-canvas] > atlas-layout',
    );
    if (!canvas || !layoutEl) return;
    const gridRect = layoutEl.getBoundingClientRect();
    const slot = this._findSlot(slotName);
    if (!slot) return;

    if (handleEl) {
      ev.stopPropagation();
      this._drag = {
        mode: 'resize',
        edge: handleEl.getAttribute('data-resize-handle'),
        slotName,
        gridRect,
        originalSlot: { ...slot },
      };
      canvas.setAttribute('data-drag-mode', 'resize');
    } else {
      this._drag = {
        mode: 'move',
        slotName,
        gridRect,
        originalSlot: { ...slot },
        pickupCol: this._pointerCol(ev.clientX, gridRect) - slot.col,
        pickupRow: this._pointerRow(ev.clientY, gridRect) - slot.row,
      };
      canvas.setAttribute('data-drag-mode', 'move');
    }
    this._select(slotName);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    // Prevent text selection during drag.
    ev.preventDefault();
  }

  _onPointerMove(ev) {
    const drag = this._drag;
    if (!drag) return;
    const slot = this._findSlot(drag.slotName);
    if (!slot) return;
    const columns = this._doc.grid.columns;
    const pCol = this._pointerCol(ev.clientX, drag.gridRect);
    const pRow = this._pointerRow(ev.clientY, drag.gridRect);

    if (drag.mode === 'resize') {
      const next = { ...drag.originalSlot };
      if (drag.edge === 'e' || drag.edge === 'se') {
        next.colSpan = Math.max(
          1,
          Math.min(columns - next.col + 1, pCol - next.col + 1),
        );
      }
      if (drag.edge === 's' || drag.edge === 'se') {
        next.rowSpan = Math.max(1, pRow - next.row + 1);
      }
      this._applySlotChange(drag.slotName, next);
    } else if (drag.mode === 'move') {
      let col = pCol - drag.pickupCol;
      let row = pRow - drag.pickupRow;
      // Clamp so the slot stays within the grid.
      col = Math.max(1, Math.min(columns - slot.colSpan + 1, col));
      row = Math.max(1, row);
      this._applySlotChange(drag.slotName, { ...slot, col, row });
    }
  }

  _onPointerUp() {
    this._finalizeDrag();
  }

  _finalizeDrag() {
    const canvas = this.querySelector('[data-editor-canvas]');
    if (canvas) canvas.removeAttribute('data-drag-mode');
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    this._drag = null;
  }

  _cancelDrag() {
    if (!this._drag) return;
    // Revert to original.
    this._applySlotChange(this._drag.slotName, this._drag.originalSlot);
    this._finalizeDrag();
  }

  // ---- grid math -------------------------------------------------------

  _pointerCol(clientX, gridRect) {
    const gap = this._doc.grid.gap;
    const columns = this._doc.grid.columns;
    const cellW = (gridRect.width - (columns - 1) * gap) / columns;
    const relX = clientX - gridRect.left;
    // Round to the nearest grid line. Column index is 1-based.
    const col = Math.round(relX / (cellW + gap)) + 1;
    return Math.max(1, Math.min(columns, col));
  }

  _pointerRow(clientY, gridRect) {
    const gap = this._doc.grid.gap;
    const rowH = this._doc.grid.rowHeight;
    const relY = clientY - gridRect.top;
    const row = Math.round(relY / (rowH + gap)) + 1;
    return Math.max(1, row);
  }

  // ---- mutations -------------------------------------------------------

  _mutate(fn) {
    const next = cloneLayoutDocument(this._doc);
    fn(next);
    // Validate before committing so we never end up rendering a broken
    // doc (and onChange consumers don't see one either).
    const { ok } = validateLayoutDocument(next);
    if (!ok) return;
    this._doc = next;
    this._applyLayoutToCanvas();
    this._decorateSections();
    this._renderPanel();
    this._syncToolbarInputs();
    if (typeof this.onChange === 'function') {
      try {
        this.onChange(cloneLayoutDocument(this._doc));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[atlas-layout-editor] onChange threw', err);
      }
    }
  }

  _applySlotChange(slotName, nextSlot) {
    this._mutate((doc) => {
      const i = doc.slots.findIndex((s) => s.name === slotName);
      if (i < 0) return;
      doc.slots[i] = { ...nextSlot, name: doc.slots[i].name };
    });
  }

  _renameSlot(fromName, toName) {
    if (fromName === toName) return;
    if (this._doc.slots.some((s) => s.name === toName)) return;
    this._mutate((doc) => {
      const slot = doc.slots.find((s) => s.name === fromName);
      if (!slot) return;
      slot.name = toName;
    });
    if (this._selectedSlotName === fromName) this._selectedSlotName = toName;
  }

  _deleteSlot(slotName) {
    this._mutate((doc) => {
      doc.slots = doc.slots.filter((s) => s.name !== slotName);
    });
    if (this._selectedSlotName === slotName) this._select(null);
  }

  _addSlot() {
    const nameBase = 'slot';
    let i = 1;
    while (this._doc.slots.some((s) => s.name === `${nameBase}-${i}`)) i++;
    const newName = `${nameBase}-${i}`;
    const rect = nextFreeRect(this._doc, { colSpan: 4, rowSpan: 2 });
    this._mutate((doc) => {
      doc.slots.push({ name: newName, ...rect });
    });
    this._select(newName);
  }

  async _save() {
    if (typeof this.onSave !== 'function') return;
    try {
      await this.onSave(cloneLayoutDocument(this._doc));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[atlas-layout-editor] onSave threw', err);
    }
  }

  // ---- selection + panel ----------------------------------------------

  _select(slotName) {
    this._selectedSlotName = slotName;
    this._decorateSections();
    this._renderPanel();
  }

  _findSlot(slotName) {
    return this._doc.slots.find((s) => s.name === slotName) ?? null;
  }

  _renderPanel() {
    const panel = this.querySelector('[data-editor-panel]');
    if (!panel) return;
    const slot = this._selectedSlotName
      ? this._findSlot(this._selectedSlotName)
      : null;
    if (!slot) {
      panel.textContent = '';
      panel.appendChild(
        html`
          <div data-empty>
            <atlas-text variant="medium">No slot selected</atlas-text>
            <atlas-text variant="muted" block>
              Click a slot to edit it, or use <strong>Add slot</strong>.
            </atlas-text>
            <div style="margin-top:12px;font-size:0.75rem;color:var(--atlas-color-text-muted, #6b7280)">
              Grid: ${this._doc.grid.columns} cols · ${this._doc.grid.rowHeight}px rows · ${this._doc.slots.length} slot${this._doc.slots.length === 1 ? '' : 's'}
            </div>
          </div>
        `,
      );
      return;
    }
    panel.textContent = '';
    panel.appendChild(
      html`
        <atlas-text variant="medium">Slot</atlas-text>
        <label for="slot-name-input">Name</label>
        <input
          id="slot-name-input"
          name="slot-name"
          data-field="name"
          type="text"
          value="${slot.name}"
        />
        <div data-rect-grid>
          <div>
            <label for="slot-col-input">Col</label>
            <input id="slot-col-input" name="slot-col" data-field="col" type="number" min="1" value="${slot.col}" />
          </div>
          <div>
            <label for="slot-row-input">Row</label>
            <input id="slot-row-input" name="slot-row" data-field="row" type="number" min="1" value="${slot.row}" />
          </div>
          <div>
            <label for="slot-colspan-input">Col span</label>
            <input id="slot-colspan-input" name="slot-colspan" data-field="colSpan" type="number" min="1" value="${slot.colSpan}" />
          </div>
          <div>
            <label for="slot-rowspan-input">Row span</label>
            <input id="slot-rowspan-input" name="slot-rowspan" data-field="rowSpan" type="number" min="1" value="${slot.rowSpan}" />
          </div>
        </div>
        <div style="margin-top:var(--atlas-space-md, 1rem)">
          <atlas-button
            name="delete-slot"
            data-action="delete-slot"
            variant="danger"
            size="sm"
          >
            Delete slot
          </atlas-button>
        </div>
      `,
    );
    // Wire field inputs.
    for (const input of panel.querySelectorAll('input[data-field]')) {
      input.addEventListener('change', (ev) => this._onPanelFieldCommit(ev));
    }
    const delBtn = panel.querySelector('[data-action="delete-slot"]');
    if (delBtn && this._selectedSlotName) {
      delBtn.addEventListener('click', () =>
        this._deleteSlot(this._selectedSlotName),
      );
    }
  }

  _onPanelFieldCommit(ev) {
    const input = ev.target;
    const field = input?.getAttribute?.('data-field');
    const slotName = this._selectedSlotName;
    if (!field || !slotName) return;
    const slot = this._findSlot(slotName);
    if (!slot) return;
    if (field === 'name') {
      const next = String(input.value ?? '').trim();
      if (!next || next === slot.name) return;
      this._renameSlot(slot.name, next);
      return;
    }
    const n = parseInt(input.value, 10);
    if (!Number.isFinite(n) || n < 1) return;
    this._applySlotChange(slotName, { ...slot, [field]: n });
  }

  _onKeyDown(ev) {
    if (ev.key === 'Escape' && this._drag) {
      ev.preventDefault();
      this._cancelDrag();
      return;
    }
    if (
      (ev.key === 'Delete' || ev.key === 'Backspace') &&
      this._selectedSlotName
    ) {
      // Only act if focus isn't in a text input.
      const ae = document.activeElement;
      const tag = ae?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      ev.preventDefault();
      this._deleteSlot(this._selectedSlotName);
    }
  }
}

if (typeof customElements !== 'undefined') {
  AtlasElement.define('atlas-layout-editor', AtlasLayoutEditorElement);
}
