import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText, uid } from './util.ts';
import { BREAKPOINTS } from './breakpoints.ts';
import './atlas-dialog.ts';
import './atlas-drawer.ts';
import './atlas-bottom-sheet.ts';
import './atlas-search-input.ts';
import './atlas-tabs.ts';
import './atlas-button.ts';

/**
 * `<atlas-media-picker>` — browser for previously-uploaded media.
 *
 * Scope: this primitive is a *library browser*, not an uploader. It is
 * intentionally distinct from `<atlas-file-upload>`: that primitive
 * accepts new local files; this one selects items from a host-supplied
 * catalogue. The catalogue is delivered by the host through `setItems()`
 * (imperative) in response to the `request-items` event the picker
 * fires whenever its query, type filter, or page changes.
 *
 * Attributes:
 *   media-type — "image" (default) | "video" | "any"
 *   multiple   — boolean. Multi-select tile grid.
 *   value      — comma-separated MediaItem ids (single id when not
 *                multiple).
 *   label      — visible label (C3.2).
 *   name       — required for auto-testid emit + form submission.
 *   open       — boolean. Reflects open state. Set to programmatically
 *                open / close.
 *
 * Events:
 *   request-items → CustomEvent<{ query, type, page }> on every
 *                   query / type-tab / pagination change.
 *   change        → CustomEvent<{ value }> on commit (Done button or
 *                   single-select tile click).
 *
 * Out of scope: actual upload, network fetch. The host owns those.
 *
 * Responsive: viewport ≥ 900px (`--atlas-bp-md`) renders in
 * `<atlas-dialog>`; narrower renders in `<atlas-bottom-sheet>` when
 * available, falling back to `<atlas-drawer side="bottom">` (until a
 * dedicated `<atlas-bottom-sheet>` element
 * lands).
 *
 * NOTE: this element is NOT itself form-associated. Its emitted
 * `change` event carries the selection; surfaces that need a hidden
 * form field can mirror that into an `<atlas-input>`.
 */

const sheet = createSheet(`
  :host {
    display: inline-block;
    font-family: var(--atlas-font-family);
  }
  label.legend {
    display: block;
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text);
    margin-bottom: var(--atlas-space-xs);
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    font-family: inherit;
    font-size: var(--atlas-font-size-sm);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    box-sizing: border-box;
  }
  .trigger:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  .trigger:disabled { cursor: not-allowed; opacity: 0.6; }

  .preview-strip {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .preview-strip .chip {
    width: 28px; height: 28px;
    border-radius: var(--atlas-radius-sm);
    background-size: cover;
    background-position: center;
    background-color: var(--atlas-color-surface);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  }
  .preview-strip .more {
    font-size: var(--atlas-font-size-xs);
    color: var(--atlas-color-text-muted);
  }
`);

/** A single browseable media item. */
export interface MediaItem {
  id: string;
  /** "image" | "video" | "doc" — determines which filter tab it lands under. */
  kind: 'image' | 'video' | 'doc';
  /** Thumbnail URL (image src or video poster). */
  src: string;
  /** Accessible name; falls back to `name` then `id`. */
  alt?: string;
  /** Human-readable name shown under the tile. */
  name?: string;
  /** Optional duration label for video tiles, e.g. "1:23". */
  duration?: string;
  /** Optional MIME type. */
  mime?: string;
}

export interface AtlasMediaPickerChangeDetail {
  value: string | string[];
}

export interface AtlasMediaPickerRequestDetail {
  query: string;
  type: 'image' | 'video' | 'doc' | 'any';
  page: number;
}

type FilterTab = 'all' | 'image' | 'video' | 'doc';

const FILTER_TABS: ReadonlyArray<{ value: FilterTab; label: string }> = [
  { value: 'all',   label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'doc',   label: 'Docs' },
];

