import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, uid } from './util.ts';
import './atlas-icon.ts';

const sheet = createSheet(`
  :host {
    display: inline-flex;
    align-items: flex-start;
    gap: var(--atlas-space-sm);
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    /* Preserve 44x44 touch target even if label text is short. */
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
    border-radius: var(--atlas-radius-sm);
    background: var(--atlas-color-bg);
    transition: background var(--atlas-transition-fast),
                border-color var(--atlas-transition-fast);
  }
  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }
  input:focus-visible + .mark::before {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  .mark {
    position: absolute;
    inset: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  .mark::before {
    content: '';
    position: absolute;
    inset: -3px;
    border-radius: calc(var(--atlas-radius-sm) + 2px);
    pointer-events: none;
  }
  .mark atlas-icon {
    width: 14px;
    height: 14px;
    color: var(--atlas-color-text-inverse);
    opacity: 0;
    transform: scale(0.6);
    transition: opacity var(--atlas-transition-fast),
                transform var(--atlas-transition-fast);
  }
  :host([checked]) .control,
  :host([indeterminate]) .control {
    background: var(--atlas-color-primary);
    border-color: var(--atlas-color-primary);
  }
  :host([checked]) .mark atlas-icon,
  :host([indeterminate]) .mark atlas-icon {
    opacity: 1;
    transform: scale(1);
  }
  :host([indeterminate]) .mark .tick {
    display: none;
  }
  :host(:not([indeterminate])) .mark .dash {
    display: none;
  }
  :host([disabled]) .control {
    background: var(--atlas-color-surface);
    border-color: var(--atlas-color-border);
  }
  :host([disabled][checked]) .control,
  :host([disabled][indeterminate]) .control {
    background: var(--atlas-color-border-strong);
    border-color: var(--atlas-color-border-strong);
  }
  .label {
    font-size: var(--atlas-font-size-md);
    line-height: var(--atlas-line-height);
    user-select: none;
  }
`);

export interface AtlasCheckboxChangeDetail {
  checked: boolean;
  value: string;
}

/**
 * `<atlas-checkbox>` — binary or tri-state checkbox.
 *
 * When to use: for boolean opt-ins, multi-select lists, and any field where
 * the answer is yes/no or partial.
 * When NOT to use: use `<atlas-switch>` for instant-effect toggles (e.g.
 * "dark mode on"); use `<atlas-radio-group>` for mutually exclusive choices.
 *
 * Attributes:
 *   checked         - boolean
 *   indeterminate   - boolean (mutually exclusive w/ checked semantics)
 *   disabled        - boolean
 *   required        - boolean
 *   name            - form name / testid suffix
 *   value           - submitted value (default "on")
 *   label           - text label (text content also works via <slot>)
 *
 * Events:
 *   change -> CustomEvent<AtlasCheckboxChangeDetail>
 */
export class AtlasCheckbox extends AtlasElement {
  static formAssociated = true;

  static override get observedAttributes(): readonly string[] {
    return ['checked', 'disabled', 'indeterminate', 'label', 'required', 'value'];
  }

  declare checked: boolean;
  declare indeterminate: boolean;
  declare disabled: boolean;
  declare required: boolean;

  static {
    Object.defineProperty(this.prototype, 'checked', AtlasElement.boolAttr('checked'));
    Object.defineProperty(this.prototype, 'indeterminate', AtlasElement.boolAttr('indeterminate'));
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'required', AtlasElement.boolAttr('required'));
  }

  private readonly _inputId = uid('atlas-cb');
  private readonly _internals: ElementInternals;
  private _built = false;
  private _input: HTMLInputElement | null = null;
  private _labelEl: HTMLLabelElement | null = null;
  private _onInputChange = (): void => {
    if (!this._input) return;
    if (this.indeterminate) this.indeterminate = false;
    this.checked = this._input.checked;
    this._commit();
    this.dispatchEvent(
      new CustomEvent<AtlasCheckboxChangeDetail>('change', {
        detail: { checked: this.checked, value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-changed`, {
        checked: this.checked,
        value: this.value,
      });
    }
  };

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._internals = this.attachInternals();
  }

  get value(): string {
    return this.getAttribute('value') ?? 'on';
  }
  set value(v: string) {
    this.setAttribute('value', v);
  }

  override connectedCallback(): void {
    super.connectedCallback();
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
    adoptSheet(root, sheet);
    root.innerHTML = `
      <span class="control">
        <input id="${escapeAttr(this._inputId)}" type="checkbox" aria-describedby="" />
        <span class="mark" aria-hidden="true">
          <atlas-icon class="tick" name="check"></atlas-icon>
          <atlas-icon class="dash" name="dash"></atlas-icon>
        </span>
      </span>
      <label class="label" for="${escapeAttr(this._inputId)}"><span class="label-text"></span><slot></slot></label>
    `;
    this._input = root.querySelector<HTMLInputElement>('input');
    this._labelEl = root.querySelector<HTMLLabelElement>('label.label');
    this._input?.addEventListener('change', this._onInputChange);
    this._built = true;
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('checked');
    this._sync('disabled');
    this._sync('required');
    this._sync('indeterminate');
    this._commit();
  }

  private _sync(name: string): void {
    const input = this._input;
    if (!input) return;
    switch (name) {
      case 'checked':
        input.checked = this.checked;
        input.setAttribute('aria-checked', this.indeterminate ? 'mixed' : String(this.checked));
        this._commit();
        break;
      case 'indeterminate':
        input.indeterminate = this.indeterminate;
        input.setAttribute('aria-checked', this.indeterminate ? 'mixed' : String(this.checked));
        break;
      case 'disabled':
        input.disabled = this.disabled;
        break;
      case 'required':
        input.required = this.required;
        this._commit();
        break;
      case 'value':
        this._commit();
        break;
      case 'label': {
        const labelText = this._labelEl?.querySelector<HTMLElement>('.label-text');
        if (labelText) labelText.textContent = this.getAttribute('label') ?? '';
        break;
      }
    }
  }

  /** Update form value + validity. Safe to call repeatedly. */
  private _commit(): void {
    // Native checkbox behaviour: when checked, submit `value`; when not, submit null.
    const submitted = this.checked ? this.value : null;
    this._internals.setFormValue(submitted);
    if (this.required && !this.checked) {
      this._internals.setValidity(
        { valueMissing: true },
        'Required',
        this._input ?? undefined,
      );
    } else {
      this._internals.setValidity({});
    }
  }
}

AtlasElement.define('atlas-checkbox', AtlasCheckbox);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-checkbox': AtlasCheckbox;
  }
}
