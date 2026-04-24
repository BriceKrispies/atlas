import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText } from './util.ts';

/**
 * <atlas-segmented-control> — compact "pick-one-of-N" form control.
 *
 * Visually a segmented pill like `<atlas-tab-bar>`, but semantically
 * a form input (role=radiogroup). Use it as the iOS-style picker
 * inside forms, filter rows, or view-mode toggles — anywhere the
 * selection represents a *value* rather than a *navigation target*.
 *
 * Difference matrix:
 *   `<atlas-tab-bar>`           role=tablist, picks a navigation target
 *   `<atlas-tabs>`              role=tablist, picks a content-view tab
 *   `<atlas-segmented-control>` role=radiogroup, picks a form value
 *
 * API:
 *   .options = [{ value, label, disabled? }, ...]
 *   .value   = 'weekly'
 *   // events: 'change' → { detail: { value, previousValue } }
 *
 * Attributes:
 *   name       — required for auto-testid: each segment becomes
 *                `${surfaceId}.${name}.${value}`
 *   size       — sm (compact)
 *   stretch    — fill parent width
 *   disabled   — disables the whole control
 *   aria-label — accessible label for the radiogroup
 */

const sheet = createSheet(`
  :host {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-surface);
    border: 1px solid var(--atlas-color-border);
    max-width: 100%;
  }
  :host([stretch]) { display: flex; width: 100%; }
  :host([disabled]) { opacity: 0.5; pointer-events: none; }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: none;
    border-radius: calc(var(--atlas-radius-md) - 3px);
    background: transparent;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    line-height: 1;
    color: var(--atlas-color-text-muted);
    cursor: pointer;
    text-align: center;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
    transition: background var(--atlas-transition-fast),
                color var(--atlas-transition-fast);
  }
  :host([stretch]) button { flex: 1; }
  button:hover:not([disabled]) {
    background: var(--atlas-color-surface-hover);
    color: var(--atlas-color-text);
  }
  button[aria-checked="true"] {
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    box-shadow: var(--atlas-shadow-sm);
  }
  button[disabled] { cursor: not-allowed; opacity: 0.6; }
  button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  :host([size="sm"]) button {
    font-size: var(--atlas-font-size-xs);
    min-height: 28px;
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
  }
  @media (pointer: coarse) {
    :host([size="sm"]) button {
      min-height: var(--atlas-touch-target-min, 44px);
    }
  }
`);

export interface SegmentOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface RawSegmentInput {
  value: unknown;
  label?: unknown;
  disabled?: unknown;
}

export class AtlasSegmentedControl extends AtlasElement {
  declare size: string;
  declare stretch: boolean;
  declare disabled: boolean;

  static {
    Object.defineProperty(this.prototype, 'size', AtlasElement.strAttr('size', ''));
    Object.defineProperty(this.prototype, 'stretch', AtlasElement.boolAttr('stretch'));
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
  }

  private _options: SegmentOption[] = [];
  private _value: string | null = null;
  private _built = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get options(): SegmentOption[] {
    return this._options;
  }
  set options(next: readonly RawSegmentInput[] | null | undefined) {
    this._options = Array.isArray(next)
      ? next.map((o) => ({
          value: String(o.value),
          label: String(o.label ?? o.value),
          disabled: o.disabled === true,
        }))
      : [];
    if (this._value && !this._options.some((o) => o.value === this._value)) {
      this._value = null;
    }
    if (this._built) this._renderOptions();
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
    this.setAttribute('role', 'radiogroup');
    if (!this._built) {
      adoptSheet(this.shadowRoot as ShadowRoot, sheet);
      this._built = true;
    }
    this._renderOptions();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'name') this._renderOptions();
  }

  static override get observedAttributes(): readonly string[] {
    return ['name'];
  }

  private _testIdFor(value: string): string | null {
    const sid = this.surfaceId;
    const name = this.getAttribute('name');
    if (!sid || !name) return null;
    return `${sid}.${name}.${value}`;
  }

  private _renderOptions(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const selected = this._value;
    root.innerHTML = this._options
      .map((o) => {
        const isSel = o.value === selected;
        const testId = this._testIdFor(o.value);
        const testIdAttr = testId ? ` data-testid="${escapeAttr(testId)}"` : '';
        const disabled = o.disabled ? ' disabled' : '';
        return `<button type="button" role="radio" data-value="${escapeAttr(
          o.value,
        )}" aria-checked="${isSel ? 'true' : 'false'}" tabindex="${
          isSel ? '0' : '-1'
        }"${disabled}${testIdAttr}>${escapeText(o.label)}</button>`;
      })
      .join('');
    this._wire();
  }

  private _syncSelection(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const selected = this._value;
    const buttons = root.querySelectorAll<HTMLButtonElement>('button[role="radio"]');
    for (const btn of buttons) {
      const isSel = (btn.dataset['value'] ?? null) === selected;
      btn.setAttribute('aria-checked', isSel ? 'true' : 'false');
      btn.setAttribute('tabindex', isSel ? '0' : '-1');
    }
  }

  private _wire(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    );
    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        if (btn.hasAttribute('disabled')) return;
        this._select(btn.dataset['value'] ?? null);
      });
      btn.addEventListener('keydown', (ev) => this._onKey(ev, buttons));
    }
  }

  private _onKey(ev: KeyboardEvent, buttons: HTMLButtonElement[]): void {
    const current = ev.currentTarget as HTMLButtonElement | null;
    if (!current) return;
    const enabled = buttons.filter((b) => !b.hasAttribute('disabled'));
    const idx = enabled.indexOf(current);
    if (idx < 0) return;
    let next = -1;
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (idx + 1) % enabled.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (idx - 1 + enabled.length) % enabled.length;
        break;
      case 'Home': next = 0; break;
      case 'End':  next = enabled.length - 1; break;
      case 'Enter':
      case ' ':
        this._select(current.dataset['value'] ?? null);
        ev.preventDefault();
        return;
      default: return;
    }
    ev.preventDefault();
    const target = enabled[next];
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

AtlasElement.define('atlas-segmented-control', AtlasSegmentedControl);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-segmented-control': AtlasSegmentedControl;
  }
}
