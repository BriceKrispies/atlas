import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText, uid } from './util.ts';

const sheet = createSheet(`
  :host {
    display: block;
    font-family: var(--atlas-font-family);
  }
  .header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: var(--atlas-space-xs);
  }
  label {
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text);
  }
  .value {
    font-size: var(--atlas-font-size-sm);
    font-family: var(--atlas-font-mono);
    color: var(--atlas-color-text-muted);
    font-variant-numeric: tabular-nums;
  }
  input {
    display: block;
    width: 100%;
    margin: 0;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    /* Leave room for the 18px thumb so it doesn't clip. */
    padding: 16px 0;
    cursor: pointer;
    /* Give the host a reasonable touch surface. */
    min-height: var(--atlas-touch-target-min, 44px);
  }
  input:focus { outline: none; }
  input:disabled {
    cursor: not-allowed;
  }
  input::-webkit-slider-runnable-track {
    height: 4px;
    background: var(--atlas-color-border);
    border-radius: 2px;
  }
  input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    margin-top: -7px;
    border-radius: 50%;
    background: var(--atlas-color-primary);
    border: 2px solid var(--atlas-color-bg);
    box-shadow: var(--atlas-shadow-sm);
    cursor: pointer;
    transition: transform var(--atlas-transition-fast);
  }
  input::-moz-range-track {
    height: 4px;
    background: var(--atlas-color-border);
    border-radius: 2px;
  }
  input::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--atlas-color-primary);
    border: 2px solid var(--atlas-color-bg);
    cursor: pointer;
  }
  input:focus-visible::-webkit-slider-thumb,
  input:focus-visible::-moz-range-thumb {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  input:disabled::-webkit-slider-thumb,
  input:disabled::-moz-range-thumb {
    background: var(--atlas-color-border-strong);
  }
`);

export interface AtlasSliderChangeDetail {
  value: number;
}

/**
 * `<atlas-slider>` — horizontal range input.
 *
 * When to use: picking a numeric value from a continuous range where the
 * approximate position matters more than the exact number (volume, opacity).
 * When NOT to use: use `<atlas-number-input>` when precision matters; use
 * `<atlas-radio-group>` for a small set of discrete values.
 *
 * Attributes:
 *   label, name, value, min (default 0), max (default 100), step (default 1)
 *   show-value  — render the current value at the end of the header row
 *   disabled    — boolean
 *   required    — boolean (for form validation)
 *   format      — "percent" | "plain" (default plain)
 *
 * Events:
 *   input  → every drag tick (intermediate)
 *   change → CustomEvent<AtlasSliderChangeDetail> on commit (pointerup/keyup)
 *
 * Form-associated: submits its numeric value as a string via ElementInternals.
 */
export class AtlasSlider extends AtlasElement {
  static formAssociated = true;

