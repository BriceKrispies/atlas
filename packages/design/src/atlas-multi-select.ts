import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText, uid } from './util.ts';
import './atlas-icon.ts';
import {
  MultiSelectCore,
  LIFECYCLE,
  type Option,
  type OptionsSource,
  type Delta,
  type Status,
} from './multi-select-core.ts';

const sheet = createSheet(`
  :host {
    display: block;
    font-family: var(--atlas-font-family);
    position: relative;
  }
  :host([disabled]) {
    opacity: 0.6;
    pointer-events: none;
  }

  label.field-label {
    display: block;
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text);
    margin-bottom: var(--atlas-space-xs);
  }

  .trigger {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--atlas-space-xs);
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: border-color var(--atlas-transition-fast);
    box-sizing: border-box;
  }
  .trigger:hover { border-color: var(--atlas-color-border-strong); }
  .trigger:focus-visible,
  :host([open]) .trigger {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -1px;
    border-color: var(--atlas-color-primary);
  }
  .placeholder {
    color: var(--atlas-color-text-muted);
    font-size: max(16px, var(--atlas-font-size-md));
    padding: var(--atlas-space-xs) 0;
    flex: 1;
    min-width: 0;
  }
  .caret {
    margin-left: auto;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: var(--atlas-color-text-muted);
    transition: transform var(--atlas-transition-fast);
  }
  :host([open]) .caret { transform: rotate(180deg); }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--atlas-space-xs);
    padding: 2px var(--atlas-space-xs) 2px var(--atlas-space-sm);
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-primary);
    border: 1px solid var(--atlas-color-primary);
    border-radius: var(--atlas-radius-sm);
    font-size: var(--atlas-font-size-sm);
    line-height: var(--atlas-line-height-tight);
    max-width: 100%;
  }
  .chip-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip-remove {
    position: relative;
    width: 20px; height: 20px;
    border: none; background: transparent;
    color: var(--atlas-color-primary);
    cursor: pointer; padding: 0;
    border-radius: var(--atlas-radius-sm);
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 16px; line-height: 1;
    -webkit-tap-highlight-color: transparent;
  }
  .chip-remove::before { content: ''; position: absolute; inset: -12px; }
  .chip-remove:hover {
    background: var(--atlas-color-primary);
    color: var(--atlas-color-text-inverse);
  }
  .chip-remove:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }

  .listbox {
    position: absolute;
    top: 100%; left: 0; right: 0;
    margin-top: 2px;
    background: var(--atlas-color-bg);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    box-shadow: var(--atlas-shadow-lg);
    max-height: 280px;
    display: none;
    flex-direction: column;
    z-index: 10;
    overflow: hidden;
  }
  :host([open]) .listbox { display: flex; }

  /* ── Bottom-sheet mode (mobile only, chosen at open time) ──
     Presentation is toggled by data-presentation="sheet" on the host.
     In sheet mode: the listbox is pinned to the viewport bottom and slides
     up; a scrim dims the page behind it and is tappable to close. The
     sheet header (shown only in sheet mode) holds the field label and a
     close button so users have an explicit dismissal affordance.
     Above 640px, consumers never see this — the breakpoint check in JS
     keeps data-presentation="popover". */
  .scrim {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 999;
    animation: ms-scrim-in var(--atlas-transition-base) both;
  }
  .sheet-header {
    display: none;
    align-items: center;
    justify-content: space-between;
    gap: var(--atlas-space-sm);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border-bottom: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-bg);
    position: sticky;
    top: 0;
    z-index: 1;
  }
  .sheet-title {
    font-size: var(--atlas-font-size-md);
    font-weight: var(--atlas-font-weight-semibold);
    color: var(--atlas-color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sheet-close {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--atlas-color-text-muted);
    cursor: pointer;
    padding: 0;
    width: var(--atlas-touch-target-min, 44px);
    height: var(--atlas-touch-target-min, 44px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--atlas-radius-sm);
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
  }
  .sheet-close:hover { background: var(--atlas-color-surface-hover); color: var(--atlas-color-text); }
  .sheet-close:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -2px;
  }

  :host([data-presentation="sheet"][open]) .scrim { display: block; }
  :host([data-presentation="sheet"][open]) .sheet-header { display: flex; }
  :host([data-presentation="sheet"]) .listbox {
    position: fixed;
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    margin-top: 0;
    width: 100vw;
    max-height: 70vh;
    border-radius: var(--atlas-radius-lg) var(--atlas-radius-lg) 0 0;
    border: 1px solid var(--atlas-color-border);
    border-bottom: none;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.18);
    z-index: 1000;
    overscroll-behavior: contain;
    animation: ms-sheet-up var(--atlas-transition-base) both;
  }
  :host([data-presentation="sheet"]) .options {
    overscroll-behavior: contain;
  }
  :host([data-presentation="sheet"]) .search-wrap {
    position: sticky;
    top: var(--atlas-touch-target-min, 44px);
    background: var(--atlas-color-bg);
    z-index: 1;
  }
  @keyframes ms-sheet-up {
    from { transform: translateY(100%); }
    to   { transform: translateY(0); }
  }
  @keyframes ms-scrim-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .search-wrap {
    padding: var(--atlas-space-xs);
    border-bottom: 1px solid var(--atlas-color-border);
  }
  .search {
    width: 100%;
    min-height: 36px;
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
    font-size: max(16px, var(--atlas-font-size-sm));
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
    background: var(--atlas-color-bg);
    box-sizing: border-box;
  }
  .search:focus {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -1px;
    border-color: var(--atlas-color-primary);
  }

  .options {
    overflow-y: auto;
    padding: 2px;
    list-style: none;
    margin: 0;
    -webkit-overflow-scrolling: touch;
  }
  .option {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
    border-radius: var(--atlas-radius-sm);
    cursor: pointer;
    font-size: var(--atlas-font-size-md);
    color: var(--atlas-color-text);
    -webkit-tap-highlight-color: transparent;
  }
  .option[aria-selected="true"] {
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-primary);
    font-weight: var(--atlas-font-weight-medium);
  }
  .option[data-active="true"] {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -2px;
  }
  .option:hover { background: var(--atlas-color-surface); }
  .option[aria-disabled="true"] {
    color: var(--atlas-color-text-muted);
    cursor: not-allowed;
  }
  .check {
    width: 16px; height: 16px; flex-shrink: 0;
    color: var(--atlas-color-primary);
    visibility: hidden;
  }
  .option[aria-selected="true"] .check { visibility: visible; }
  .option-label {
    flex: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .status-row {
    padding: var(--atlas-space-md);
    color: var(--atlas-color-text-muted);
    font-size: var(--atlas-font-size-sm);
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--atlas-space-sm);
    min-height: 60px;
  }
  .status-row[data-kind="error"] { color: var(--atlas-color-danger); }
  .status-row[data-kind="loading"] {
    color: var(--atlas-color-text-muted);
  }
  .retry-btn {
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-xs) var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    cursor: pointer;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
  }
  .spinner {
    width: 14px; height: 14px;
    border: 2px solid var(--atlas-color-border);
    border-top-color: var(--atlas-color-primary);
    border-radius: 50%;
    animation: ms-spin 800ms linear infinite;
  }
  @keyframes ms-spin { to { transform: rotate(360deg); } }

  .create-hint {
    padding: var(--atlas-space-md);
    cursor: pointer;
    color: var(--atlas-color-primary);
    background: var(--atlas-color-primary-subtle);
    border-radius: var(--atlas-radius-sm);
    margin: 2px;
    min-height: var(--atlas-touch-target-min, 44px);
    display: flex; align-items: center; justify-content: center;
    font-size: var(--atlas-font-size-sm);
  }

  .error {
    margin-top: var(--atlas-space-xs);
    color: var(--atlas-color-danger);
    font-size: var(--atlas-font-size-sm);
  }

  @media (hover: none) {
    .trigger:hover, .option:hover {
      background: var(--atlas-color-bg);
      border-color: var(--atlas-color-border);
    }
  }
`);

