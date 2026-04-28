import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText } from './util.ts';

/**
 * <atlas-tabs> — underline-style content tabs.
 *
 * Visually distinct from `<atlas-tab-bar>`:
 *   - `<atlas-tab-bar>` is a segmented pill picker (like a radio group).
 *     Use it for mutually exclusive choices in chrome.
 *   - `<atlas-tabs>`    is a content-switcher (tabbed views). Flat row
 *     with a primary underline under the selected tab. Use it when the
 *     tabs show the SAME object from different angles — e.g. a
 *     specimen's Preview / Props / Source / Notes.
 *
 * Declarative API + WAI-ARIA tablist pattern, identical to tab-bar.
 *
 *   .tabs = [{ value, label }, ...]
 *   .value = 'preview'
 *   // events: 'change' → { detail: { value, previousValue } }
 *
 * Attributes:
 *   name       — required for auto-testid: each inner tab becomes
 *                `${surfaceId}.${name}.${tabValue}`
 *   size       — sm (compact)
 *   stretch    — fill parent width (tabs share the row equally)
 *   align      — start (default) | center | end
 *   aria-label — accessible label for the tablist
 */

const sheet = createSheet(`
  :host {
    display: flex;
    align-items: flex-end;
    gap: var(--atlas-space-xs);
    border-bottom: 1px solid var(--atlas-color-border);
    max-width: 100%;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  :host::-webkit-scrollbar { display: none; }

  :host([align="center"]) { justify-content: center; }
  :host([align="end"])    { justify-content: flex-end; }
  :host([stretch])        { width: 100%; }

  button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: none;
    background: transparent;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    line-height: 1;
    color: var(--atlas-color-text-muted);
    cursor: pointer;
    scroll-snap-align: start;
    -webkit-tap-highlight-color: transparent;
    text-align: center;
    white-space: nowrap;
    transition: color var(--atlas-transition-fast);
    /* Lift the button up by 1px so its ::after indicator overlays the
       :host border-bottom instead of floating above it. */
    margin-bottom: -1px;
  }
  button::after {
    content: "";
    position: absolute;
    left: var(--atlas-space-sm);
    right: var(--atlas-space-sm);
    bottom: 0;
    height: 2px;
    background: transparent;
    border-radius: 2px 2px 0 0;
    transition: background var(--atlas-transition-fast);
  }
  button:hover { color: var(--atlas-color-text); }
  button[aria-selected="true"] {
    color: var(--atlas-color-primary);
  }
  button[aria-selected="true"]::after {
    background: var(--atlas-color-primary);
  }
  button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
    border-radius: var(--atlas-radius-sm);
  }
  @media (min-width: 640px) {
    :host {
      overflow-x: visible;
      scroll-snap-type: none;
    }
    :host([stretch]) button { flex: 1; }
  }
  :host([size="sm"]) button {
    font-size: var(--atlas-font-size-xs);
    min-height: 36px;
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
  }
  @media (pointer: coarse) {
    :host([size="sm"]) button {
      min-height: var(--atlas-touch-target-min, 44px);
    }
  }
  @media (hover: none) {
    button:hover { color: var(--atlas-color-text-muted); }
    button[aria-selected="true"]:hover { color: var(--atlas-color-primary); }
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

export class AtlasTabs extends AtlasElement {
  declare size: string;
  declare stretch: boolean;

  static {
    Object.defineProperty(this.prototype, 'size', AtlasElement.strAttr('size', ''));
    Object.defineProperty(this.prototype, 'stretch', AtlasElement.boolAttr('stretch'));
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
      adoptSheet(this.shadowRoot as ShadowRoot, sheet);
      this._built = true;
    }
    this._renderTabs();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
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

  private _renderTabs(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const selected = this._value;
    root.innerHTML = this._tabs
      .map((t) => {
        const isSel = t.value === selected;
        const testId = this._testIdFor(t.value);
        const testIdAttr = testId ? ` data-testid="${escapeAttr(testId)}"` : '';
        return `<button type="button" role="tab" data-value="${escapeAttr(
          t.value,
        )}" aria-selected="${isSel ? 'true' : 'false'}" tabindex="${
          isSel ? '0' : '-1'
        }"${testIdAttr}>${escapeText(t.label)}</button>`;
      })
      .join('');
    this._wire();
  }

  private _syncSelection(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const selected = this._value;
    const buttons = root.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
    for (const btn of buttons) {
      const isSel = (btn.dataset['value'] ?? null) === selected;
      btn.setAttribute('aria-selected', isSel ? 'true' : 'false');
      btn.setAttribute('tabindex', isSel ? '0' : '-1');
    }
  }

  private _wire(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[role="tab"]'));
    for (const btn of buttons) {
      btn.addEventListener('click', () => this._select(btn.dataset['value'] ?? null));
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
      case 'Home': next = 0; break;
      case 'End':  next = buttons.length - 1; break;
      case 'Enter':
      case ' ':
        this._select(current.dataset['value'] ?? null);
        ev.preventDefault();
        return;
      default: return;
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

AtlasElement.define('atlas-tabs', AtlasTabs);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-tabs': AtlasTabs;
  }
}
