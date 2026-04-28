import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-toggle-group> — segmented row of toggleable items.
 *
 * Differentiation vs. `<atlas-segmented-control>`:
 *
 *   `<atlas-segmented-control>` — single-select only, role=radiogroup,
 *       optimal for 2–4 *canonical* mutually-exclusive values. Use it
 *       for view-mode toggles, frequency pickers, alignment in forms.
 *
 *   `<atlas-toggle-group>`      — supports `selection="multiple"` AND
 *       single-select. Use it when you need multi-select (formatting
 *       bar: bold + italic + underline together) OR when the item
 *       count is >5 (single-select degrades visually). Each item gets
 *       its own button with `aria-pressed` per-item, not radio
 *       semantics.
 *
 * In short: pick segmented-control for 2–4 canonical options;
 * pick toggle-group when you need multi-select or have many items.
 *
 * Composition: `<atlas-toggle-group-item>` children.
 *
 * Attributes:
 *   selection — single (default) | multiple
 *   size      — sm | md (default)
 *   disabled  — disables the entire group
 *   value     — initial value. For single: the active value. For
 *               multiple: a comma-separated list, parsed at connect.
 *
 * Events:
 *   change → CustomEvent<{ value: string | string[] }>
 *
 * Keyboard:
 *   Arrows roam (Roving tabindex). Space/Enter toggles the focused item.
 *   Home/End jump to first/last enabled item.
 */

const sheet = createSheet(`
  :host {
    display: inline-flex;
    align-items: stretch;
    gap: 4px;
    padding: 3px;
    background: var(--atlas-color-surface);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    max-width: 100%;
  }
  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
  ::slotted(atlas-toggle-group-item) {
    flex: 0 0 auto;
  }
`);

export interface AtlasToggleGroupChangeDetail {
  value: string | string[];
}

export class AtlasToggleGroup extends AtlasElement {
  declare selection: string;
  declare size: string;
  declare disabled: boolean;

  static {
    Object.defineProperty(this.prototype, 'selection', AtlasElement.strAttr('selection', 'single'));
    Object.defineProperty(this.prototype, 'size', AtlasElement.strAttr('size', ''));
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
  }

  static override get observedAttributes(): readonly string[] {
    return ['selection', 'value', 'size'];
  }

