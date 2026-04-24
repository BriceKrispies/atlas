import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, uid } from './util.ts';

const radioSheet = createSheet(`
  :host {
    display: inline-flex;
    align-items: flex-start;
    gap: var(--atlas-space-sm);
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    min-height: var(--atlas-touch-target-min, 44px);
  }
  :host([disabled]) {
    cursor: not-allowed;
    color: var(--atlas-color-text-muted);
  }
  .control {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 18px;
    height: 18px;
    margin-top: calc((var(--atlas-font-size-md) * var(--atlas-line-height) - 18px) / 2);
    border: 1px solid var(--atlas-color-border-strong);
    border-radius: 50%;
    background: var(--atlas-color-bg);
    transition: border-color var(--atlas-transition-fast);
  }
  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: inherit;
    border-radius: 50%;
  }
  :host(:focus-visible) {
    outline: none;
  }
  :host(:focus-visible) .dot::before {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  .dot {
    position: absolute;
    inset: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .dot::before {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: 50%;
  }
  .dot::after {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--atlas-color-primary);
    opacity: 0;
    transform: scale(0.5);
    transition: opacity var(--atlas-transition-fast),
                transform var(--atlas-transition-fast);
  }
  :host([checked]) .control {
    border-color: var(--atlas-color-primary);
  }
  :host([checked]) .dot::after {
    opacity: 1;
    transform: scale(1);
  }
  :host([disabled]) .control {
    background: var(--atlas-color-surface);
    border-color: var(--atlas-color-border);
  }
  :host([disabled][checked]) .dot::after {
    background: var(--atlas-color-border-strong);
  }
  .label {
    font-size: var(--atlas-font-size-md);
    line-height: var(--atlas-line-height);
    user-select: none;
  }
`);

const groupSheet = createSheet(`
  :host {
    display: flex;
    flex-direction: column;
    gap: var(--atlas-space-sm);
    font-family: var(--atlas-font-family);
  }
  :host([orientation="row"]) {
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--atlas-space-md);
  }
  .legend {
    display: block;
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text);
    margin-bottom: var(--atlas-space-xs);
  }
  .legend[hidden] { display: none; }
`);

/**
 * `<atlas-radio>` — single option inside an `<atlas-radio-group>`.
 *
 * Do not use standalone — selection state is owned by the parent group.
 *
 * Attributes:
 *   value     - required, must be unique within the group
 *   checked   - set by the group; do not toggle directly
 *   disabled  - boolean
 *   label     - option label (or use slotted text)
 */
export class AtlasRadio extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['checked', 'disabled', 'label'];
  }

  declare checked: boolean;
  declare disabled: boolean;

  static {
    Object.defineProperty(this.prototype, 'checked', AtlasElement.boolAttr('checked'));
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
  }

  private readonly _inputId = uid('atlas-radio');
  private _built = false;
  private _input: HTMLInputElement | null = null;
  private _labelEl: HTMLLabelElement | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get value(): string {
    return this.getAttribute('value') ?? '';
  }
  set value(v: string) {
    this.setAttribute('value', v);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'radio');
    if (!this._built) this._buildShell();
    this._syncAll();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    this._sync(name);
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    adoptSheet(root, radioSheet);
    root.innerHTML = `
      <span class="control">
        <input id="${escapeAttr(this._inputId)}" type="radio" tabindex="-1" />
        <span class="dot" aria-hidden="true"></span>
      </span>
      <label class="label" for="${escapeAttr(this._inputId)}"><span class="label-text"></span><slot></slot></label>
    `;
    this._input = root.querySelector<HTMLInputElement>('input');
    this._labelEl = root.querySelector<HTMLLabelElement>('label.label');
    this._built = true;
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('checked');
    this._sync('disabled');
  }

  private _sync(name: string): void {
    const input = this._input;
    if (!input) return;
    switch (name) {
      case 'checked':
        input.checked = this.checked;
        this.setAttribute('aria-checked', String(this.checked));
        break;
      case 'disabled':
        input.disabled = this.disabled;
        this.setAttribute('aria-disabled', String(this.disabled));
        break;
      case 'label': {
        const labelText = this._labelEl?.querySelector<HTMLElement>('.label-text');
        if (labelText) labelText.textContent = this.getAttribute('label') ?? '';
        break;
      }
    }
  }
}

AtlasElement.define('atlas-radio', AtlasRadio);

export interface AtlasRadioGroupChangeDetail {
  value: string;
  previousValue: string | null;
}

/**
 * `<atlas-radio-group>` — owns the selection for a set of `<atlas-radio>`
 * children. Implements the WAI-ARIA radiogroup pattern: arrow keys move
 * focus and selection across items; Home/End jump to the first/last.
 *
 * When to use: mutually exclusive choices with <= ~6 options.
 * When NOT to use: use `<atlas-select>` for longer lists; use `<atlas-switch>`
 * or `<atlas-checkbox>` for a single opt-in.
 *
 * Attributes:
 *   value        - currently selected radio value
 *   disabled     - disables the whole group
 *   required     - marks the group as required for form validity
 *   label        - legend text for the group
 *   orientation  - "column" (default) | "row"
 *
 * Events:
 *   change -> CustomEvent<AtlasRadioGroupChangeDetail>
 */