/**
 * <atlas-multi-select> — adapter around MultiSelectCore.
 *
 * The component is pure DOM/IO: it renders state from the core, translates
 * user events into core actions, and exposes a Select2-style attribute +
 * property API. All selection/filter/lifecycle rules live in the core —
 * see multi-select-core.ts and its tests.
 *
 * ── Rendering strategy ───────────────────────────────────────────────
 * The shadow-DOM shell (trigger, search input, listbox container, error
 * row) is built ONCE in connectedCallback. Subsequent state changes
 * update specific regions surgically:
 *   - chips inside the trigger
 *   - option list inside the listbox
 *   - aria-expanded / aria-describedby on the trigger
 *   - search input value (only if it drifted from state.query)
 *
 * Full innerHTML replacement would destroy the focused search input
 * between keystrokes and detach an option between mousedown and click
 * (so clicks on options would never land). Event delegation on the
 * options list means we never need to rewire per-option handlers.
 *
 * See the core module for API docs and event contract.
 */
export class AtlasMultiSelect extends AtlasElement {
  static formAssociated = true;

  private _core: MultiSelectCore;
  private _unsub: () => void;
  private _onDocClick: (e: MouseEvent) => void;
  private _listboxId: string;
  private _errorId: string;
  private _shellBuilt = false;
  private _prevBodyOverflow: string | null = null;
  private readonly _internals: ElementInternals;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
    this._internals = this.attachInternals();
    this._core = new MultiSelectCore({});
    this._unsub = this._core.subscribe(() => this._syncHostAndUpdate());
    this._onDocClick = (e: MouseEvent) => this._handleDocClick(e);
    this._listboxId = uid('lb');
    this._errorId = uid('err');
  }

  static override get observedAttributes(): string[] {
    return [
      'options',
      'value',
      'label',
      'placeholder',
      'disabled',
      'error',
      'searchable',
      'allow-create',
      'close-on-select',
      'max',
      'required',
    ];
  }

  // ── Property API ─────────────────────────────────────────────

  get options(): Option[] {
    return this._core.getState().options;
  }
  set options(next: readonly unknown[]) {
    this._core.setOptions(next);
  }

  get value(): string[] {
    return this._core.getState().selected;
  }
  set value(next: unknown) {
    const arr = Array.isArray(next) ? next.map(String) : [];
    this._core.clear();
    for (const v of arr) this._core.select(v);
  }

  /** Selected option objects, alphabetical. */
  get selected(): Option[] {
    return this._core.selectedOptions();
  }

  /** Current lifecycle: idle / loading / ready / empty / error. */
  get status(): Status {
    return this._core.getState().status;
  }

  /**
   * OptionsSource port. Setting this triggers loadOptions() automatically.
   */
  get optionsSource(): OptionsSource | null {
    return this._core.getSource();
  }
  set optionsSource(src: OptionsSource | null | undefined) {
    this._core.setOptionsSource(src);
    if (src) void this._core.loadOptions();
  }

  /** Manually trigger a reload through the port (if configured). */
  reload(): Promise<Status> {
    return this._core.loadOptions(this._core.getState().query);
  }

  open(): void {
    this._core.openListbox();
  }
  close(): void {
    this._core.closeListbox();
  }
  toggle(): void {
    if (this._core.getState().open) this._core.closeListbox();
    else this._core.openListbox();
  }
  clear(): void {
    const delta = this._core.clear();
    if (delta.changed) this._emitChange(delta);
  }

  // ── Lifecycle ────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'group');
    this._core.max = normNum(this.getAttribute('max'));
    this._core.allowCreate = this.hasAttribute('allow-create');
    this._core.closeOnSelect = this.hasAttribute('close-on-select');
    this._core.disabled = this.hasAttribute('disabled');
    this._hydrateFromAttributes();
    this._buildShell();
    this._syncHostAndUpdate();
    this._commit();
  }

  override disconnectedCallback(): void {
    this._unsub();
    document.removeEventListener('mousedown', this._onDocClick, true);
    // If we were ripped out of the DOM while open in sheet mode, make sure
    // we don't leave the body permanently un-scrollable.
    if (this.getAttribute('data-presentation') === 'sheet') {
      this._unlockBodyScroll();
    }
    super.disconnectedCallback();
  }

  override attributeChangedCallback(
    name: string,
    oldVal: string | null,
    newVal: string | null,
  ): void {
    if (oldVal === newVal) return;
    switch (name) {
      case 'options':
        if (newVal) {
          try {
            this._core.setOptions(JSON.parse(newVal) as readonly unknown[]);
          } catch {
            /* ignore */
          }
        }
        break;
      case 'value':
        if (newVal !== null) {
          try {
            this.value = JSON.parse(newVal);
          } catch {
            this.value = String(newVal)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
          }
        }
        break;
      case 'max':
        this._core.max = normNum(newVal);
        break;
      case 'allow-create':
        this._core.allowCreate = newVal !== null;
        this._updateListbox();
        break;
      case 'close-on-select':
        this._core.closeOnSelect = newVal !== null;
        break;
      case 'disabled':
        this._core.disabled = newVal !== null;
        this._updateTrigger();
        break;
      case 'label':
      case 'placeholder':
      case 'searchable':
        // Structural change — rebuild the shell then resync everything.
        if (this._shellBuilt) this._rebuildShell();
        break;
      case 'error':
        this._updateError();
        this._updateTrigger();
        break;
      case 'required':
        this._commit();
        break;
    }
  }

  private _hydrateFromAttributes(): void {
    const optsAttr = this.getAttribute('options');
    if (optsAttr && this.options.length === 0) {
      try {
        this._core.setOptions(JSON.parse(optsAttr));
      } catch {
        /* ignore */
      }
    }
    const valAttr = this.getAttribute('value');
    if (valAttr && this.value.length === 0) {
      try {
        this.value = JSON.parse(valAttr);
      } catch {
        this.value = valAttr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
  }

  // ── State → DOM ──────────────────────────────────────────────

  private _syncHostAndUpdate(): void {
    const s = this._core.getState();
    this.setAttribute('data-state', s.status);
    this.setAttribute('data-value', JSON.stringify(s.selected));
    const wasOpen = this.hasAttribute('open');
    if (s.open) {
      this.setAttribute('open', '');
      document.addEventListener('mousedown', this._onDocClick, true);
      if (!wasOpen) this._onOpen();
    } else {
      this.removeAttribute('open');
      document.removeEventListener('mousedown', this._onDocClick, true);
      if (wasOpen) this._onClose();
    }
    if (!this._shellBuilt) return;
    this._updateTrigger();
    this._updateChips();
    this._updateSearchValue();
    this._updateListbox();
    this._updateError();
  }

  /**
   * Called once when the listbox transitions closed → open.
   * Picks presentation (sheet vs popover) based on viewport width at open
   * time, locks body scroll in sheet mode, and moves focus into the sheet.
   *
   * Trade-off: presentation is chosen ONCE at open time. If the user rotates
   * across the 640px breakpoint while open, we don't switch modes; the user
   * can close and reopen to re-pick. Live-switching is doable (listen to
   * MediaQueryList on this instance) but adds complexity for a corner case.
   */
  private _onOpen(): void {
    const isSheet = this._shouldUseSheet();
    this.setAttribute(
      'data-presentation',
      isSheet ? 'sheet' : 'popover',
    );
    if (isSheet) {
      this._lockBodyScroll();
      // A11y: the sheet is modal. Announce as dialog so AT treats it as one.
      const listbox = this.shadowRoot?.querySelector<HTMLElement>('.listbox');
      listbox?.setAttribute('role', 'dialog');
      listbox?.setAttribute('aria-modal', 'true');
      // Focus the search input if searchable, else the first option once
      // rendered. Defer so the listbox finishes populating first.
      queueMicrotask(() => this._focusSheetInitial());
    }
  }

  private _onClose(): void {
    const wasSheet = this.getAttribute('data-presentation') === 'sheet';
    if (wasSheet) this._unlockBodyScroll();
    this.removeAttribute('data-presentation');
    const listbox = this.shadowRoot?.querySelector<HTMLElement>('.listbox');
    listbox?.removeAttribute('role');
    listbox?.removeAttribute('aria-modal');
  }

  private _shouldUseSheet(): boolean {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia !== 'function') return false;
    // Sheet mode when narrower than the sm breakpoint.
    return !window.matchMedia('(min-width: 640px)').matches;
  }

  private _focusSheetInitial(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const search = root.querySelector<HTMLInputElement>('.search');
    if (search) {
      search.focus();
      return;
    }
    const firstOption = root.querySelector<HTMLElement>('.option');
    firstOption?.focus();
  }

  private _lockBodyScroll(): void {
    if (typeof document === 'undefined' || !document.body) return;
    if (this._prevBodyOverflow == null) {
      this._prevBodyOverflow = document.body.style.overflow;
    }
    document.body.style.overflow = 'hidden';
  }

  private _unlockBodyScroll(): void {
    if (typeof document === 'undefined' || !document.body) return;
    if (this._prevBodyOverflow != null) {
      document.body.style.overflow = this._prevBodyOverflow;
      this._prevBodyOverflow = null;
    } else {
      document.body.style.overflow = '';
    }
  }

  /** Focus trap for sheet mode: Tab / Shift+Tab cycle within the sheet. */
  private _onSheetKey(e: KeyboardEvent): void {
    if (this.getAttribute('data-presentation') !== 'sheet') return;
    if (e.key !== 'Tab') return;
    const root = this.shadowRoot;
    if (!root) return;
    const focusable = this._sheetFocusables();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    // Active element inside shadow DOM — linkedom may not implement
    // shadowRoot.activeElement, so fall back to document.activeElement.
    const active =
      (root as ShadowRoot).activeElement ?? document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first?.focus();
    }
  }

  private _sheetFocusables(): HTMLElement[] {
    const root = this.shadowRoot;
    if (!root) return [];
    const listbox = root.querySelector<HTMLElement>('.listbox');
    if (!listbox) return [];
    const nodes = listbox.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    return Array.from(nodes).filter((n) => !n.hasAttribute('disabled'));
  }

  /** Build the persistent shadow-DOM shell once. */
  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const label = this.getAttribute('label') ?? '';
    const placeholder = this.getAttribute('placeholder') ?? 'Select…';
    const searchable = this.hasAttribute('searchable');
    const triggerTestId = this._childTestId('trigger');
    const searchTestId = this._childTestId('search');

    const sheetLabel = label || placeholder;
    root.innerHTML = `
      ${label ? `<label class="field-label" id="${escapeAttr(this._listboxId)}-label">${escapeText(label)}</label>` : ''}
      <div class="trigger" role="combobox" tabindex="0"
           aria-haspopup="listbox" aria-expanded="false" aria-controls="${escapeAttr(this._listboxId)}"
           ${label ? `aria-labelledby="${escapeAttr(this._listboxId)}-label"` : ''}
           ${triggerTestId ? `data-testid="${escapeAttr(triggerTestId)}"` : ''}>
        <span class="chips"></span>
        <span class="placeholder">${escapeText(placeholder)}</span>
        <atlas-icon class="caret" name="chevron-down"></atlas-icon>
      </div>
      <div class="scrim" aria-hidden="true" data-action="scrim-close"></div>
      <div class="listbox" id="${escapeAttr(this._listboxId)}">
        <div class="sheet-header">
          <span class="sheet-title">${escapeText(sheetLabel)}</span>
          <button type="button" class="sheet-close" aria-label="Close" data-action="sheet-close">
            <atlas-icon name="x"></atlas-icon>
          </button>
        </div>
        ${
          searchable
            ? `
          <div class="search-wrap">
            <input type="text" class="search" placeholder="Filter…" aria-label="Filter options"
                   aria-autocomplete="list" aria-controls="${escapeAttr(this._listboxId)}-list"
                   ${searchTestId ? `data-testid="${escapeAttr(searchTestId)}"` : ''} />
          </div>`
            : ''
        }
        <ul class="options" id="${escapeAttr(this._listboxId)}-list" role="listbox"
            aria-multiselectable="true"
            ${label ? `aria-labelledby="${escapeAttr(this._listboxId)}-label"` : ''}></ul>
      </div>
      <div class="error" role="alert" id="${escapeAttr(this._errorId)}" hidden></div>
    `;

    // Persistent handlers — wired once, never rewired.
    const trigger = root.querySelector<HTMLElement>('.trigger');
    trigger?.addEventListener('click', (e: Event) => {
      const target = e.target as Element | null;
      if (target?.closest('.chip-remove')) return;
      this.toggle();
    });
    trigger?.addEventListener('keydown', (e) =>
      this._onTriggerKey(e as KeyboardEvent),
    );

    const search = root.querySelector<HTMLInputElement>('.search');
    if (search) {
      search.addEventListener('input', (e: Event) => {
        const t = e.target as HTMLInputElement;
        this._core.setQuery(t.value);
        this.dispatchEvent(
          new CustomEvent('search', {
            bubbles: true,
            composed: true,
            detail: { query: t.value },
          }),
        );
      });
      search.addEventListener('keydown', (e) =>
        this._onListKey(e as KeyboardEvent),
      );
    }

    const optionsEl = root.querySelector<HTMLElement>('.options');
    // Event delegation: one listener for all options/status rows. Means
    // re-rendering the list body never destroys handlers.
    //
    // NOTE: we intentionally DO NOT attach a mouseover → core.setActive
    // handler. Mouseover would cause a state notification mid-click —
    // the <li> gets replaced between mousedown and mouseup, and the
    // browser then refuses to synthesize `click`. CSS :hover already
    // handles mouse highlighting; `data-active` is keyboard-only.
    optionsEl?.addEventListener('click', (e) =>
      this._onOptionsClick(e as MouseEvent),
    );
    if (!search) {
      optionsEl?.addEventListener('keydown', (e) =>
        this._onListKey(e as KeyboardEvent),
      );
    }

    // Chip-remove handler also delegated onto the chips container.
    const chipsEl = root.querySelector<HTMLElement>('.chips');
    chipsEl?.addEventListener('click', (e) =>
      this._onChipsClick(e as MouseEvent),
    );

    // Scrim + sheet-close (bottom-sheet mode only; hidden in popover mode).
    const scrim = root.querySelector<HTMLElement>('.scrim');
    scrim?.addEventListener('click', () => this.close());
    const sheetClose = root.querySelector<HTMLElement>('.sheet-close');
    sheetClose?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });

    // Focus trap for sheet mode: Tab / Shift+Tab wrap within the listbox.
    const listbox = root.querySelector<HTMLElement>('.listbox');
    listbox?.addEventListener('keydown', (e) =>
      this._onSheetKey(e as KeyboardEvent),
    );

    this._shellBuilt = true;
  }

  /** Rebuild when a structural attr (label, searchable, placeholder) changes. */
  private _rebuildShell(): void {
    this._shellBuilt = false;
    this._buildShell();
    this._syncHostAndUpdate();
  }

  private _updateTrigger(): void {
    const trigger = this.shadowRoot?.querySelector<HTMLElement>('.trigger');
    if (!trigger) return;
    const s = this._core.getState();
    trigger.setAttribute('aria-expanded', String(s.open));
    trigger.tabIndex = this._core.disabled ? -1 : 0;
    const err = this.getAttribute('error') ?? '';
    if (err) {
      trigger.setAttribute('aria-describedby', this._errorId);
      trigger.setAttribute('aria-invalid', 'true');
    } else {
      trigger.removeAttribute('aria-describedby');
      trigger.removeAttribute('aria-invalid');
    }
  }

  private _updateChips(): void {
    const chipsEl = this.shadowRoot?.querySelector<HTMLElement>('.chips');
    const placeholderEl =
      this.shadowRoot?.querySelector<HTMLElement>('.placeholder');
    if (!chipsEl) return;
    const selected = this._core.selectedOptions();
    chipsEl.innerHTML = selected
      .map(
        (o) => `
      <span class="chip" data-value="${escapeAttr(o.value)}">
        <span class="chip-label">${escapeText(o.label)}</span>
        <button type="button" class="chip-remove" aria-label="${escapeAttr(`Remove ${o.label}`)}"
                data-action="remove" data-value="${escapeAttr(o.value)}">×</button>
      </span>
    `,
      )
      .join('');
    if (placeholderEl)
      placeholderEl.style.display = selected.length > 0 ? 'none' : '';
  }

  /** Only mutate the input value if it has drifted from state.query
   *  (e.g. after programmatic clear). Never touches it mid-typing. */
  private _updateSearchValue(): void {
    const search = this.shadowRoot?.querySelector<HTMLInputElement>('.search');
    if (!search) return;
    const q = this._core.getState().query;
    if (search.value !== q) search.value = q;
  }

  private _updateListbox(): void {
    const list = this.shadowRoot?.querySelector<HTMLElement>('.options');
    if (!list) return;
    const s = this._core.getState();
    list.setAttribute('aria-busy', String(s.status === LIFECYCLE.LOADING));

    if (s.status === LIFECYCLE.LOADING) {
      const tid = this._childTestId('loading');
      list.innerHTML = `<li class="status-row" role="presentation" data-kind="loading"
            ${tid ? `data-testid="${escapeAttr(tid)}"` : ''}>
          <span class="spinner" aria-hidden="true"></span><span>Loading…</span>
        </li>`;
      return;
    }
    if (s.status === LIFECYCLE.ERROR) {
      const retryTid = this._childTestId('retry');
      list.innerHTML = `<li class="status-row" role="alert" data-kind="error">
          <span>${escapeText(s.error || 'Failed to load')}</span>
          <button type="button" class="retry-btn" data-action="retry"
                  ${retryTid ? `data-testid="${escapeAttr(retryTid)}"` : ''}>Retry</button>
        </li>`;
      return;
    }

    const visible = this._core.visibleOptions();
    if (visible.length === 0 && !this._core.canCreate()) {
      const msg =
        s.status === LIFECYCLE.EMPTY ? 'No options available' : 'No matches';
      list.innerHTML = `<li class="status-row" role="presentation" data-kind="empty">${escapeText(msg)}</li>`;
      return;
    }

    let html = visible
      .map((o, i) => {
        const isSel = s.selected.includes(o.value);
        const isActive = i === s.activeIndex;
        return `<li class="option" role="option" id="${escapeAttr(this._listboxId)}-opt-${i}"
          data-value="${escapeAttr(o.value)}" data-index="${i}"
          aria-selected="${isSel}" aria-disabled="${o.disabled ? 'true' : 'false'}"
          ${isActive ? 'data-active="true"' : ''}>
        <atlas-icon class="check" name="check-path"></atlas-icon>
        <span class="option-label">${escapeText(o.label)}</span>
      </li>`;
      })
      .join('');

    if (this._core.canCreate()) {
      html += `<li class="create-hint" role="option" aria-selected="false"
                   data-action="create">+ Create "${escapeText(s.query.trim())}"</li>`;
    }
    list.innerHTML = html;
  }

  private _updateError(): void {
    const errEl = this.shadowRoot?.querySelector<HTMLElement>(
      `#${this._errorId}`,
    );
    if (!errEl) return;
    const external = this.getAttribute('error') ?? '';
    if (external) {
      errEl.textContent = external;
      errEl.hidden = false;
    } else {
      errEl.hidden = true;
      errEl.textContent = '';
    }
  }

  private _childTestId(suffix: string): string | null {
    const sid = this.surfaceId;
    const name = this.getAttribute('name');
    if (!sid || !name) return null;
    return `${sid}.${name}.${suffix}`;
  }

  // ── DOM → Core (delegated handlers) ──────────────────────────

  private _onOptionsClick(e: MouseEvent): void {
    const target = e.target as Element | null;
    if (!target) return;
    const retry = target.closest('[data-action="retry"]');
    if (retry) {
      void this.reload();
      return;
    }
    const createHint = target.closest('[data-action="create"]');
    if (createHint) {
      this._create();
      return;
    }
    const li = target.closest<HTMLElement>('.option');
    if (!li) return;
    if (li.getAttribute('aria-disabled') === 'true') return;
    const v = li.dataset['value'];
    if (v == null) return;
    const wasSelected = this._core.getState().selected.includes(v);
    const delta = this._core.toggle(v);
    if (delta.changed) {
      const option = this._opt(v);
      this.dispatchEvent(
        new CustomEvent(wasSelected ? 'unselect' : 'select', {
          bubbles: true,
          composed: true,
          detail: { option },
        }),
      );
      this._emitChange(delta);
    }
  }

  private _onChipsClick(e: MouseEvent): void {
    const target = e.target as Element | null;
    if (!target) return;
    const rm = target.closest<HTMLElement>('.chip-remove');
    if (!rm) return;
    e.stopPropagation();
    const v = rm.dataset['value'];
    if (v == null) return;
    const option = this._opt(v);
    const delta = this._core.unselect(v);
    if (delta.changed) {
      this.dispatchEvent(
        new CustomEvent('unselect', {
          bubbles: true,
          composed: true,
          detail: { option },
        }),
      );
      this._emitChange(delta);
    }
  }

  private _opt(value: string): Option | undefined {
    return this._core.getState().options.find((o) => o.value === value);
  }

  private _create(): void {
    const q = this._core.getState().query.trim();
    const delta = this._core.createFromQuery();
    if (delta.changed) {
      const option = this._opt(q);
      this.dispatchEvent(
        new CustomEvent('create', {
          bubbles: true,
          composed: true,
          detail: { option },
        }),
      );
      this.dispatchEvent(
        new CustomEvent('select', {
          bubbles: true,
          composed: true,
          detail: { option },
        }),
      );
      this._emitChange(delta);
    }
  }

  private _handleDocClick(e: MouseEvent): void {
    // composedPath is the reliable way to check containment across
    // shadow-DOM boundaries; e.target is retargeted to the host in
    // modern browsers, but composedPath is explicit and unambiguous.
    const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
    if (path && path.includes(this)) return;
    const target = e.target as Node | null;
    if (target && this.contains(target)) return;
    this.close();
  }

  private _onTriggerKey(e: KeyboardEvent): void {
    if (this._core.disabled) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!this._core.getState().open) this.open();
        break;
      case 'Escape':
        if (this._core.getState().open) {
          e.preventDefault();
          this.close();
        }
        break;
      case 'Backspace':
        if (this._core.getState().query === '') {
          const delta = this._core.unselectLast();
          if (delta.changed) this._emitChange(delta);
        }
        break;
    }
  }

  private _onListKey(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._core.moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._core.moveActive(-1);
        break;
      case 'Home':
        e.preventDefault();
        this._core.setActive(0);
        break;
      case 'End':
        e.preventDefault();
        this._core.setActive(Number.MAX_SAFE_INTEGER);
        break;
      case 'Enter': {
        e.preventDefault();
        const visible = this._core.visibleOptions();
        const idx = this._core.getState().activeIndex;
        const active = idx >= 0 ? visible[idx] : undefined;
        if (active) {
          const v = active.value;
          const wasSelected = this._core.getState().selected.includes(v);
          const delta = this._core.toggle(v);
          if (delta.changed) {
            const option = this._opt(v);
            this.dispatchEvent(
              new CustomEvent(wasSelected ? 'unselect' : 'select', {
                bubbles: true,
                composed: true,
                detail: { option },
              }),
            );
            this._emitChange(delta);
          }
        } else if (this._core.canCreate()) {
          this._create();
        }
        break;
      }
      case ' ': {
        const target = e.target as Element | null;
        if (target?.classList.contains('search')) return;
        e.preventDefault();
        const visible = this._core.visibleOptions();
        const idx = this._core.getState().activeIndex;
        const active = idx >= 0 ? visible[idx] : undefined;
        if (active) {
          const delta = this._core.toggle(active.value);
          if (delta.changed) this._emitChange(delta);
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        this.close();
        this.shadowRoot?.querySelector<HTMLElement>('.trigger')?.focus();
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  private _emitChange(
    delta: Delta,
    extra: Record<string, unknown> = {},
  ): void {
    this._commit();
    const name = this.getAttribute('name');
    if (this.surfaceId && name) {
      this.emit(`${this.surfaceId}.${name}-changed`, {
        added: delta.added,
        removed: delta.removed,
        value: this.value,
      });
    }
    this.dispatchEvent(
      new CustomEvent('change', {
        bubbles: true,
        composed: true,
        detail: {
          value: this.value,
          added: delta.added,
          removed: delta.removed,
          selected: this.selected,
          ...extra,
        },
      }),
    );
  }

  /**
   * Mirror current selection into ElementInternals and compute validity.
   * Multi-value convention: append one FormData entry per selected value
   * under the element's `name` — mirrors how a native <select multiple>
   * submits. When selection is empty, clear form value.
   */
  private _commit(): void {
    const values = this.value;
    const name = this.getAttribute('name');
    if (values.length === 0) {
      this._internals.setFormValue(null);
    } else if (name) {
      const fd = new FormData();
      for (const v of values) fd.append(name, v);
      this._internals.setFormValue(fd);
    } else {
      this._internals.setFormValue(values.join(','));
    }

    const required = this.hasAttribute('required');
    const max = this._core.max;
    if (required && values.length === 0) {
      this._internals.setValidity({ valueMissing: true }, 'Required');
    } else if (max != null && values.length > max) {
      this._internals.setValidity(
        { rangeOverflow: true },
        `At most ${max} selections`,
      );
    } else {
      this._internals.setValidity({});
    }
  }
}

function normNum(n: string | null | undefined): number | null {
  if (n == null) return null;
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? Math.floor(x) : null;
}

AtlasElement.define('atlas-multi-select', AtlasMultiSelect);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-multi-select': AtlasMultiSelect;
  }
}
