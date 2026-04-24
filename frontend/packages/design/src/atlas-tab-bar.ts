import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText } from './util.ts';

const sheet = createSheet(`
  :host {
    /* Mobile-first: horizontal-scroll tab strip with snap points. On narrow
       viewports users swipe to reach tabs that don't fit; on wider viewports
       (and with [stretch]) tabs flex equally. */
    display: flex;
    gap: var(--atlas-space-xs);
    padding: 3px;
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-surface);
    border: 1px solid var(--atlas-color-border);
    max-width: 100%;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    /* Scroll-shadow edge fade (mobile only). Same trick as atlas-table:
       two local-attached gradients mask the start/end when we are scrolled
       to that end, and two scroll-attached gradients remain visible while
       there is still overflow on that side. Pure CSS, no JS. The mask uses
       the surface color so it blends with the strip background. */
    background:
      linear-gradient(to right, var(--atlas-color-surface), var(--atlas-color-surface)) left center / 20px 100% no-repeat local,
      linear-gradient(to left,  var(--atlas-color-surface), var(--atlas-color-surface)) right center / 20px 100% no-repeat local,
      linear-gradient(to right, rgba(0, 0, 0, 0.10), rgba(0, 0, 0, 0)) left center / 14px 100% no-repeat scroll,
      linear-gradient(to left,  rgba(0, 0, 0, 0.10), rgba(0, 0, 0, 0)) right center / 14px 100% no-repeat scroll,
      var(--atlas-color-surface);
  }
  :host::-webkit-scrollbar { display: none; }
  button {
    /* Flex so padding stays symmetric AND text centers on both axes —
       a bare <button> with padding + min-height sits text at the
       baseline, which reads as top-aligned when the strip is tall. */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    min-width: 0;
    /* 44×44 touch target. */
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: none;
    border-radius: calc(var(--atlas-radius-md) - 2px);
    background: transparent;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    line-height: 1;
    color: var(--atlas-color-text-muted);
    cursor: pointer;
    scroll-snap-align: start;
    -webkit-tap-highlight-color: transparent;
    transition: background var(--atlas-transition-fast),
                color var(--atlas-transition-fast);
    text-align: center;
    text-transform: capitalize;
    white-space: nowrap;
  }
  button:hover {
    background: var(--atlas-color-surface-hover);
    color: var(--atlas-color-text);
  }
  button[aria-selected="true"] {
    background: var(--atlas-color-primary);
    color: var(--atlas-color-text-inverse);
  }
  button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 1px;
  }
  /* Desktop: tabs flex equally, strip stops scrolling. Mirrors the JS
     BREAKPOINTS.sm value. The mobile scroll-shadow is irrelevant here
     (no overflow, no scroll) — restore the plain surface background so
     the multi-layer gradients don't render. */
  @media (min-width: 640px) {
    :host {
      overflow-x: visible;
      scroll-snap-type: none;
      background: var(--atlas-color-surface);
    }
    button { flex: 1; }
  }
  :host([size="sm"]) button {
    font-size: var(--atlas-font-size-xs);
    /* sm is a dense in-chrome control (tab strips, preview switchers) —
       drop the 44px touch target so the text doesn't float in a sea of
       padding. Media query below restores 44px on coarse pointers. */
    min-height: 32px;
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
  }
  @media (pointer: coarse) {
    :host([size="sm"]) button {
      min-height: var(--atlas-touch-target-min, 44px);
    }
  }
  :host([stretch]) {
    width: 100%;
  }
  @media (hover: none) {
    button:hover {
      background: transparent;
      color: var(--atlas-color-text-muted);
    }
    button[aria-selected="true"]:hover {
      background: var(--atlas-color-primary);
      color: var(--atlas-color-text-inverse);
    }
  }
`);

export interface TabDefinition {
  value: string;
  label: string;
}

interface RawTabInput {
  value: unknown;
  label?: unknown;
}

/**
 * <atlas-tab-bar> — segmented tab switcher.
 *
 * Declarative tab list + selected value. Emits a `change` event with
 * `detail.value` when the user picks a tab. Implements WAI-ARIA
 * tablist pattern (arrow keys, Home/End).
 *
 * API:
 *   .tabs = [{ value: 'edit', label: 'Edit' }, ...]
 *   .value = 'edit'
 *   // events: 'change' → { detail: { value, previousValue } }
 *
 * Render pipeline (shell-once):
 *   - `_buildShell()` runs once — adopts the stylesheet. No structural DOM in
 *     the shell beyond the shadow root itself; tab buttons are direct children
 *     of the shadow root so the `:host` flex layout styles apply to them.
 *   - `_renderTabs()` recreates the `<button>` list when `.tabs` changes.
 *   - `_syncSelection()` flips `aria-selected` + `tabindex` on existing buttons
 *     when `.value` changes — preserving focus and scroll position.
 *
 * Attributes:
 *   name      — required for auto-testid: each inner tab becomes
 *               `${surfaceId}.${name}.${tabValue}`
 *   size      — "sm" for compact sizing
 *   stretch   — fill parent width
 *   aria-label — accessible label for the tablist
 */