  static override get observedAttributes(): readonly string[] {
    return [
      'label',
      'value',
      'min',
      'max',
      'step',
      'disabled',
      'show-value',
      'format',
      'required',
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

  private readonly _inputId = uid('atlas-sld');
  private readonly _internals: ElementInternals;
  private _built = false;
  private _input: HTMLInputElement | null = null;
  private _label: HTMLLabelElement | null = null;
  private _header: HTMLDivElement | null = null;
  private _valueOut: HTMLSpanElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
    this._internals = this.attachInternals();
  }

  get value(): number {
    const raw = this._input?.value ?? this.getAttribute('value');
    const n = Number(raw ?? 0);
    return Number.isFinite(n) ? n : 0;
  }
  set value(v: number) {
    const str = String(v);
    this.setAttribute('value', str);
    if (this._input) this._input.value = str;
    this._updateValueDisplay();
    this._commit(str);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncAll();
    // Seed form state on connect.
    this._commit(this._input?.value ?? this.getAttribute('value') ?? '0');
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
    const valueAttr = this.getAttribute('value') ?? '0';
    const min = this.getAttribute('min') ?? '0';
    const max = this.getAttribute('max') ?? '100';
    const step = this.getAttribute('step') ?? '1';
    const disabled = this.disabled;
    const showValue = this.hasAttribute('show-value');
    const required = this.required;

    root.innerHTML = `
      ${
        label != null || showValue
          ? `<div class="header">
              ${
                label != null
                  ? `<label for="${escapeAttr(this._inputId)}">${escapeText(label)}</label>`
                  : '<span></span>'
              }
              ${showValue ? `<span class="value" aria-live="polite"></span>` : ''}
            </div>`
          : ''
      }
      <input
        id="${escapeAttr(this._inputId)}"
        type="range"
        value="${escapeAttr(valueAttr)}"
        min="${escapeAttr(min)}"
        max="${escapeAttr(max)}"
        step="${escapeAttr(step)}"
        ${disabled ? 'disabled' : ''}
        ${required ? 'required' : ''}
      />
    `;

    this._header = root.querySelector<HTMLDivElement>('.header');
    this._label = root.querySelector<HTMLLabelElement>('label');
    this._valueOut = root.querySelector<HTMLSpanElement>('.value');
    this._input = root.querySelector<HTMLInputElement>('input');

    const input = this._input;
    if (input) {
      // `input` fires on every drag tick — intermediate value.
      input.addEventListener('input', () => {
        this.setAttribute('value', input.value);
        this._updateValueDisplay();
        this.dispatchEvent(
          new CustomEvent<AtlasSliderChangeDetail>('input', {
            detail: { value: Number(input.value) },
            bubbles: true,
            composed: true,
          }),
        );
      });
      // `change` fires on commit — pointerup / keyup / blur per spec.
      input.addEventListener('change', () => {
        this.setAttribute('value', input.value);
        this._updateValueDisplay();
        this._commit(input.value);
        this.dispatchEvent(
          new CustomEvent<AtlasSliderChangeDetail>('change', {
            detail: { value: Number(input.value) },
            bubbles: true,
            composed: true,
          }),
        );
        const name = this.getAttribute('name');
        if (name && this.surfaceId) {
          this.emit(`${this.surfaceId}.${name}-changed`, {
            value: Number(input.value),
          });
        }
      });
    }

    this._built = true;
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('show-value');
    this._sync('value');
    this._sync('min');
    this._sync('max');
    this._sync('step');
    this._sync('disabled');
    this._sync('required');
    this._sync('format');
  }

  private _sync(name: string): void {
    const input = this._input;
    if (!input) return;
    switch (name) {
      case 'value': {
        const v = this.getAttribute('value') ?? '0';
        if (input.value !== v) input.value = v;
        this._updateValueDisplay();
        break;
      }
      case 'min': {
        const v = this.getAttribute('min') ?? '0';
        if (input.min !== v) input.min = v;
        break;
      }
      case 'max': {
        const v = this.getAttribute('max') ?? '100';
        if (input.max !== v) input.max = v;
        break;
      }
      case 'step': {
        const v = this.getAttribute('step') ?? '1';
        if (input.step !== v) input.step = v;
        break;
      }
      case 'disabled':
        input.disabled = this.disabled;
        break;
      case 'required':
        input.required = this.required;
        this._commit(input.value);
        break;
      case 'label':
      case 'show-value':
        this._updateHeader();
        break;
      case 'format':
        this._updateValueDisplay();
        break;
    }
  }

  /** Update label text and value-output visibility without rebuilding shell. */
  private _updateHeader(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const label = this.getAttribute('label');
    const showValue = this.hasAttribute('show-value');
    const needHeader = label != null || showValue;

    if (!needHeader) {
      if (this._header) {
        this._header.remove();
        this._header = null;
        this._label = null;
        this._valueOut = null;
      }
      return;
    }

    if (!this._header) {
      const header = document.createElement('div');
      header.className = 'header';
      root.insertBefore(header, this._input);
      this._header = header;
    }

    // Label
    if (label != null) {
      if (!this._label || this._label.tagName !== 'LABEL') {
        this._header.textContent = '';
        const lbl = document.createElement('label');
        lbl.setAttribute('for', this._inputId);
        this._header.appendChild(lbl);
        this._label = lbl;
      }
      this._label.textContent = label;
    } else if (this._label) {
      this._label.remove();
      this._label = null;
      // Put in a placeholder span so the value output stays right-aligned.
      if (!this._header.querySelector('span.spacer')) {
        const spacer = document.createElement('span');
        spacer.className = 'spacer';
        this._header.insertBefore(spacer, this._header.firstChild);
      }
    }

    // Value output
    if (showValue) {
      if (!this._valueOut) {
        const out = document.createElement('span');
        out.className = 'value';
        out.setAttribute('aria-live', 'polite');
        this._header.appendChild(out);
        this._valueOut = out;
      }
      this._updateValueDisplay();
    } else if (this._valueOut) {
      this._valueOut.remove();
      this._valueOut = null;
    }
  }

  private _updateValueDisplay(): void {
    const out = this._valueOut;
    if (!out) return;
    const v = Number(
      this._input?.value ?? this.getAttribute('value') ?? 0,
    );
    const fmt = this.getAttribute('format');
    out.textContent = fmt === 'percent' ? `${v}%` : String(v);
  }

  private _commit(value: string): void {
    this._internals.setFormValue(value);
    const n = Number(value);
    const min = Number(this.getAttribute('min') ?? '0');
    const max = Number(this.getAttribute('max') ?? '100');
    if (this.required && (value === '' || !Number.isFinite(n))) {
      this._internals.setValidity({ valueMissing: true }, 'Required');
    } else if (Number.isFinite(n) && Number.isFinite(min) && n < min) {
      this._internals.setValidity(
        { rangeUnderflow: true },
        `Must be ≥ ${min}`,
      );
    } else if (Number.isFinite(n) && Number.isFinite(max) && n > max) {
      this._internals.setValidity(
        { rangeOverflow: true },
        `Must be ≤ ${max}`,
      );
    } else {
      this._internals.setValidity({});
    }
  }
}

AtlasElement.define('atlas-slider', AtlasSlider);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-slider': AtlasSlider;
  }
}
