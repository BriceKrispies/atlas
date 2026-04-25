import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';
import type { AtlasCapabilityTile, AtlasCapabilityTileToggleDetail } from './atlas-capability-tile.ts';

/**
 * <atlas-capability-grid> — grid of `<atlas-capability-tile>` children
 * for granting agent capabilities. Always multi-select (the only sensible
 * mode for permission granting — single-select is a radio group).
 *
 * Attributes:
 *   columns   — auto (default) | 2 | 3 | 4
 *   selection — fixed to "multiple" (attribute reflected for clarity)
 *
 * Events:
 *   change    — fires when any tile is toggled. detail: { value: string[] }.
 *
 * Shadow DOM (host wrapper). Tiles live in light DOM and slot into the
 * default slot, keeping authoring straightforward.
 */
export interface AtlasCapabilityGridChangeDetail {
  value: string[];
}

const sheet = createSheet(`
  :host {
    display: block;
  }
  .grid {
    display: grid;
    gap: var(--atlas-space-sm);
    grid-template-columns: 1fr;
  }
  /* "auto" tracks tiles to whatever fits comfortably above 240px. */
  :host(:not([columns])) .grid,
  :host([columns="auto"]) .grid {
    grid-template-columns: 1fr;
  }
  @media (min-width: 640px) {
    :host(:not([columns])) .grid,
    :host([columns="auto"]) .grid {
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    }
    :host([columns="2"]) .grid { grid-template-columns: repeat(2, 1fr); }
    :host([columns="3"]) .grid { grid-template-columns: repeat(2, 1fr); }
    :host([columns="4"]) .grid { grid-template-columns: repeat(2, 1fr); }
  }
  @media (min-width: 900px) {
    :host([columns="3"]) .grid { grid-template-columns: repeat(3, 1fr); }
    :host([columns="4"]) .grid { grid-template-columns: repeat(4, 1fr); }
  }
`);

export class AtlasCapabilityGrid extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['columns', 'selection'];
  }

  private _built = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    // Force selection mode reflection — only "multiple" supported.
    this.setAttribute('selection', 'multiple');
    this.setAttribute('role', 'group');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Capabilities');
    this.addEventListener('toggle', this._onTileToggle as EventListener);
  }

  override disconnectedCallback(): void {
    this.removeEventListener('toggle', this._onTileToggle as EventListener);
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const wrap = document.createElement('div');
    wrap.className = 'grid';
    const slot = document.createElement('slot');
    wrap.appendChild(slot);
    root.appendChild(wrap);
    this._built = true;
  }

  /** Currently-selected capability values, derived from tile state. */
  get value(): string[] {
    const out: string[] = [];
    for (const tile of this._tiles()) {
      if (tile.selected) {
        const v = tile.getAttribute('value');
        if (v != null) out.push(v);
      }
    }
    return out;
  }

  /** Set the selected capabilities programmatically. */
  set value(values: string[]) {
    const set = new Set(values);
    for (const tile of this._tiles()) {
      const v = tile.getAttribute('value');
      tile.selected = v != null && set.has(v);
    }
    this._emitChange();
  }

  private _tiles(): AtlasCapabilityTile[] {
    return Array.from(this.querySelectorAll(':scope > atlas-capability-tile')) as AtlasCapabilityTile[];
  }

  private _onTileToggle = (ev: Event): void => {
    const detail = (ev as CustomEvent<AtlasCapabilityTileToggleDetail>).detail;
    if (!detail) return;
    this._emitChange();
  };

  private _emitChange(): void {
    this.dispatchEvent(
      new CustomEvent<AtlasCapabilityGridChangeDetail>('change', {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

AtlasElement.define('atlas-capability-grid', AtlasCapabilityGrid);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-capability-grid': AtlasCapabilityGrid;
  }
}
