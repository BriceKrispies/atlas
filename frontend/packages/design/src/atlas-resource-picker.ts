import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText } from './util.ts';

/**
 * <atlas-resource-picker> — UI for selecting Atlas resources (pages,
 * media, users, etc). Purely presentational: this primitive does NOT
 * call backend APIs. Consumers wire data via:
 *
 *   1. Listening for `request-results` with detail
 *      `{ query: string; type: string }`, and
 *   2. Calling `picker.setResults(items)` with the matched results.
 *
 * Items are arbitrary objects; each MUST contain at least `id` and
 * `label`. Optional `description` is rendered as a secondary line.
 *
 * Responsive shell:
 *   - Viewports ≥900px (`--atlas-bp-md`) open in `<atlas-dialog>`.
 *   - Narrower viewports prefer `<atlas-bottom-sheet>` if registered;
 *     when the bottom-sheet element is not available the picker falls
 *     back to `<atlas-drawer side="bottom">`.
 *   - Detection runs once at `open()` via `matchMedia` and is recomputed
 *     each time the picker is opened.
 *
 * Attributes:
 *   resource-type — page | media | user | any (default any)
 *   multiple      — (boolean) allow multi-select
 *   value         — current selection (string id or comma-separated ids)
 *
 * Events:
 *   open               — picker opened.
 *   close              — picker closed.
 *   request-results    — detail: { query: string; type: string }.
 *   change             — detail: { value: string | string[] }.
 *
 * API:
 *   .open()
 *   .close()
 *   .setResults(items: Array<{ id, label, description? }>)
 *
 * Shadow DOM (host wrapper). Inner shell is composed of atlas elements
 * (atlas-dialog / atlas-bottom-sheet / atlas-drawer + atlas-search-input).
 */
export interface AtlasResourcePickerItem {
  id: string;
  label: string;
  description?: string;
  [k: string]: unknown;
}

export interface AtlasResourcePickerChangeDetail {
  value: string | string[];
}

export interface AtlasResourcePickerRequestDetail {
  query: string;
  type: string;
}

const MOBILE_BREAKPOINT_PX = 900; // mirrors --atlas-bp-md

const sheet = createSheet(`
  :host { display: contents; }
  .picker-body {
    display: flex;
    flex-direction: column;
    gap: var(--atlas-space-sm);
    min-height: 320px;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    max-height: 50vh;
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
  }
  .result {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    min-height: var(--atlas-touch-target-min, 44px);
    cursor: pointer;
    border-bottom: 1px solid var(--atlas-color-border);
    -webkit-tap-highlight-color: transparent;
  }
  .result:last-child { border-bottom: 0; }
  .result:hover { background: var(--atlas-color-surface-hover, #f3f4f6); }
  .result[aria-selected="true"] {
    background: var(--atlas-color-primary-subtle, #eff4ff);
  }
  .result:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -2px;
  }
  .result .check {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    color: var(--atlas-color-primary, #2563eb);
  }
  .result:not([aria-selected="true"]) .check { visibility: hidden; }
  .result .meta { min-width: 0; flex: 1 1 auto; }
  .result .label {
    font-weight: var(--atlas-font-weight-medium, 500);
    color: var(--atlas-color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .result .description {
    color: var(--atlas-color-text-muted);
    font-size: var(--atlas-font-size-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    padding: var(--atlas-space-xl);
    text-align: center;
    color: var(--atlas-color-text-muted);
  }
`);

type ShellKind = 'dialog' | 'bottom-sheet' | 'drawer';

interface ShellHandle {
  el: HTMLElement & { open?: () => void; close?: (v?: string) => void };
  kind: ShellKind;
  body: HTMLElement;
  actions: HTMLElement;
}