  private _built = false;
  private _selected: Set<string> = new Set();

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) {
      const slot = document.createElement('slot');
      this.shadowRoot?.appendChild(slot);
      this._built = true;
    }
    this.setAttribute('role', this._selectionMode() === 'multiple' ? 'group' : 'radiogroup');
    this._parseInitialValue();
    // Item upgrade may race; sync after microtask.
    queueMicrotask(() => this._syncItems());
    this.addEventListener('keydown', this._onKey);
  }

  override disconnectedCallback(): void {
    this.removeEventListener('keydown', this._onKey);
  }

  override attributeChangedCallback(name: string, _old: string | null, next: string | null): void {
    if (!this._built) return;
    if (name === 'value') {
      this._parseValueAttr(next ?? '');
      this._syncItems();
    } else if (name === 'selection') {
      this.setAttribute('role', this._selectionMode() === 'multiple' ? 'group' : 'radiogroup');
      this._syncItems();
    } else if (name === 'size') {
      this._syncItems();
    }
  }

  private _selectionMode(): 'single' | 'multiple' {
    return this.getAttribute('selection') === 'multiple' ? 'multiple' : 'single';
  }

  /** Returns connected `<atlas-toggle-group-item>` children, in order. */
  private _items(): HTMLElement[] {
    return Array.from(this.querySelectorAll(':scope > atlas-toggle-group-item'));
  }

  private _enabledItems(): HTMLElement[] {
    return this._items().filter((it) => !it.hasAttribute('disabled'));
  }

  /** Public: get the current value. */
  get value(): string | string[] {
    if (this._selectionMode() === 'multiple') {
      return Array.from(this._selected);
    }
    return this._selected.values().next().value ?? '';
  }

  /** Public: set the value programmatically. Triggers `change`. */
  set value(next: string | string[] | null | undefined) {
    this._setValue(next, true);
  }

  private _parseInitialValue(): void {
    const raw = this.getAttribute('value');
    if (raw == null) return;
    this._parseValueAttr(raw);
  }

  private _parseValueAttr(raw: string): void {
    if (this._selectionMode() === 'multiple') {
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
      this._selected = new Set(parts);
    } else {
      this._selected = raw ? new Set([raw]) : new Set();
    }
  }

  private _setValue(next: string | string[] | null | undefined, fire: boolean): void {
    if (this._selectionMode() === 'multiple') {
      const arr = Array.isArray(next) ? next : next == null ? [] : [String(next)];
      const newSet = new Set(arr.map(String));
      if (sameSet(newSet, this._selected)) return;
      this._selected = newSet;
    } else {
      const v = Array.isArray(next) ? (next[0] ?? null) : next == null ? null : String(next);
      const cur = this._selected.values().next().value ?? null;
      if (v === cur) return;
      this._selected = v ? new Set([v]) : new Set();
    }
    this._syncItems();
    if (fire) this._emitChange();
  }

  private _syncItems(): void {
    const items = this._items();
    const enabled = items.filter((it) => !it.hasAttribute('disabled'));
    const mode = this._selectionMode();
    const size = this.getAttribute('size') ?? '';
    let firstFocusableIndex = 0;
    let foundSelected = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      const value = item.getAttribute('value') ?? '';
      const isSelected = this._selected.has(value);
      item.toggleAttribute('selected', isSelected);
      item.setAttribute('data-pressed', String(isSelected));
      if (mode === 'multiple') {
        item.setAttribute('aria-pressed', String(isSelected));
        item.removeAttribute('role');
      } else {
        item.setAttribute('role', 'radio');
        item.setAttribute('aria-checked', String(isSelected));
        item.removeAttribute('aria-pressed');
      }
      if (size) item.setAttribute('size', size);
      else item.removeAttribute('size');
      if (isSelected && !foundSelected) {
        foundSelected = true;
        firstFocusableIndex = enabled.indexOf(item);
        if (firstFocusableIndex < 0) firstFocusableIndex = 0;
      }
    }
    // Roving tabindex.
    for (let j = 0; j < enabled.length; j++) {
      const it = enabled[j];
      if (!it) continue;
      it.setAttribute('tabindex', j === firstFocusableIndex ? '0' : '-1');
    }
    // Disabled items always get -1.
    for (const it of items) {
      if (it.hasAttribute('disabled')) it.setAttribute('tabindex', '-1');
    }
  }

  /**
   * Public API used by `<atlas-toggle-group-item>` children to commit a
   * click into the group's selection state. External consumers SHOULD
   * use `value` setter instead — this entrypoint exists so item clicks
   * route through the parent's policy (single vs. multiple) without
   * re-exposing internal state.
   */
  toggleFromItem(item: HTMLElement): void {
    if (this.hasAttribute('disabled')) return;
    if (item.hasAttribute('disabled')) return;
    const value = item.getAttribute('value') ?? '';
    if (!value) return;
    if (this._selectionMode() === 'multiple') {
      if (this._selected.has(value)) this._selected.delete(value);
      else this._selected.add(value);
    } else {
      // Single-select: same-value click is a no-op (segmented-control parity).
      if (this._selected.has(value)) return;
      this._selected = new Set([value]);
    }
    this._syncItems();
    this._emitChange();
  }

  private _emitChange(): void {
    const detail: AtlasToggleGroupChangeDetail = { value: this.value };
    this.dispatchEvent(
      new CustomEvent<AtlasToggleGroupChangeDetail>('change', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-changed`, { value: detail.value });
    }
  }

  private _onKey = (ev: KeyboardEvent): void => {
    const target = ev.target as HTMLElement | null;
    if (!target || target.tagName.toLowerCase() !== 'atlas-toggle-group-item') return;
    const enabled = this._enabledItems();
    const idx = enabled.indexOf(target);
    if (idx < 0) return;
    let nextIdx = -1;
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIdx = (idx + 1) % enabled.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIdx = (idx - 1 + enabled.length) % enabled.length;
        break;
      case 'Home': nextIdx = 0; break;
      case 'End':  nextIdx = enabled.length - 1; break;
      case 'Enter':
      case ' ':
        ev.preventDefault();
        this.toggleFromItem(target);
        return;
      default: return;
    }
    ev.preventDefault();
    const target2 = enabled[nextIdx];
    if (!target2) return;
    target2.focus();
  };
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

AtlasElement.define('atlas-toggle-group', AtlasToggleGroup);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-toggle-group': AtlasToggleGroup;
  }
}