// Inner-shell stylesheet adopted into the dialog/drawer body. Targets the
// elements rendered inside the slotted body so they pick up tokens.
const innerSheet = createSheet(`
  .picker-body {
    display: flex;
    flex-direction: column;
    gap: var(--atlas-space-sm);
    min-height: 320px;
  }
  .picker-toolbar {
    display: flex;
    flex-direction: column;
    gap: var(--atlas-space-sm);
  }
  @media (min-width: 640px) {
    .picker-toolbar {
      flex-direction: row;
      align-items: center;
    }
    .picker-toolbar atlas-search-input { flex: 1 1 auto; }
  }
  .picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--atlas-space-sm);
    align-content: start;
    overflow-y: auto;
    padding: 2px; /* allow focus-ring around tiles to render */
  }
  .picker-tile {
    position: relative;
    /* Explicit intrinsic sizing avoids CLS while images load. */
    aspect-ratio: 1 / 1;
    min-height: var(--atlas-touch-target-min, 44px);
    min-width: var(--atlas-touch-target-min, 44px);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
    background: var(--atlas-color-surface);
    overflow: hidden;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    padding: 0;
    color: inherit;
    font-family: inherit;
    text-align: left;
  }
  .picker-tile:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  .picker-tile[aria-checked="true"] {
    border-color: var(--atlas-color-primary);
    box-shadow: 0 0 0 2px var(--atlas-color-primary);
  }
  .picker-tile img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .picker-tile .meta {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    padding: 4px 6px;
    background: linear-gradient(to top, rgba(0,0,0,0.7), transparent);
    color: #fff;
    font-size: var(--atlas-font-size-xs);
    line-height: 1.2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
  }
  .picker-tile .meta .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
  }
  .picker-tile .meta .duration { flex: 0 0 auto; opacity: 0.85; }
  .picker-tile .check {
    position: absolute;
    top: 6px; right: 6px;
    width: 20px; height: 20px;
    border-radius: 50%;
    background: var(--atlas-color-primary);
    color: #fff;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    line-height: 1;
    box-shadow: 0 0 0 2px #fff;
  }
  .picker-tile[aria-checked="true"] .check { display: inline-flex; }
  .picker-tile .badge {
    position: absolute;
    top: 6px; left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: var(--atlas-font-size-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .picker-empty {
    padding: var(--atlas-space-xl);
    text-align: center;
    color: var(--atlas-color-text-muted);
  }
  .picker-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--atlas-space-sm);
    padding-top: var(--atlas-space-sm);
    border-top: 1px solid var(--atlas-color-border);
  }
`);