export class AtlasResourcePicker extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['resource-type', 'multiple', 'value'];
  }

  declare multiple: boolean;
  static {
    Object.defineProperty(this.prototype, 'multiple', AtlasElement.boolAttr('multiple'));
  }

  private _items: AtlasResourcePickerItem[] = [];
  private _selected = new Set<string>();
  private _shell: ShellHandle | null = null;
  private _searchInput: HTMLElement | null = null;
  private _resultsEl: HTMLUListElement | null = null;
  private _emptyEl: HTMLElement | null = null;
  private _query = '';
  private _isOpen = false;
  private _built = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) {
      const root = this.shadowRoot;
      if (root) {
        const slot = document.createElement('slot');
        root.appendChild(slot);
      }
      this._built = true;
    }
    this._syncValueFromAttr();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'value') this._syncValueFromAttr();
  }

  /** Provide search results from the consumer. */
  setResults(items: AtlasResourcePickerItem[]): void {
    this._items = Array.isArray(items) ? items.slice(0) : [];
    this._renderResults();
  }

  /** Open the picker. Picks dialog/bottom-sheet/drawer per viewport. */
  open(): void {
    if (this._isOpen) return;
    this._buildShell();
    this._isOpen = true;
    this._shell?.el.open?.();
    this.dispatchEvent(new CustomEvent('open', { bubbles: true, composed: true }));
    // Initial empty-query fetch — gives the consumer a chance to seed results.
    this._emitRequest('');
    queueMicrotask(() => {
      const inner = this._searchInput?.shadowRoot?.querySelector('input') as HTMLInputElement | null;
      if (inner) inner.focus();
      else this._searchInput?.focus?.();
    });
  }

  /** Close the picker shell. */
  close(): void {
    if (!this._isOpen) return;
    this._shell?.el.close?.();
  }

  private _syncValueFromAttr(): void {
    const raw = this.getAttribute('value');
    this._selected.clear();
    if (raw && raw !== '') {
      for (const v of raw.split(',')) {
        const t = v.trim();
        if (t) this._selected.add(t);
      }
    }
    this._renderResults();
  }

  private _detectShellKind(): ShellKind {
    const isMobile = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`).matches;
    if (!isMobile) return 'dialog';
    if (customElements.get('atlas-bottom-sheet')) return 'bottom-sheet';
    return 'drawer';
  }

  private _buildShell(): void {
    // Tear down any previously-built shell so the picker can be reopened
    // on a different viewport size.
    if (this._shell) {
      try { this._shell.el.remove(); } catch { /* noop */ }
      this._shell = null;
    }
    const kind = this._detectShellKind();
    const heading = this._headingText();

    let el: HTMLElement & { open?: () => void; close?: (v?: string) => void };
    if (kind === 'dialog') {
      el = document.createElement('atlas-dialog');
      el.setAttribute('heading', heading);
      el.setAttribute('size', 'md');
    } else if (kind === 'bottom-sheet') {
      el = document.createElement('atlas-bottom-sheet');
      el.setAttribute('heading', heading);
    } else {
      el = document.createElement('atlas-drawer');
      el.setAttribute('side', 'bottom');
      el.setAttribute('heading', heading);
    }

    // Body container
    const body = document.createElement('div');
    body.className = 'picker-body';

    const search = document.createElement('atlas-search-input');
    search.setAttribute('label', 'Search');
    search.setAttribute('placeholder', 'Search resources…');
    search.addEventListener('input', (ev) => this._onSearchInput(ev));
    search.addEventListener('change', (ev) => this._onSearchInput(ev));
    body.appendChild(search);

    const list = document.createElement('ul');
    list.className = 'results';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Search results');
    if (this.multiple) list.setAttribute('aria-multiselectable', 'true');
    list.addEventListener('click', (ev) => this._onResultClick(ev));
    list.addEventListener('keydown', (ev) => this._onResultKey(ev));
    body.appendChild(list);

    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No results yet. Type to search.';
    body.appendChild(empty);

    // Actions
    const actions = document.createElement('atlas-stack');
    actions.setAttribute('slot', 'actions');
    actions.setAttribute('direction', 'row');
    actions.setAttribute('gap', 'sm');
    const cancelBtn = document.createElement('atlas-button');
    cancelBtn.setAttribute('variant', 'secondary');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.close());
    const confirmBtn = document.createElement('atlas-button');
    confirmBtn.textContent = this.multiple ? 'Done' : 'Select';
    confirmBtn.addEventListener('click', () => this._onConfirm());
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);

    // Append body and actions: dialog/bottom-sheet/drawer all accept
    // default + slot="actions".
    el.appendChild(body);
    el.appendChild(actions);

    el.addEventListener('close', () => {
      this._isOpen = false;
      this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
      // Detach to keep the DOM clean between opens.
      try { el.remove(); } catch { /* noop */ }
      if (this._shell?.el === el) this._shell = null;
    });

    document.body.appendChild(el);
    this._shell = { el, kind, body, actions };
    this._searchInput = search;
    this._resultsEl = list;
    this._emptyEl = empty;
    this._renderResults();
  }

  private _headingText(): string {
    const t = this.getAttribute('resource-type') ?? 'any';
    const map: Record<string, string> = {
      page: 'Select a page',
      media: 'Select a media file',
      user: 'Select a user',
      any: 'Select a resource',
    };
    return map[t] ?? map['any']!;
  }

  private _onSearchInput(ev: Event): void {
    const target = ev.target as HTMLElement & { value?: string };
    const v = (ev as CustomEvent<{ value?: string }>).detail?.value
      ?? target.getAttribute?.('value')
      ?? target.value
      ?? '';
    this._query = String(v ?? '');
    this._emitRequest(this._query);
  }

  private _emitRequest(query: string): void {
    const type = this.getAttribute('resource-type') ?? 'any';
    this.dispatchEvent(
      new CustomEvent<AtlasResourcePickerRequestDetail>('request-results', {
        detail: { query, type },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _renderResults(): void {
    if (!this._resultsEl || !this._emptyEl) return;
    this._resultsEl.innerHTML = '';
    if (this._items.length === 0) {
      this._emptyEl.style.display = '';
      this._resultsEl.style.display = 'none';
      return;
    }
    this._emptyEl.style.display = 'none';
    this._resultsEl.style.display = '';
    const checkSvg =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="check" aria-hidden="true"><path d="M3 8l4 4 6-8"/></svg>';
    for (const item of this._items) {
      const li = document.createElement('li');
      li.className = 'result';
      li.setAttribute('role', 'option');
      li.tabIndex = 0;
      const isSel = this._selected.has(item.id);
      li.setAttribute('aria-selected', isSel ? 'true' : 'false');
      li.dataset['id'] = item.id;
      li.innerHTML = `
        ${checkSvg}
        <span class="meta">
          <span class="label">${escapeText(item.label)}</span>
          ${item.description ? `<span class="description">${escapeText(item.description)}</span>` : ''}
        </span>
      `;
      void escapeAttr; // reserved if we add tooltip attrs later
      this._resultsEl.appendChild(li);
    }
  }

  private _onResultClick(ev: Event): void {
    const target = ev.target as Element | null;
    const li = target?.closest('.result') as HTMLElement | null;
    if (!li) return;
    const id = li.dataset['id'];
    if (!id) return;
    this._toggleSelection(id);
    if (!this.multiple) this._onConfirm();
  }

  private _onResultKey(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement | null;
    if (!target?.classList.contains('result')) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      const id = target.dataset['id'];
      if (id) {
        this._toggleSelection(id);
        if (!this.multiple) this._onConfirm();
      }
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      (target.nextElementSibling as HTMLElement | null)?.focus();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      (target.previousElementSibling as HTMLElement | null)?.focus();
    }
  }

  private _toggleSelection(id: string): void {
    if (this.multiple) {
      if (this._selected.has(id)) this._selected.delete(id);
      else this._selected.add(id);
    } else {
      this._selected.clear();
      this._selected.add(id);
    }
    this._renderResults();
  }

  private _onConfirm(): void {
    const value = this.multiple ? Array.from(this._selected) : (this._selected.values().next().value ?? '');
    this.setAttribute('value', this.multiple ? (value as string[]).join(',') : (value as string));
    this.dispatchEvent(
      new CustomEvent<AtlasResourcePickerChangeDetail>('change', {
        detail: { value: this.multiple ? (value as string[]) : (value as string) },
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }
}

AtlasElement.define('atlas-resource-picker', AtlasResourcePicker);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-resource-picker': AtlasResourcePicker;
  }
}