export class AtlasTabBar extends AtlasElement {
  declare size: string;
  declare stretch: boolean;

  static {
    Object.defineProperty(
      this.prototype,
      'size',
      AtlasElement.strAttr('size', ''),
    );
    Object.defineProperty(
      this.prototype,
      'stretch',
      AtlasElement.boolAttr('stretch'),
    );
  }

  private _tabs: TabDefinition[] = [];
  private _value: string | null = null;
  private _built = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get tabs(): TabDefinition[] {
    return this._tabs;
  }
  set tabs(next: readonly RawTabInput[] | null | undefined) {
    this._tabs = Array.isArray(next)
      ? next.map((t) => ({
          value: String(t.value),
          label: String(t.label ?? t.value),
        }))
      : [];
    if (this._value && !this._tabs.some((t) => t.value === this._value)) {
      this._value = null;
    }
    if (this._built) this._renderTabs();
  }

  get value(): string | null {
    return this._value;
  }
  set value(next: string | null | undefined) {
    const v = next == null ? null : String(next);
    if (v === this._value) return;
    this._value = v;
    if (this._built) this._syncSelection();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'tablist');
    if (!this._built) {
      this._buildShell();
      this._built = true;
    }
    this._renderTabs();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    // `name` changing alters the auto-testid of each button; safest is to
    // re-render the list so the attribute gets regenerated.
    if (name === 'name') this._renderTabs();
  }

  static override get observedAttributes(): readonly string[] {
    return ['name'];
  }

  private _testIdFor(value: string): string | null {
    const sid = this.surfaceId;
    const barName = this.getAttribute('name');
    if (!sid || !barName) return null;
    return `${sid}.${barName}.${value}`;
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    adoptSheet(root, sheet);
  }

  private _renderTabs(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const tabs = this._tabs;
    const selected = this._value;
    const html = tabs
      .map((t) => {
        const isSel = t.value === selected;
        const testId = this._testIdFor(t.value);
        const testIdAttr = testId
          ? ` data-testid="${escapeAttr(testId)}"`
          : '';
        return `<button type="button" role="tab" data-value="${escapeAttr(
          t.value,
        )}" aria-selected="${isSel ? 'true' : 'false'}" tabindex="${
          isSel ? '0' : '-1'
        }"${testIdAttr}>${escapeText(t.label)}</button>`;
      })
      .join('');
    root.innerHTML = html;
    this._wire();
  }

  private _syncSelection(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const selected = this._value;
    const buttons = root.querySelectorAll<HTMLButtonElement>(
      'button[role="tab"]',
    );
    for (const btn of buttons) {
      const isSel = (btn.dataset['value'] ?? null) === selected;
      btn.setAttribute('aria-selected', isSel ? 'true' : 'false');
      btn.setAttribute('tabindex', isSel ? '0' : '-1');
    }
  }

  private _wire(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button[role="tab"]'),
    );
    for (const btn of buttons) {
      btn.addEventListener('click', () =>
        this._select(btn.dataset['value'] ?? null),
      );
      btn.addEventListener('keydown', (ev) => this._onKey(ev, buttons));
    }
  }

  private _onKey(ev: KeyboardEvent, buttons: HTMLButtonElement[]): void {
    const current = ev.currentTarget as HTMLButtonElement | null;
    if (!current) return;
    const idx = buttons.indexOf(current);
    if (idx < 0) return;
    let next = -1;
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (idx + 1) % buttons.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (idx - 1 + buttons.length) % buttons.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = buttons.length - 1;
        break;
      case 'Enter':
      case ' ':
        this._select(current.dataset['value'] ?? null);
        ev.preventDefault();
        return;
      default:
        return;
    }
    ev.preventDefault();
    const target = buttons[next];
    if (!target) return;
    target.focus();
    this._select(target.dataset['value'] ?? null);
  }

  private _select(value: string | null): void {
    if (value == null || value === this._value) return;
    const previousValue = this._value;
    this._value = value;
    this._syncSelection();
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { value, previousValue },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

AtlasElement.define('atlas-tab-bar', AtlasTabBar);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-tab-bar': AtlasTabBar;
  }
}