export class AtlasRadioGroup extends AtlasElement {
  static formAssociated = true;

  static override get observedAttributes(): readonly string[] {
    return ['value', 'disabled', 'label', 'required'];
  }

  declare disabled: boolean;
  declare required: boolean;

  static {
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'required', AtlasElement.boolAttr('required'));
  }

  private readonly _internals: ElementInternals;
  private _built = false;
  private _legendEl: HTMLElement | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._internals = this.attachInternals();
  }

  get value(): string | null {
    return this.getAttribute('value');
  }
  set value(v: string | null) {
    if (v == null) this.removeAttribute('value');
    else this.setAttribute('value', v);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'radiogroup');
    if (!this._built) this._buildShell();
    this.addEventListener('click', this._onClick);
    this.addEventListener('keydown', this._onKey);
    this._syncAll();
  }

  override disconnectedCallback(): void {
    this.removeEventListener('click', this._onClick);
    this.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    this._sync(name);
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    adoptSheet(root, groupSheet);
    root.innerHTML = `
      <span class="legend" hidden></span>
      <slot></slot>
    `;
    this._legendEl = root.querySelector<HTMLElement>('.legend');
    this._built = true;
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('disabled');
    this._sync('required');
    // Value sync updates children; defer one microtask so slotted radios exist.
    queueMicrotask(() => {
      this._syncChildren();
      this._commit();
    });
  }

  private _sync(name: string): void {
    switch (name) {
      case 'label': {
        if (!this._legendEl) return;
        const label = this.getAttribute('label');
        if (label != null && label !== '') {
          this._legendEl.textContent = label;
          this._legendEl.hidden = false;
        } else {
          this._legendEl.textContent = '';
          this._legendEl.hidden = true;
        }
        break;
      }
      case 'value':
      case 'disabled':
        this._syncChildren();
        this._commit();
        break;
      case 'required':
        this._commit();
        break;
    }
  }

  private _items(): AtlasRadio[] {
    return Array.from(this.querySelectorAll<AtlasRadio>('atlas-radio'));
  }

  private _syncChildren(): void {
    const items = this._items();
    const value = this.value;
    const disabled = this.disabled;
    let hasFocusable = false;
    for (const item of items) {
      const isChecked = value != null && item.value === value;
      if (item.checked !== isChecked) item.checked = isChecked;
      if (disabled) {
        if (!item.disabled) item.disabled = true;
      }
      const focusable = isChecked && !item.disabled;
      if (!hasFocusable && focusable) {
        item.setAttribute('tabindex', '0');
        hasFocusable = true;
      } else {
        item.setAttribute('tabindex', '-1');
      }
    }
    // If nothing selected yet, the first enabled item becomes the roving
    // tabstop so keyboard users can enter the group.
    if (!hasFocusable) {
      const first = items.find((i) => !i.disabled);
      if (first) first.setAttribute('tabindex', '0');
    }
  }

  private _commit(): void {
    const v = this.value;
    this._internals.setFormValue(v);
    if (this.required && (v == null || v === '')) {
      this._internals.setValidity({ valueMissing: true }, 'Required');
    } else {
      this._internals.setValidity({});
    }
  }

  private _onClick = (ev: Event): void => {
    if (this.disabled) return;
    const target = (ev.target as Element | null)?.closest('atlas-radio') as AtlasRadio | null;
    if (!target || target.disabled) return;
    this._select(target);
  };

  private _onKey = (ev: KeyboardEvent): void => {
    if (this.disabled) return;
    const items = this._items().filter((i) => !i.disabled);
    if (items.length === 0) return;
    const active = (ev.target as Element | null)?.closest('atlas-radio') as AtlasRadio | null;
    const idx = active ? items.indexOf(active) : -1;
    let nextIdx = -1;
    switch (ev.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIdx = idx < 0 ? 0 : (idx + 1) % items.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIdx = idx <= 0 ? items.length - 1 : idx - 1;
        break;
      case 'Home':
        nextIdx = 0;
        break;
      case 'End':
        nextIdx = items.length - 1;
        break;
      case ' ':
      case 'Enter':
        if (active) {
          ev.preventDefault();
          this._select(active);
        }
        return;
      default:
        return;
    }
    ev.preventDefault();
    const next = items[nextIdx];
    if (!next) return;
    next.focus();
    this._select(next);
  };

  private _select(item: AtlasRadio): void {
    const previousValue = this.value;
    if (previousValue === item.value) return;
    this.value = item.value;
    this._syncChildren();
    this._commit();
    this.dispatchEvent(
      new CustomEvent<AtlasRadioGroupChangeDetail>('change', {
        detail: { value: item.value, previousValue },
        bubbles: true,
        composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-changed`, {
        value: item.value,
        previousValue,
      });
    }
  }
}

AtlasElement.define('atlas-radio-group', AtlasRadioGroup);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-radio': AtlasRadio;
    'atlas-radio-group': AtlasRadioGroup;
  }
}
