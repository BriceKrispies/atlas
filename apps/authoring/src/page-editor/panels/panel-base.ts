/**
 * Shared base for the three page-editor panels (left, right, bottom).
 *
 * Each panel is its own `AtlasSurface` so it gets a stable surfaceId and
 * auto-generated test ids for its header controls. The base provides:
 *
 *   - Light DOM (so children with their own shadow can still slot in via
 *     `<slot name=…>` keyed by tab id).
 *   - A header row with a collapse toggle and tab strip placeholder.
 *   - A body region exposing one named slot per tab.
 *   - A resize edge that emits `atlas-panel-resize` (a `dx` delta) which
 *     the shell turns into a `resizePanel` commit.
 *   - A collapse toggle that emits `atlas-panel-toggle`.
 *   - A tab click that emits `atlas-panel-tab`.
 *
 * Stage-2 wires only one tab per panel in service of the existing
 * palette / settings / templates content; stages 3+ extend the tab
 * vocabulary and the panels gain real tab strips.
 */

import { AtlasElement, AtlasSurface } from '@atlas/core';
import type { PanelId } from '../state.ts';

export interface PanelTabSpec {
  id: string;
  label: string;
}

export interface PanelResizeEventDetail {
  panel: PanelId;
  /** Pointer delta on the resize axis since pointer-down (CSS pixels). */
  dx: number;
  /** Phase: 'start' on first delta, 'move' during drag, 'end' on pointer-up. */
  phase: 'start' | 'move' | 'end';
}

export interface PanelToggleEventDetail {
  panel: PanelId;
  open: boolean;
}

export interface PanelTabEventDetail {
  panel: PanelId;
  tab: string;
}

const RESIZE_HANDLE_THICKNESS = 4;

export abstract class PageEditorPanelElement extends AtlasSurface {
  abstract readonly panelId: PanelId;
  /** The axis the resize handle drags along. */
  abstract readonly resizeAxis: 'x' | 'y';
  /** Where the resize handle lives relative to the panel's body. */
  abstract readonly resizeEdge: 'start' | 'end';

  private _tabs: ReadonlyArray<PanelTabSpec> = [];
  private _activeTab = '';
  private _open = true;
  private _built = false;
  private _headerEl: HTMLElement | null = null;
  private _bodyEl: HTMLElement | null = null;
  private _resizeEl: HTMLElement | null = null;
  private _onPointerDown: (e: PointerEvent) => void;
  private _onPointerMove: ((e: PointerEvent) => void) | null = null;
  private _onPointerUp: ((e: PointerEvent) => void) | null = null;
  private _resizeOrigin = 0;

  constructor() {
    super();
    this._onPointerDown = (e) => this._handlePointerDown(e);
  }

  override connectedCallback(): void {
    super.connectedCallback?.();
    if (!this._built) this._build();
    this._reflectAttrs();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback?.();
    if (this._onPointerMove) {
      window.removeEventListener('pointermove', this._onPointerMove);
      this._onPointerMove = null;
    }
    if (this._onPointerUp) {
      window.removeEventListener('pointerup', this._onPointerUp);
      this._onPointerUp = null;
    }
  }

  /** Configure available tabs. The shell calls this once at mount. */
  setTabs(tabs: ReadonlyArray<PanelTabSpec>): void {
    this._tabs = tabs;
    if (this._built) this._renderTabStrip();
  }

  /** Snapshot-driven update from the shell. */
  setActiveTab(tab: string): void {
    if (this._activeTab === tab) return;
    this._activeTab = tab;
    if (this._built) {
      this.setAttribute('data-active-tab', tab);
      this._renderTabStrip();
      this._reflectActiveSlot();
    }
  }

  setOpen(open: boolean): void {
    if (this._open === open) return;
    this._open = open;
    if (this._built) this.setAttribute('data-open', String(open));
  }

  // ---- internals ----

  private _build(): void {
    this._built = true;
    this.setAttribute('data-panel-id', this.panelId);
    this.setAttribute('data-open', String(this._open));
    if (this._activeTab) this.setAttribute('data-active-tab', this._activeTab);

    const header = document.createElement('header');
    header.setAttribute('data-role', 'panel-header');
    header.classList.add('atlas-page-editor-panel__header');

    const tabStrip = document.createElement('div');
    tabStrip.classList.add('atlas-page-editor-panel__tabs');
    tabStrip.setAttribute('role', 'tablist');
    tabStrip.setAttribute('data-role', 'tab-strip');
    header.appendChild(tabStrip);

    // Collapse button sits at the trailing edge of the header so the tab
    // strip / single-title gets the leading prominence. It's also styled as
    // a compact icon button (see shell CSS) so it doesn't crowd the header.
    const collapseBtn = document.createElement('atlas-button') as HTMLElement & {
      setAttribute: (name: string, value: string) => void;
    };
    collapseBtn.setAttribute('name', 'collapse');
    collapseBtn.setAttribute('variant', 'ghost');
    collapseBtn.setAttribute('size', 'sm');
    collapseBtn.setAttribute('aria-label', `Collapse ${this.panelId} panel`);
    collapseBtn.textContent = collapseGlyphFor(this.panelId);
    collapseBtn.addEventListener('click', () => {
      this.dispatchEvent(
        new CustomEvent<PanelToggleEventDetail>('atlas-panel-toggle', {
          detail: { panel: this.panelId, open: false },
          bubbles: true,
          composed: true,
        }),
      );
    });
    header.appendChild(collapseBtn);

    const body = document.createElement('div');
    body.classList.add('atlas-page-editor-panel__body');
    body.setAttribute('data-role', 'panel-body');

    const resize = document.createElement('div');
    resize.classList.add('atlas-page-editor-panel__resize');
    resize.setAttribute('data-role', 'resize-handle');
    resize.setAttribute('data-axis', this.resizeAxis);
    resize.setAttribute('data-edge', this.resizeEdge);
    resize.setAttribute('aria-hidden', 'true');
    resize.addEventListener('pointerdown', this._onPointerDown);

    // Order: resize handle goes adjacent to the canvas-side edge.
    if (this.resizeEdge === 'start') {
      this.appendChild(resize);
      this.appendChild(header);
      this.appendChild(body);
    } else {
      this.appendChild(header);
      this.appendChild(body);
      this.appendChild(resize);
    }

    this._headerEl = header;
    this._bodyEl = body;
    this._resizeEl = resize;
    this._renderTabStrip();
  }

