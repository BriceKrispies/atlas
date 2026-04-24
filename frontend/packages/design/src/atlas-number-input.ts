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
  .group {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    overflow: hidden;
    min-height: var(--atlas-touch-target-min, 44px);
  }
  .group:focus-within {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -1px;
    border-color: var(--atlas-color-primary);
  }
  input {
    flex: 1 1 auto;
    min-width: 0;
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: none;
    font-size: max(16px, var(--atlas-font-size-md));
    font-family: var(--atlas-font-family);
    line-height: var(--atlas-line-height);
    color: var(--atlas-color-text);
    background: transparent;
    text-align: right;
    outline: none;
    /* Hide native steppers; our buttons replace them. */
    -moz-appearance: textfield;
  }
  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  button {
    flex: 0 0 auto;
    width: 36px;
    border: none;
    background: var(--atlas-color-surface);
    color: var(--atlas-color-text);
    font-family: inherit;
    font-size: var(--atlas-font-size-md);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background var(--atlas-transition-fast);
  }
  button:first-of-type { border-right: 1px solid var(--atlas-color-border); }
  button:last-of-type  { border-left:  1px solid var(--atlas-color-border); }
  button:hover:not(:disabled)  { background: var(--atlas-color-surface-hover); }
  button:focus-visible          { outline: 2px solid var(--atlas-color-primary); outline-offset: -2px; }
  button:disabled              { color: var(--atlas-color-text-muted); cursor: not-allowed; }
  :host([disabled]) .group {
    background: var(--atlas-color-surface);
    color: var(--atlas-color-text-muted);
    cursor: not-allowed;
  }
  :host([disabled]) input {
    color: var(--atlas-color-text-muted);
    cursor: not-allowed;
  }
