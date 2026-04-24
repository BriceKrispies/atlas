/**
 * layout-editor-element.ts — `<atlas-layout-editor>`, the visual editor
 * for layout documents.
 */

import { AtlasElement, html } from '@atlas/core';

import {
  validateLayoutDocument,
  cloneLayoutDocument,
  emptyLayoutDocument,
  nextFreeRect,
  type LayoutDocument,
  type LayoutSlot,
} from '../layout/layout-document.ts';
import { AtlasLayoutElement } from '../layout/layout-element.ts';
import { ensureLayoutStyles } from '../layout/layout-styles.ts';
import { ensureLayoutEditorStyles } from './layout-editor-styles.ts';

/** Pointer must travel this many px before a drag activates. */
const DRAG_THRESHOLD_PX = 6;

/** Duration of the FLIP "slide into place" animation on drop. */
const DROP_ANIM_MS = 160;

type DragMode = 'move' | 'resize';
type DragEdge = 'e' | 's' | 'se' | null;
type DragPhase = 'pending' | 'active';

interface DragState {
  phase: DragPhase;
  mode: DragMode;
  edge: DragEdge;
  slotName: string;
  section: HTMLElement;
  canvas: HTMLElement;
  layoutEl: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  gridRect: DOMRect;
  originalSlot: LayoutSlot;
  pickupCol: number;
  pickupRow: number;
  rafId: number;
  ghostEl: HTMLElement | null;
  targetSlot?: LayoutSlot;
}

export class AtlasLayoutEditorElement extends AtlasElement {
  static surfaceId = 'atlas-layout-editor';

  private _doc: LayoutDocument | null = null;
  private _selectedSlotName: string | null = null;
  onChange: ((doc: LayoutDocument) => void) | null = null;
  onSave: ((doc: LayoutDocument) => Promise<void> | void) | null = null;
  private _rendered = false;
  private _drag: DragState | null = null;

  private _onPointerMove: (ev: PointerEvent) => void;
  private _onPointerUp: (ev: PointerEvent) => void;
  private _onPointerCancel: (ev: PointerEvent) => void;
  private _onKeyDown: (ev: KeyboardEvent) => void;

  constructor() {
    super();
    this._onPointerMove = this.__onPointerMove.bind(this);
    this._onPointerUp = this.__onPointerUp.bind(this);
    this._onPointerCancel = this.__onPointerCancel.bind(this);
    this._onKeyDown = this.__onKeyDown.bind(this);
  }

  override connectedCallback(): void {
    (this as unknown as { _applyTestId?: () => void })._applyTestId?.();
    ensureLayoutStyles(this);
    ensureLayoutEditorStyles(this);
    this._render();
    window.addEventListener('keydown', this._onKeyDown);
  }

  override disconnectedCallback(): void {
    this._cancelDrag();
    window.removeEventListener('keydown', this._onKeyDown);
  }

  set layout(value: LayoutDocument | null) {
    this._doc = value ? cloneLayoutDocument(value) : null;
    if (this.isConnected) this._render();
  }

  get layout(): LayoutDocument | null {
    return this._doc ? cloneLayoutDocument(this._doc) : null;
  }

  // ---- top-level render -------------------------------------------------

