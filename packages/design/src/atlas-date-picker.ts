import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText, uid } from './util.ts';

const sheet = createSheet(`
  :host {
    display: block;
    font-family: var(--atlas-font-family);
  }
  label {
    display: block;
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text);
    margin-bottom: var(--atlas-space-xs);
  }
  input {
    width: 100%;
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    font-size: max(16px, var(--atlas-font-size-md));
    font-family: inherit;
    line-height: var(--atlas-line-height);
    color: var(--atlas-color-text);
    background: var(--atlas-color-bg);
    box-sizing: border-box;
    transition: border-color var(--atlas-transition-fast);
  }
  input:focus {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -1px;
    border-color: var(--atlas-color-primary);
  }
  input:disabled {
    background: var(--atlas-color-surface);
    color: var(--atlas-color-text-muted);
    cursor: not-allowed;
  }
  :host([invalid]) input {
    border-color: var(--atlas-color-danger);
  }
`);

export interface AtlasDatePickerChangeDetail {
  value: string;
  valueAsDate: Date | null;
}

/**
 * `<atlas-date-picker>` — ISO-date input (YYYY-MM-DD).
 *
 * This primitive wraps the native `<input type="date">` for robust a11y
 * (OS-native calendar UI on mobile, proven keyboard handling). A custom
 * popover calendar may ship later as a distinct opt-in variant.
 *
 * When to use: single-date fields (due date, birthday, event date).
 * When NOT to use: multi-date ranges require a separate range primitive.
 *
 * Attributes:
 *   label, name, value, min, max, disabled, required, placeholder
 *
 * Events:
 *   change → CustomEvent<AtlasDatePickerChangeDetail> on commit
 *
 * Form-associated: submits its ISO-date string via ElementInternals.
 */
export class AtlasDatePicker extends AtlasElement {
  static formAssociated = true;

  static override get observedAttributes(): readonly string[] {
    return [
      'label',
      'value',
      'min',
      'max',
      'disabled',
      'required',
      'placeholder',
    ];
  }

  declare disabled: boolean;
  declare required: boolean;

  static {
    Object.defineProperty(
      this.prototype,
      'disabled',
      AtlasElement.boolAttr('disabled'),
    );
    Object.defineProperty(
      this.prototype,
      'required',
      AtlasElement.boolAttr('required'),
    );
  }

  private readonly _inputId = uid('atlas-date');
  private readonly _internals: ElementInternals;
  private _built = false;
  private _input: HTMLInputElement | null = null;
  private _label: HTMLLabelElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
    this._internals = this.attachInternals();
  }

  get value(): string {
    return (
      this._input?.value ?? this.getAttribute('value') ?? ''
    );
  }
  set value(v: string) {
    this.setAttribute('value', v);
    if (this._input) this._input.value = v;
    this._commit(v);
  }

  get valueAsDate(): Date | null {
    const v = this.value;
    if (!v) return null;
    const d = new Date(`${v}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncAll();
    this._commit(this._input?.value ?? this.getAttribute('value') ?? '');
  }

  override attributeChangedCallback(
    name: string,
    oldVal: string | null,
    newVal: string | null,
  ): void {
    if (!this._built) return;
    if (oldVal === newVal) return;
    this._sync(name);
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const label = this.getAttribute('label');
    const valueAttr = this.getAttribute('value') ?? '';
    const min = this.getAttribute('min');
    const max = this.getAttribute('max');
    const placeholder = this.getAttribute('placeholder');
    const disabled = this.disabled;
    const required = this.required;

    root.innerHTML = `
      ${
        label != null
          ? `<label for="${escapeAttr(this._inputId)}">${escapeText(label)}</label>`
          : ''
      }
      <input
        id="${escapeAttr(this._inputId)}"
        type="date"
        value="${escapeAttr(valueAttr)}"
        ${min != null ? `min="${escapeAttr(min)}"` : ''}
        ${max != null ? `max="${escapeAttr(max)}"` : ''}
        ${placeholder != null ? `placeholder="${escapeAttr(placeholder)}"` : ''}
        ${disabled ? 'disabled' : ''}
        ${required ? 'required' : ''}
      />
    `;

    this._label = root.querySelector<HTMLLabelElement>('label');
    this._input = root.querySelector<HTMLInputElement>('input');

    const input = this._input;
    input?.addEventListener('change', () => {
      this.setAttribute('value', input.value);
      this._commit(input.value);
      this.dispatchEvent(
        new CustomEvent<AtlasDatePickerChangeDetail>('change', {
          detail: { value: input.value, valueAsDate: this.valueAsDate },
          bubbles: true,
          composed: true,
        }),
      );
      const name = this.getAttribute('name');
      if (name && this.surfaceId) {
        this.emit(`${this.surfaceId}.${name}-changed`, {
          value: input.value,
        });
      }
    });

    this._built = true;
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('value');
    this._sync('min');
    this._sync('max');
    this._sync('disabled');
    this._sync('required');
    this._sync('placeholder');
  }

  private _sync(name: string): void {
    const input = this._input;
    const root = this.shadowRoot;
    if (!input || !root) return;
    switch (name) {
      case 'label': {
        const label = this.getAttribute('label');
        if (label != null) {
          if (!this._label) {
            const lbl = document.createElement('label');
            lbl.setAttribute('for', this._inputId);
            root.insertBefore(lbl, input);
            this._label = lbl;
          }
          this._label.textContent = label;
        } else if (this._label) {
          this._label.remove();
          this._label = null;
        }
        break;
      }
      case 'value': {
        const v = this.getAttribute('value') ?? '';
        if (input.value !== v) input.value = v;
        this._commit(v);
        break;
      }
      case 'min': {
        const v = this.getAttribute('min');
        if (v == null) input.removeAttribute('min');
        else input.min = v;
        this._commit(input.value);
        break;
      }
      case 'max': {
        const v = this.getAttribute('max');
        if (v == null) input.removeAttribute('max');
        else input.max = v;
        this._commit(input.value);
        break;
      }
      case 'disabled':
        input.disabled = this.disabled;
        break;
      case 'required':
        input.required = this.required;
        this._commit(input.value);
        break;
      case 'placeholder': {
        const v = this.getAttribute('placeholder');
        if (v == null) input.removeAttribute('placeholder');
        else input.placeholder = v;
        break;
      }
    }
  }

  private _commit(value: string): void {
    this._internals.setFormValue(value);
    if (this.required && !value) {
      this._internals.setValidity({ valueMissing: true }, 'Required');
      return;
    }
    if (!value) {
      this._internals.setValidity({});
      return;
    }
    const min = this.getAttribute('min');
    const max = this.getAttribute('max');
    if (min && value < min) {
      this._internals.setValidity(
        { rangeUnderflow: true },
        `Must be on or after ${min}`,
      );
      return;
    }
    if (max && value > max) {
      this._internals.setValidity(
        { rangeOverflow: true },
        `Must be on or before ${max}`,
      );
      return;
    }
    this._internals.setValidity({});
  }
}

AtlasElement.define('atlas-date-picker', AtlasDatePicker);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-date-picker': AtlasDatePicker;
  }
}