`);

export interface AtlasNumberInputChangeDetail {
  value: number | null;
}
export interface AtlasNumberInputInputDetail {
  value: number | null;
}

/**
 * `<atlas-number-input>` — numeric input with − / + steppers.
 *
 * Render strategy: shadow-DOM shell is built ONCE in `connectedCallback`.
 * Structural attr that triggers a full rebuild: `label` presence toggle.
 * All numeric attrs (min/max/step/value/disabled/required/placeholder) are
 * surgical. Stepper click handlers are delegated onto the `.group` container
 * so they survive any future surgical updates without rewiring.
 *
 * Events:
 *   input  → CustomEvent<AtlasNumberInputInputDetail>  — every keystroke / stepper press
 *   change → CustomEvent<AtlasNumberInputChangeDetail> — on commit (blur / stepper release)
 *
 * Form-associated: participates in `<form>` + `FormData` via ElementInternals.
 */
export class AtlasNumberInput extends AtlasElement {
  static formAssociated = true;

  static override get observedAttributes(): readonly string[] {
    return [
      'label',
      'placeholder',
      'value',
      'min',
      'max',
      'step',
      'disabled',
      'required',
    ];
  }

  declare disabled: boolean;
  declare required: boolean;

  static {
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'required', AtlasElement.boolAttr('required'));
  }

  private readonly _inputId = uid('atlas-num');
  private readonly _internals: ElementInternals;
  private _built = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
    this._internals = this.attachInternals();
  }

  get value(): number | null {
    const input = this._input;
    const raw = input?.value ?? this.getAttribute('value') ?? '';
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  set value(v: number | null) {
    const str = v == null ? '' : String(v);
    this.setAttribute('value', str);
    const input = this._input;
    if (input && input.value !== str) input.value = str;
    this._internals.setFormValue(str);
    this._updateValidity(str);
    this._updateStepperState();
  }

  get min(): number {
    const a = this.getAttribute('min');
    return a == null ? Number.NEGATIVE_INFINITY : Number(a);
  }
  get max(): number {
    const a = this.getAttribute('max');
    return a == null ? Number.POSITIVE_INFINITY : Number(a);
  }
  get step(): number {
    const a = this.getAttribute('step');
    const n = a == null ? 1 : Number(a);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  private get _input(): HTMLInputElement | null {
    return this.shadowRoot?.querySelector<HTMLInputElement>('input') ?? null;
  }

  private get _group(): HTMLElement | null {
    return this.shadowRoot?.querySelector<HTMLElement>('.group') ?? null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncAll();
  }

  override attributeChangedCallback(
    name: string,
    oldVal: string | null,
    newVal: string | null,
  ): void {
    if (!this._built) return;
    if (oldVal === newVal) return;
    if (name === 'label') {
      const wasPresent = oldVal !== null;
      const isPresent = newVal !== null;
      if (wasPresent !== isPresent) {
        this._rebuildShell();
        return;
      }
    }
    this._sync(name);
  }

  stepUp(): void {
    this._applyStep(+1);
  }
  stepDown(): void {
    this._applyStep(-1);
  }

  private _rebuildShell(): void {
    this._built = false;
    this._buildShell();
    this._syncAll();
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const label = this.getAttribute('label') ?? '';

    root.innerHTML = `
      ${label ? `<label for="${escapeAttr(this._inputId)}">${escapeText(label)}</label>` : ''}
      <div class="group">
        <button type="button" data-dir="down" aria-label="Decrease">−</button>
        <input
          id="${escapeAttr(this._inputId)}"
          type="number"
          inputmode="decimal"
          role="spinbutton"
        />
        <button type="button" data-dir="up" aria-label="Increase">+</button>
      </div>
    `;

    const input = this._input;
    const group = this._group;
    if (!input || !group) return;

    input.addEventListener('input', () => {
      // Keep the attribute in sync so ::get value stays accurate if input
      // is queried before the next sync. Use the attribute so observers
      // still see a consistent value; don't setAttribute to avoid observedAttr
      // roundtrip — setFormValue is enough.
      this._internals.setFormValue(input.value);
      this._updateValidity(input.value);
      this._updateStepperState();
      this.dispatchEvent(
        new CustomEvent<AtlasNumberInputInputDetail>('input', {
          detail: { value: this._coerce(input.value) },
          bubbles: true,
          composed: true,
        }),
      );
    });

    input.addEventListener('change', () => {
      // Commit — reflect to attribute so `value` attr observers get a
      // consistent external read.
      this.setAttribute('value', input.value);
      this._internals.setFormValue(input.value);
      this._updateValidity(input.value);
      this._emitChange();
    });

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        this.stepUp();
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        this.stepDown();
      }
    });

    // Event delegation on the .group container so the stepper wiring
    // survives any surgical update without needing rebind.
    group.addEventListener('click', (ev) => {
      const target = ev.target as Element | null;
      const btn = target?.closest<HTMLButtonElement>('button[data-dir]');
      if (!btn) return;
      if (btn.disabled) return;
      if (btn.dataset['dir'] === 'up') this.stepUp();
      else this.stepDown();
    });

    this._built = true;
  }

  private _syncAll(): void {
    this._sync('value');
    this._sync('placeholder');
    this._sync('min');
    this._sync('max');
    this._sync('step');
    this._sync('disabled');
    this._sync('required');
    this._updateStepperState();
  }

  private _sync(name: string): void {
    const input = this._input;
    if (!input) return;
    switch (name) {
      case 'value': {
        const v = this.getAttribute('value') ?? '';
        if (input.value !== v) {
          input.value = v;
          this._internals.setFormValue(v);
          this._updateValidity(v);
        }
        input.setAttribute('aria-valuenow', v);
        this._updateStepperState();
        break;
      }
      case 'placeholder': {
        const p = this.getAttribute('placeholder');
        if (p == null) input.removeAttribute('placeholder');
        else input.setAttribute('placeholder', p);
        break;
      }
      case 'min': {
        const v = this.getAttribute('min');
        if (v == null) input.removeAttribute('min');
        else input.setAttribute('min', v);
        this._updateStepperState();
        break;
      }
      case 'max': {
        const v = this.getAttribute('max');
        if (v == null) input.removeAttribute('max');
        else input.setAttribute('max', v);
        this._updateStepperState();
        break;
      }
      case 'step': {
        const v = this.getAttribute('step') ?? '1';
        input.setAttribute('step', v);
        break;
      }
      case 'disabled': {
        const d = this.hasAttribute('disabled');
        input.disabled = d;
        this._updateStepperState();
        break;
      }
      case 'required':
        input.required = this.hasAttribute('required');
        this._updateValidity(input.value);
        break;
    }
  }

  private _applyStep(dir: 1 | -1): void {
    if (this.disabled) return;
    const current = this.value ?? 0;
    const next = current + dir * this.step;
    const clamped = Math.max(this.min, Math.min(this.max, next));
    const rounded = this._roundToStep(clamped);
    this.value = rounded;
    const input = this._input;
    // stepper press → treat as input+change (keystroke+commit) for consistency
    // with native <input type="number"> +/- keyboard arrows.
    if (input) {
      this.dispatchEvent(
        new CustomEvent<AtlasNumberInputInputDetail>('input', {
          detail: { value: rounded },
          bubbles: true,
          composed: true,
        }),
      );
    }
    this._emitChange();
    this._updateStepperState();
  }

  private _roundToStep(n: number): number {
    // Avoid float artifacts like 0.1 + 0.2.
    const step = this.step;
    const decimals = (String(step).split('.')[1] ?? '').length;
    return Number(n.toFixed(decimals));
  }

  private _coerce(raw: string): number | null {
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  private _updateStepperState(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const v = this.value;
    const up = root.querySelector<HTMLButtonElement>('button[data-dir="up"]');
    const down = root.querySelector<HTMLButtonElement>('button[data-dir="down"]');
    if (up) up.disabled = this.disabled || (v != null && v >= this.max);
    if (down) down.disabled = this.disabled || (v != null && v <= this.min);
    const input = this._input;
    if (input && v != null) input.setAttribute('aria-valuenow', String(v));
  }

  private _emitChange(): void {
    this.dispatchEvent(
      new CustomEvent<AtlasNumberInputChangeDetail>('change', {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-changed`, { value: this.value });
    }
  }

  private _updateValidity(value: string): void {
    const anchor = this._input ?? undefined;
    if (this.hasAttribute('required') && value === '') {
      this._internals.setValidity(
        { valueMissing: true },
        'This field is required.',
        anchor,
      );
      return;
    }
    this._internals.setValidity({});
  }
}

AtlasElement.define('atlas-number-input', AtlasNumberInput);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-number-input': AtlasNumberInput;
  }
}