export class AtlasMediaPicker extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['label', 'media-type', 'multiple', 'value', 'open', 'disabled'];
  }

  declare disabled: boolean;
  declare multiple: boolean;

  static {
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'multiple', AtlasElement.boolAttr('multiple'));
  }

  private readonly _triggerId = uid('atlas-mp');

  private _items: MediaItem[] = [];
  private _selection = new Set<string>();
  private _query = '';
  private _filter: FilterTab = 'all';
  private _page = 1;
  private _built = false;
  private _mql: MediaQueryList | null = null;

  // Outer trigger refs
  private _legend: HTMLLabelElement | null = null;
  private _trigger: HTMLButtonElement | null = null;
  private _previewStrip: HTMLSpanElement | null = null;

  // Inner overlay refs
  private _overlay: HTMLElement | null = null;
  private _gridEl: HTMLDivElement | null = null;
  private _tabsEl: HTMLElement | null = null;
  private _searchEl: HTMLElement | null = null;
  private _emptyEl: HTMLElement | null = null;
  private _doneBtn: HTMLElement | null = null;
  private _cancelBtn: HTMLElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  // -- Public API -----------------------------------------------------

  /**
   * Replace the catalogue. Hosts call this in response to a
   * `request-items` event. Pass an empty array to render the empty
   * state.
   */
  setItems(items: readonly MediaItem[]): void {
    if (!Array.isArray(items)) return;
    this._items = items.map((it) => ({ ...it }));
    if (this._built) this._renderGrid();
  }

  get value(): string | string[] {
    const arr = Array.from(this._selection);
    return this.multiple ? arr : (arr[0] ?? '');
  }
  set value(v: string | readonly string[] | null | undefined) {
    this._selection.clear();
    if (Array.isArray(v)) {
      for (const id of v) if (typeof id === 'string' && id) this._selection.add(id);
    } else if (typeof v === 'string' && v) {
      this._selection.add(v);
    }
    this._reflectValueAttr();
    if (this._built) {
      this._syncTilesSelection();
      this._renderPreviewStrip();
    }
  }

  open(): void {
    if (this.disabled) return;
    if (!this.hasAttribute('open')) this.setAttribute('open', '');
    this._ensureOverlay();
    this._mountOverlay();
  }

  close(): void {
    if (this.hasAttribute('open')) this.removeAttribute('open');
    this._closeOverlay();
  }

  // -- Lifecycle ------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._readSelectionFromAttr();
    this._syncAll();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._teardownOverlay();
    if (this._mql) {
      this._mql.removeEventListener('change', this._onMqlChange);
      this._mql = null;
    }
  }

  override attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (!this._built) return;
    if (oldVal === newVal) return;
    this._sync(name);
  }

  // -- Build / sync ---------------------------------------------------

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const label = this.getAttribute('label') ?? '';
    root.innerHTML = `
      ${
        label
          ? `<label class="legend" for="${escapeAttr(this._triggerId)}">${escapeText(label)}</label>`
          : ''
      }
      <button type="button" class="trigger" id="${escapeAttr(this._triggerId)}"
              aria-haspopup="dialog" aria-expanded="false">
        <span class="preview-strip" aria-hidden="true"></span>
        <span class="trigger-label">Browse media</span>
      </button>
    `;
    this._legend       = root.querySelector<HTMLLabelElement>('label.legend');
    this._trigger      = root.querySelector<HTMLButtonElement>('.trigger');
    this._previewStrip = root.querySelector<HTMLSpanElement>('.preview-strip');

    this._trigger?.addEventListener('click', () => {
      if (this.disabled) return;
      this.hasAttribute('open') ? this.close() : this.open();
    });

    // Keep an eye on the breakpoint so we re-mount the right shell.
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this._mql = window.matchMedia(`(min-width: ${BREAKPOINTS.md}px)`);
      this._mql.addEventListener('change', this._onMqlChange);
    }

    this._built = true;
  }

  private _onMqlChange = (): void => {
    if (!this.hasAttribute('open')) return;
    // Re-mount under the right shell (dialog vs drawer).
    this._teardownOverlay();
    this._mountOverlay();
  };

  private _readSelectionFromAttr(): void {
    const raw = this.getAttribute('value');
    this._selection.clear();
    if (!raw) return;
    if (this.multiple) {
      for (const part of raw.split(',')) {
        const id = part.trim();
        if (id) this._selection.add(id);
      }
    } else {
      this._selection.add(raw.trim());
    }
  }

  private _reflectValueAttr(): void {
    const arr = Array.from(this._selection);
    const next = this.multiple ? arr.join(',') : (arr[0] ?? '');
    if (this.getAttribute('value') === next) return;
    if (next) this.setAttribute('value', next);
    else this.removeAttribute('value');
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('disabled');
    this._sync('multiple');
    this._sync('open');
    this._renderPreviewStrip();
  }

  private _sync(name: string): void {
    const root = this.shadowRoot;
    if (!root) return;
    switch (name) {
      case 'label':
        this._syncLabel();
        break;
      case 'disabled':
        if (this._trigger) this._trigger.disabled = this.disabled;
        if (this.disabled) this.close();
        break;
      case 'multiple':
        this._readSelectionFromAttr();
        this._renderPreviewStrip();
        if (this._gridEl) this._syncTilesSelection();
        break;
      case 'value':
        this._readSelectionFromAttr();
        this._renderPreviewStrip();
        if (this._gridEl) this._syncTilesSelection();
        break;
      case 'open':
        if (this.hasAttribute('open')) this._mountOverlay();
        else this._closeOverlay();
        break;
      case 'media-type':
        // Default tab follows the requested type.
        this._filter = this._defaultTabForType();
        if (this._tabsEl) (this._tabsEl as unknown as { value: string }).value = this._filter;
        if (this._gridEl) this._renderGrid();
        this._fireRequest();
        break;
    }
  }

  private _defaultTabForType(): FilterTab {
    const t = (this.getAttribute('media-type') ?? 'image').toLowerCase();
    if (t === 'video') return 'video';
    if (t === 'image') return 'image';
    return 'all';
  }

  private _syncLabel(): void {
    const root = this.shadowRoot;
    if (!root || !this._trigger) return;
    const label = this.getAttribute('label') ?? '';
    if (label) {
      if (!this._legend) {
        const lbl = document.createElement('label');
        lbl.className = 'legend';
        lbl.setAttribute('for', this._triggerId);
        root.insertBefore(lbl, this._trigger);
        this._legend = lbl;
      }
      this._legend.textContent = label;
    } else if (this._legend) {
      this._legend.remove();
      this._legend = null;
    }
  }

  // -- Overlay (dialog or drawer) ------------------------------------

  private _useDialog(): boolean {
    if (typeof window === 'undefined') return true;
    return window.innerWidth >= BREAKPOINTS.md;
  }

  private _ensureOverlay(): void {
    if (this._filter === 'all') this._filter = this._defaultTabForType();
  }

  private _mountOverlay(): void {
    if (this._overlay) return;
    if (this.disabled) return;

    const useDialog = this._useDialog();
    // Mobile: prefer atlas-bottom-sheet (registered in batch 1) when present;
    // fall back to atlas-drawer side="bottom" if the element is unavailable
    // at runtime (older bundles).
    const hasBottomSheet =
      typeof customElements !== 'undefined' &&
      customElements.get('atlas-bottom-sheet') !== undefined;
    const tag = useDialog
      ? 'atlas-dialog'
      : hasBottomSheet
        ? 'atlas-bottom-sheet'
        : 'atlas-drawer';
    const overlay = document.createElement(tag) as HTMLElement & {
      open: () => void;
      close: (v?: string) => void;
    };
    overlay.setAttribute('heading', this.getAttribute('label') || 'Choose media');
    if (!useDialog && tag === 'atlas-drawer') {
      overlay.setAttribute('side', 'bottom');
      overlay.setAttribute('size', 'lg');
    } else {
      overlay.setAttribute('size', 'lg');
    }

    // Body
    const body = document.createElement('div');
    body.className = 'picker-body';

    const toolbar = document.createElement('div');
    toolbar.className = 'picker-toolbar';

    const search = document.createElement('atlas-search-input');
    search.setAttribute('placeholder', 'Search media…');
    search.setAttribute('aria-label', 'Search media');
    if (this._query) search.setAttribute('value', this._query);

    const tabs = document.createElement('atlas-tabs') as HTMLElement & {
      tabs: typeof FILTER_TABS;
      value: string | null;
    };
    tabs.setAttribute('aria-label', 'Filter media');
    tabs.tabs = FILTER_TABS;
    tabs.value = this._filter;

    toolbar.appendChild(search);
    toolbar.appendChild(tabs);

    const grid = document.createElement('div');
    grid.className = 'picker-grid';
    grid.setAttribute('role', 'listbox');
    grid.setAttribute(
      'aria-multiselectable',
      this.multiple ? 'true' : 'false',
    );

    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = 'No media found.';
    empty.hidden = true;

    body.appendChild(toolbar);
    body.appendChild(grid);
    body.appendChild(empty);

    // Footer (slotted into <atlas-dialog slot="actions">)
    const footer = document.createElement('div');
    footer.setAttribute('slot', 'actions');
    footer.className = 'picker-footer';
    const cancel = document.createElement('atlas-button');
    cancel.setAttribute('variant', 'secondary');
    cancel.textContent = 'Cancel';
    const done = document.createElement('atlas-button');
    done.setAttribute('variant', 'primary');
    done.textContent = 'Done';
    footer.appendChild(cancel);
    footer.appendChild(done);

    overlay.appendChild(body);
    overlay.appendChild(footer);

    // Style sheet adoption: drawer/dialog are light-DOM, so adopt into
    // document if not already present.
    if (!document.adoptedStyleSheets.includes(innerSheet)) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, innerSheet];
    }

    document.body.appendChild(overlay);
    this._overlay = overlay;
    this._gridEl = grid;
    this._tabsEl = tabs;
    this._searchEl = search;
    this._emptyEl = empty;
    this._doneBtn = done;
    this._cancelBtn = cancel;

    // Wire events
    search.addEventListener('input', (ev) => {
      const detail = (ev as CustomEvent<{ value: string }>).detail;
      this._query = detail?.value ?? '';
      this._page = 1;
      this._renderGrid();
      this._fireRequest();
    });
    tabs.addEventListener('change', (ev) => {
      const v = (ev as CustomEvent<{ value: string }>).detail?.value;
      if (!v) return;
      this._filter = (v as FilterTab) ?? 'all';
      this._page = 1;
      this._renderGrid();
      this._fireRequest();
    });
    grid.addEventListener('click', (ev) => this._onTileClick(ev));
    grid.addEventListener('keydown', (ev) => this._onGridKey(ev));
    cancel.addEventListener('click', () => {
      // Restore prior selection from attribute and close.
      this._readSelectionFromAttr();
      this._renderPreviewStrip();
      overlay.close('cancel');
    });
    done.addEventListener('click', () => {
      this._reflectValueAttr();
      this._emitChange();
      overlay.close('done');
    });
    overlay.addEventListener('close', () => {
      this._teardownOverlay();
      if (this.hasAttribute('open')) this.removeAttribute('open');
      if (this._trigger) this._trigger.setAttribute('aria-expanded', 'false');
    });

    // Show modally + initial render
    overlay.open();
    if (this._trigger) this._trigger.setAttribute('aria-expanded', 'true');
    this._renderGrid();
    this._fireRequest();
  }

  private _closeOverlay(): void {
    const ov = this._overlay as (HTMLElement & { close: (v?: string) => void }) | null;
    if (!ov) return;
    ov.close('dismiss');
  }

  private _teardownOverlay(): void {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
    this._gridEl = null;
    this._tabsEl = null;
    this._searchEl = null;
    this._emptyEl = null;
    this._doneBtn = null;
    this._cancelBtn = null;
  }

  // -- Grid render ----------------------------------------------------

  private _filteredItems(): MediaItem[] {
    const reqType = (this.getAttribute('media-type') ?? 'image').toLowerCase();
    const tab = this._filter;
    const q = this._query.trim().toLowerCase();
    return this._items.filter((it) => {
      if (reqType === 'image' && it.kind !== 'image' && tab === 'all') return false;
      if (reqType === 'video' && it.kind !== 'video' && tab === 'all') return false;
      if (tab !== 'all' && it.kind !== tab) return false;
      if (!q) return true;
      const hay = `${it.name ?? ''} ${it.alt ?? ''} ${it.id}`.toLowerCase();
      return hay.includes(q);
    });
  }

  private _renderGrid(): void {
    const grid = this._gridEl;
    const empty = this._emptyEl;
    if (!grid || !empty) return;

    const filtered = this._filteredItems();
    if (filtered.length === 0) {
      grid.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    let html = '';
    for (let i = 0; i < filtered.length; i++) {
      const it = filtered[i];
      if (!it) continue;
      const sel = this._selection.has(it.id);
      const altRaw = it.alt ?? it.name ?? it.id;
      // Tile is a button-shaped focusable toggleable element. Use a real
      // <button> here so the dialog body retains keyboard semantics.
      // Light-DOM tile inside the dialog is rendered as raw markup but
      // remains a <button> element (atlas-button forwards click behaviour
      // through shadow DOM and would not propagate role="option" cleanly,
      // so a button serves the listbox role-tile pattern best).
      html += `
        <button type="button" class="picker-tile"
                role="option"
                aria-checked="${sel ? 'true' : 'false'}"
                aria-label="${escapeAttr(altRaw)}"
                data-id="${escapeAttr(it.id)}"
                data-idx="${i}"
                tabindex="${i === 0 ? '0' : '-1'}">
          <img src="${escapeAttr(it.src)}" alt="${escapeAttr(altRaw)}" loading="lazy" decoding="async" />
          ${it.kind !== 'image' ? `<span class="badge">${escapeText(it.kind)}</span>` : ''}
          ${
            (it.name || it.duration)
              ? `<span class="meta">
                   <span class="name">${escapeText(it.name ?? '')}</span>
                   ${it.duration ? `<span class="duration">${escapeText(it.duration)}</span>` : ''}
                 </span>`
              : ''
          }
          <span class="check" aria-hidden="true">✓</span>
        </button>`;
    }
    grid.innerHTML = html;
  }

  private _syncTilesSelection(): void {
    const grid = this._gridEl;
    if (!grid) return;
    const tiles = grid.querySelectorAll<HTMLButtonElement>('.picker-tile');
    for (const t of tiles) {
      const id = t.dataset['id'];
      if (!id) continue;
      t.setAttribute('aria-checked', this._selection.has(id) ? 'true' : 'false');
    }
  }

  private _onTileClick(ev: Event): void {
    const target = ev.target as Element | null;
    const tile = target?.closest<HTMLButtonElement>('.picker-tile');
    if (!tile) return;
    const id = tile.dataset['id'];
    if (!id) return;
    this._toggleSelect(id, tile);
  }

  private _toggleSelect(id: string, tile: HTMLButtonElement): void {
    if (this.multiple) {
      if (this._selection.has(id)) this._selection.delete(id);
      else this._selection.add(id);
      tile.setAttribute(
        'aria-checked',
        this._selection.has(id) ? 'true' : 'false',
      );
    } else {
      // Single-select commits immediately + closes.
      this._selection.clear();
      this._selection.add(id);
      this._syncTilesSelection();
      this._reflectValueAttr();
      this._emitChange();
      this._closeOverlay();
    }
  }

  private _onGridKey(ev: KeyboardEvent): void {
    const grid = this._gridEl;
    if (!grid) return;
    const tiles = Array.from(grid.querySelectorAll<HTMLButtonElement>('.picker-tile'));
    if (tiles.length === 0) return;
    const current = ev.target as HTMLElement | null;
    const tile = current?.closest<HTMLButtonElement>('.picker-tile');
    if (!tile) return;
    const idx = tiles.indexOf(tile);
    if (idx < 0) return;

    // Compute columns from the rendered grid template.
    const style = getComputedStyle(grid);
    const cols = Math.max(
      1,
      style.gridTemplateColumns.split(' ').filter(Boolean).length,
    );
    let next = -1;
    switch (ev.key) {
      case 'ArrowRight': next = Math.min(tiles.length - 1, idx + 1); break;
      case 'ArrowLeft':  next = Math.max(0, idx - 1); break;
      case 'ArrowDown':  next = Math.min(tiles.length - 1, idx + cols); break;
      case 'ArrowUp':    next = Math.max(0, idx - cols); break;
      case 'Home':       next = 0; break;
      case 'End':        next = tiles.length - 1; break;
      case 'Enter':
      case ' ': {
        ev.preventDefault();
        const id = tile.dataset['id'];
        if (id) this._toggleSelect(id, tile);
        return;
      }
      default: return;
    }
    ev.preventDefault();
    const target2 = tiles[next];
    if (!target2) return;
    for (const t of tiles) t.tabIndex = -1;
    target2.tabIndex = 0;
    target2.focus();
  }

  // -- Trigger preview strip -----------------------------------------

  private _renderPreviewStrip(): void {
    const strip = this._previewStrip;
    if (!strip) return;
    const ids = Array.from(this._selection);
    if (ids.length === 0) {
      strip.innerHTML = '';
      const txt = this._trigger?.querySelector<HTMLSpanElement>('.trigger-label');
      if (txt) txt.textContent = 'Browse media';
      return;
    }
    const items = ids.map((id) => this._items.find((it) => it.id === id)).filter(
      (x): x is MediaItem => !!x,
    );
    const max = 3;
    const head = items.slice(0, max);
    let html = '';
    for (const it of head) {
      html += `<span class="chip" style="background-image:url('${escapeAttr(it.src)}')"></span>`;
    }
    if (ids.length > max) {
      html += `<span class="more">+${ids.length - max}</span>`;
    }
    strip.innerHTML = html;
    const txt = this._trigger?.querySelector<HTMLSpanElement>('.trigger-label');
    if (txt) {
      txt.textContent =
        ids.length === 1
          ? (head[0]?.name ?? head[0]?.id ?? 'Selected media')
          : `${ids.length} items`;
    }
  }

  // -- Events ---------------------------------------------------------

  private _fireRequest(): void {
    const t = (this.getAttribute('media-type') ?? 'image').toLowerCase();
    const requested = this._filter === 'all'
      ? (t === 'image' || t === 'video' ? (t as 'image' | 'video') : 'any')
      : this._filter;
    const detail: AtlasMediaPickerRequestDetail = {
      query: this._query,
      type: requested,
      page: this._page,
    };
    this.dispatchEvent(
      new CustomEvent<AtlasMediaPickerRequestDetail>('request-items', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _emitChange(): void {
    const value = this.value;
    this.dispatchEvent(
      new CustomEvent<AtlasMediaPickerChangeDetail>('change', {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-changed`, { value });
    }
  }
}

AtlasElement.define('atlas-media-picker', AtlasMediaPicker);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-media-picker': AtlasMediaPicker;
  }
}