  private _renderTabStrip(): void {
    if (!this._headerEl) return;
    const strip = this._headerEl.querySelector('[data-role="tab-strip"]') as HTMLElement | null;
    if (!strip) return;
    strip.textContent = '';

    if (this._tabs.length <= 1) {
      // Single-tab panels render a static label instead of a tab strip.
      const label = document.createElement('span');
      label.classList.add('atlas-page-editor-panel__title');
      const active = this._tabs[0];
      label.textContent = active?.label ?? '';
      strip.appendChild(label);
      return;
    }

    for (const tab of this._tabs) {
      const btn = document.createElement('atlas-button') as HTMLElement & {
        setAttribute: (n: string, v: string) => void;
      };
      btn.setAttribute('name', `tab`);
      btn.setAttribute('data-tab-id', tab.id);
      btn.setAttribute('variant', tab.id === this._activeTab ? 'primary' : 'ghost');
      btn.setAttribute('size', 'sm');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', tab.id === this._activeTab ? 'true' : 'false');
      btn.textContent = tab.label;
      btn.addEventListener('click', () => {
        this.dispatchEvent(
          new CustomEvent<PanelTabEventDetail>('atlas-panel-tab', {
            detail: { panel: this.panelId, tab: tab.id },
            bubbles: true,
            composed: true,
          }),
        );
      });
      strip.appendChild(btn);
    }
  }

  private _reflectActiveSlot(): void {
    if (!this._bodyEl) return;
    // The shell injects a `<div data-tab="…">` per tab; show only the
    // active one. This is a Light-DOM panel so we control children directly.
    const slots = this._bodyEl.querySelectorAll('[data-tab]');
    for (const node of slots) {
      const el = node as HTMLElement;
      el.style.display = el.getAttribute('data-tab') === this._activeTab ? '' : 'none';
    }
  }

  private _reflectAttrs(): void {
    if (!this._built) return;
    this.setAttribute('data-open', String(this._open));
    if (this._activeTab) this.setAttribute('data-active-tab', this._activeTab);
    this._reflectActiveSlot();
  }

  private _handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = this._resizeEl;
    if (!handle) return;
    handle.setPointerCapture?.(e.pointerId);
    this._resizeOrigin = this.resizeAxis === 'x' ? e.clientX : e.clientY;

    let lastDelta = 0;
    let started = false;

    const onMove = (mv: PointerEvent): void => {
      const v = this.resizeAxis === 'x' ? mv.clientX : mv.clientY;
      const raw = v - this._resizeOrigin;
      // The bottom panel grows upward as pointer moves up; same for right
      // panel growing leftward. Flip sign for those edges.
      const delta = this.resizeEdge === 'start' ? -raw : raw;
      if (!started) {
        started = true;
        this.dispatchEvent(
          new CustomEvent<PanelResizeEventDetail>('atlas-panel-resize', {
            detail: { panel: this.panelId, dx: delta, phase: 'start' },
            bubbles: true,
            composed: true,
          }),
        );
      } else if (delta !== lastDelta) {
        this.dispatchEvent(
          new CustomEvent<PanelResizeEventDetail>('atlas-panel-resize', {
            detail: { panel: this.panelId, dx: delta, phase: 'move' },
            bubbles: true,
            composed: true,
          }),
        );
      }
      lastDelta = delta;
    };

    const onUp = (mv: PointerEvent): void => {
      handle.releasePointerCapture?.(mv.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this._onPointerMove = null;
      this._onPointerUp = null;
      this.dispatchEvent(
        new CustomEvent<PanelResizeEventDetail>('atlas-panel-resize', {
          detail: { panel: this.panelId, dx: lastDelta, phase: 'end' },
          bubbles: true,
          composed: true,
        }),
      );
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    this._onPointerMove = onMove;
    this._onPointerUp = onUp;
  }
}

function collapseGlyphFor(panel: PanelId): string {
  // Visual hint about which way collapse goes. Replace with icons when
  // `@atlas/design` ships an icon element.
  switch (panel) {
    case 'left':
      return '◀';
    case 'right':
      return '▶';
    case 'bottom':
      return '▼';
  }
}

export const RESIZE_THICKNESS = RESIZE_HANDLE_THICKNESS;

// AtlasElement.define is called by the per-panel modules.
export { AtlasElement };