  private _render(): void {
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

  private _wireToolbar(): void {
    const nameInput = this.querySelector('[data-layout-name]') as HTMLInputElement | null;
    if (nameInput) {
      nameInput.addEventListener('input', (ev: Event) => {
        const v = (ev.target as HTMLInputElement | null)?.value ?? '';
        this._mutate((doc) => {
          doc.displayName = v;
        });
      });
    }
    const addBtn = this.querySelector('[data-action="add-slot"]');
    if (addBtn) addBtn.addEventListener('click', () => this._addSlot());
    const saveBtn = this.querySelector('[data-action="save"]');
    if (saveBtn) saveBtn.addEventListener('click', () => void this._save());
  }

  private _wireCanvas(): void {
    const canvas = this.querySelector('[data-editor-canvas]') as HTMLElement | null;
    if (!canvas) return;
    // Click empty canvas area → deselect.
    canvas.addEventListener('click', (ev: Event) => {
      const target = ev.target as HTMLElement | null;
      if (target === canvas || target?.tagName === 'ATLAS-LAYOUT') {
        this._select(null);
      }
    });
  }

  private _syncToolbarInputs(): void {
    const nameInput = this.querySelector('[data-layout-name]') as HTMLInputElement | null;
    if (nameInput && nameInput.value !== (this._doc!.displayName ?? '')) {
      nameInput.value = this._doc!.displayName ?? '';
    }
    const canvas = this.querySelector('[data-editor-canvas]') as HTMLElement | null;
    if (canvas) {
      const { gap, columns, rowHeight } = this._doc!.grid;
      canvas.style.setProperty('--editor-gap', `${gap}px`);
      canvas.style.setProperty('--editor-cols', String(columns));
      canvas.style.setProperty('--editor-row-step', `${rowHeight + gap}px`);
    }
  }

  private _applyLayoutToCanvas(): void {
    const layoutEl = this.querySelector(
      '[data-editor-canvas] > atlas-layout',
    ) as AtlasLayoutElement | null;
    if (!layoutEl) return;
    layoutEl.layout = this._doc;
  }

  // ---- section chrome + drag wiring -----------------------------------

  private _decorateSections(): void {
    const layoutEl = this.querySelector(
      '[data-editor-canvas] > atlas-layout',
    ) as HTMLElement | null;
    if (!layoutEl) return;
    const sections = layoutEl.querySelectorAll(':scope > section[data-slot]');
    for (const sec of sections) {
      const name = sec.getAttribute('data-slot') ?? '';
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

        for (const edge of ['e', 's', 'se'] as const) {
          const handle = document.createElement('div');
          handle.setAttribute('data-resize-handle', edge);
          handle.setAttribute('name', `resize-${name}-${edge}`);
          sec.appendChild(handle);
        }
        sec.addEventListener('pointerdown', (ev: Event) =>
          this._onSectionPointerDown(ev as PointerEvent, name),
        );
        sec.addEventListener('click', (ev: Event) => {
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

  private _onSectionPointerDown(ev: PointerEvent, slotName: string): void {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    if (this._drag) return; // already dragging something
    const handleEl = (ev.target as Element | null)?.closest?.('[data-resize-handle]') as HTMLElement | null;
    const canvas = this.querySelector('[data-editor-canvas]') as HTMLElement | null;
    const layoutEl = this.querySelector(
      '[data-editor-canvas] > atlas-layout',
    ) as HTMLElement | null;
    if (!canvas || !layoutEl) return;
    const slot = this._findSlot(slotName);
    if (!slot) return;

    const section = layoutEl.querySelector(
      `:scope > section[data-slot="${CSS.escape(slotName)}"]`,
    ) as HTMLElement | null;
    if (!section) return;

    try {
      section.setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }

    const gridRect = layoutEl.getBoundingClientRect();
    this._drag = {
      phase: 'pending',
      mode: handleEl ? 'resize' : 'move',
      edge: (handleEl?.getAttribute('data-resize-handle') as DragEdge) ?? null,
      slotName,
      section,
      canvas,
      layoutEl,
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      lastX: ev.clientX,
      lastY: ev.clientY,
      gridRect,
      originalSlot: { ...slot },
      pickupCol: this._pointerCol(ev.clientX, gridRect) - slot.col,
      pickupRow: this._pointerRow(ev.clientY, gridRect) - slot.row,
      rafId: 0,
      ghostEl: null,
    };
    if (handleEl) ev.stopPropagation();

    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerCancel);
    // Prevent text selection / native drag on mouse.
    ev.preventDefault();
  }

  private __onPointerMove(ev: PointerEvent): void {
    const drag = this._drag;
    if (!drag) return;
    if (ev.pointerId !== drag.pointerId) return;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;

    if (drag.phase === 'pending') {
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      this._activateDrag();
    }

    if (drag.phase !== 'active') return;
    if (drag.rafId) return;
    drag.rafId = requestAnimationFrame(() => {
      drag.rafId = 0;
      if (this._drag === drag && drag.phase === 'active') this._applyDragFrame();
    });
  }

  private __onPointerUp(ev: PointerEvent): void {
    const drag = this._drag;
    if (!drag) return;
    if (ev.pointerId !== drag.pointerId) return;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    if (drag.phase === 'active') {
      this._commitDrag();
    } else {
      const slotName = drag.slotName;
      this._teardownDrag();
      this._select(slotName);
    }
  }

  private __onPointerCancel(ev: PointerEvent): void {
    const drag = this._drag;
    if (!drag) return;
    if (ev.pointerId !== drag.pointerId) return;
    this._cancelDrag();
  }

  private _activateDrag(): void {
    const drag = this._drag;
    if (!drag) return;
    drag.phase = 'active';
    drag.section.setAttribute('data-dragging', 'true');
    drag.canvas.setAttribute('data-drag-mode', drag.mode);
    this._select(drag.slotName);
    if (drag.mode === 'move') {
      drag.ghostEl = this._createDragGhost(drag.originalSlot);
      drag.layoutEl.appendChild(drag.ghostEl);
    }
  }

  private _createDragGhost(slot: LayoutSlot): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-drag-ghost', '');
    el.style.gridColumn = `${slot.col} / span ${slot.colSpan}`;
    el.style.gridRow = `${slot.row} / span ${slot.rowSpan}`;
    return el;
  }

  private _applyDragFrame(): void {
    const drag = this._drag;
    if (!drag || drag.phase !== 'active') return;
    drag.gridRect = drag.layoutEl.getBoundingClientRect();
    const columns = this._doc!.grid.columns;
    const pCol = this._pointerCol(drag.lastX, drag.gridRect);
    const pRow = this._pointerRow(drag.lastY, drag.gridRect);

    if (drag.mode === 'resize') {
      const next: LayoutSlot = { ...drag.originalSlot };
      if (drag.edge === 'e' || drag.edge === 'se') {
        next.colSpan = Math.max(
          1,
          Math.min(columns - next.col + 1, pCol - next.col + 1),
        );
      }
      if (drag.edge === 's' || drag.edge === 'se') {
        next.rowSpan = Math.max(1, pRow - next.row + 1);
      }
      drag.targetSlot = next;
      drag.section.style.gridColumn = `${next.col} / span ${next.colSpan}`;
      drag.section.style.gridRow = `${next.row} / span ${next.rowSpan}`;
    } else {
      let col = pCol - drag.pickupCol;
      let row = pRow - drag.pickupRow;
      col = Math.max(1, Math.min(columns - drag.originalSlot.colSpan + 1, col));
      row = Math.max(1, row);
      drag.targetSlot = { ...drag.originalSlot, col, row };
      if (drag.ghostEl) {
        drag.ghostEl.style.gridColumn = `${col} / span ${drag.originalSlot.colSpan}`;
        drag.ghostEl.style.gridRow = `${row} / span ${drag.originalSlot.rowSpan}`;
      }
      const dx = drag.lastX - drag.startX;
      const dy = drag.lastY - drag.startY;
      drag.section.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }

  private _commitDrag(): void {
    const drag = this._drag;
    if (!drag) return;
    const finalSlot = drag.targetSlot ?? drag.originalSlot;

    const beforeRect = drag.section.getBoundingClientRect();

    if (drag.ghostEl) {
      drag.ghostEl.remove();
      drag.ghostEl = null;
    }
    drag.section.style.transform = '';
    drag.section.removeAttribute('data-dragging');

    this._applySlotChange(drag.slotName, finalSlot);

    const afterRect = drag.section.getBoundingClientRect();
    const flipDx = beforeRect.left - afterRect.left;
    const flipDy = beforeRect.top - afterRect.top;

    if (flipDx || flipDy) {
      drag.section.style.transform = `translate(${flipDx}px, ${flipDy}px)`;
      // Force a layout read.
      drag.section.getBoundingClientRect();
      drag.section.setAttribute('data-drop-return', 'true');
      requestAnimationFrame(() => {
        drag.section.style.transform = '';
      });
      const clear = (): void => {
        drag.section.removeAttribute('data-drop-return');
        drag.section.removeEventListener('transitionend', clear);
      };
      drag.section.addEventListener('transitionend', clear);
      setTimeout(clear, DROP_ANIM_MS + 50);
    }

    this._teardownDrag();
  }

  private _teardownDrag(): void {
    const drag = this._drag;
    if (!drag) return;
    if (drag.rafId) cancelAnimationFrame(drag.rafId);
    if (drag.ghostEl) {
      drag.ghostEl.remove();
      drag.ghostEl = null;
    }
    if (drag.canvas) drag.canvas.removeAttribute('data-drag-mode');
    try {
      drag.section.releasePointerCapture(drag.pointerId);
    } catch {
      /* ignore */
    }
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerCancel);
    this._drag = null;
  }

  private _cancelDrag(): void {
    const drag = this._drag;
    if (!drag) return;
    if (drag.section) {
      drag.section.style.transform = '';
      drag.section.removeAttribute('data-dragging');
      drag.section.removeAttribute('data-drop-return');
    }
    if (drag.mode === 'resize') this._applyLayoutToCanvas();
    this._teardownDrag();
  }

  // ---- grid math -------------------------------------------------------

  private _pointerCol(clientX: number, gridRect: DOMRect): number {
    const gap = this._doc!.grid.gap;
    const columns = this._doc!.grid.columns;
    const cellW = (gridRect.width - (columns - 1) * gap) / columns;
    const relX = clientX - gridRect.left;
    const col = Math.round(relX / (cellW + gap)) + 1;
    return Math.max(1, Math.min(columns, col));
  }

  private _pointerRow(clientY: number, gridRect: DOMRect): number {
    const gap = this._doc!.grid.gap;
    const rowH = this._doc!.grid.rowHeight;
    const relY = clientY - gridRect.top;
    const row = Math.round(relY / (rowH + gap)) + 1;
    return Math.max(1, row);
  }

  // ---- mutations -------------------------------------------------------

  private _mutate(fn: (doc: LayoutDocument) => void): void {
    const next = cloneLayoutDocument(this._doc!);
    fn(next);
    const result = validateLayoutDocument(next);
    if (!result.ok) return;
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

  private _applySlotChange(slotName: string, nextSlot: LayoutSlot): void {
    this._mutate((doc) => {
      const i = doc.slots.findIndex((s) => s.name === slotName);
      if (i < 0) return;
      doc.slots[i] = { ...nextSlot, name: doc.slots[i]!.name };
    });
  }

  private _renameSlot(fromName: string, toName: string): void {
    if (fromName === toName) return;
    if (this._doc!.slots.some((s) => s.name === toName)) return;
    this._mutate((doc) => {
      const slot = doc.slots.find((s) => s.name === fromName);
      if (!slot) return;
      slot.name = toName;
    });
    if (this._selectedSlotName === fromName) this._selectedSlotName = toName;
  }

  private _deleteSlot(slotName: string): void {
    this._mutate((doc) => {
      doc.slots = doc.slots.filter((s) => s.name !== slotName);
    });
    if (this._selectedSlotName === slotName) this._select(null);
  }

  private _addSlot(): void {
    const nameBase = 'slot';
    let i = 1;
    while (this._doc!.slots.some((s) => s.name === `${nameBase}-${i}`)) i++;
    const newName = `${nameBase}-${i}`;
    const rect = nextFreeRect(this._doc!, { colSpan: 4, rowSpan: 2 });
    this._mutate((doc) => {
      doc.slots.push({ name: newName, ...rect });
    });
    this._select(newName);
  }

  private async _save(): Promise<void> {
    if (typeof this.onSave !== 'function') return;
    try {
      await this.onSave(cloneLayoutDocument(this._doc!));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[atlas-layout-editor] onSave threw', err);
    }
  }

  // ---- selection + panel ----------------------------------------------

  private _select(slotName: string | null): void {
    this._selectedSlotName = slotName;
    this._decorateSections();
    this._renderPanel();
  }

  private _findSlot(slotName: string): LayoutSlot | null {
    return this._doc!.slots.find((s) => s.name === slotName) ?? null;
  }

  private _renderPanel(): void {
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
              Grid: ${this._doc!.grid.columns} cols · ${this._doc!.grid.rowHeight}px rows · ${this._doc!.slots.length} slot${this._doc!.slots.length === 1 ? '' : 's'}
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
      input.addEventListener('change', (ev: Event) => this._onPanelFieldCommit(ev));
    }
    const delBtn = panel.querySelector('[data-action="delete-slot"]');
    if (delBtn && this._selectedSlotName) {
      delBtn.addEventListener('click', () =>
        this._deleteSlot(this._selectedSlotName!),
      );
    }
  }

  private _onPanelFieldCommit(ev: Event): void {
    const input = ev.target as HTMLInputElement | null;
    const field = input?.getAttribute?.('data-field');
    const slotName = this._selectedSlotName;
    if (!field || !slotName) return;
    const slot = this._findSlot(slotName);
    if (!slot) return;
    if (field === 'name') {
      const next = String(input?.value ?? '').trim();
      if (!next || next === slot.name) return;
      this._renameSlot(slot.name, next);
      return;
    }
    const n = parseInt(input?.value ?? '', 10);
    if (!Number.isFinite(n) || n < 1) return;
    this._applySlotChange(slotName, { ...slot, [field]: n });
  }

  private __onKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && this._drag) {
      ev.preventDefault();
      this._cancelDrag();
      return;
    }
    if (
      (ev.key === 'Delete' || ev.key === 'Backspace') &&
      this._selectedSlotName
    ) {
      const ae = document.activeElement as HTMLElement | null;
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
