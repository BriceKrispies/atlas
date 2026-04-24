import { AtlasElement } from '@atlas/core';

const styles = `
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
`;

export interface AtlasNumberInputChangeDetail {
  value: number | null;
}

/**
 * `<atlas-number-input>` — numeric input with − / + steppers.
 *
 * When to use: bounded integer or decimal fields (quantities, limits).
 * When NOT to use: use `<atlas-slider>` when the user is picking a value
 * from a visible range; use `<atlas-input type="tel">` for phone numbers.
 *
 * Attributes:
 *   label, name, placeholder, disabled, required
 *   value — current value (string form; coerced to number for emits)
 *   min   — default -Infinity
 *   max   — default +Infinity
 *   step  — default 1
 *
 * Events:
 *   change → CustomEvent<AtlasNumberInputChangeDetail>
 */
export class AtlasNumberInput extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['label', 'placeholder', 'value', 'min', 'max', 'step', 'disabled', 'required'];
  }

  private _inputId = `atlas-num-${Math.random().toString(36).slice(2, 8)}`;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get value(): number | null {
    const v = this.shadowRoot?.querySelector<HTMLInputElement>('input')?.value
      ?? this.getAttribute('value') ?? '';
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  set value(v: number | null) {
    const str = v == null ? '' : String(v);
    this.setAttribute('value', str);
    const input = this.shadowRoot?.querySelector<HTMLInputElement>('input');
    if (input) input.value = str;
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

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }
  set disabled(v: boolean) {
    if (v) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._render();
  }

  override attributeChangedCallback(): void {
    this._render();
  }

  stepUp(): void {
    this._applyStep(+1);
  }
  stepDown(): void {
    this._applyStep(-1);
  }

  private _applyStep(dir: 1 | -1): void {
    if (this.disabled) return;
    const current = this.value ?? 0;
    const next = current + dir * this.step;
    const clamped = Math.max(this.min, Math.min(this.max, next));
    this.value = this._roundToStep(clamped);
    this._emit();
    this._updateStepperState();
  }

  private _roundToStep(n: number): number {
    // Avoid float artifacts like 0.1 + 0.2.
    const step = this.step;
    const decimals = (String(step).split('.')[1] ?? '').length;
    return Number(n.toFixed(decimals));
  }

  private _render(): void {
    if (!this.shadowRoot) return;
    const label = this.getAttribute('label') ?? '';
    const placeholder = this.getAttribute('placeholder') ?? '';
    const valueAttr = this.getAttribute('value') ?? '';
    const disabled = this.disabled;
    const required = this.hasAttribute('required');
    const min = this.getAttribute('min');
    const max = this.getAttribute('max');
    const step = this.getAttribute('step') ?? '1';

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      ${label ? `<label for="${this._inputId}">${label}</label>` : ''}
      <div class="group">
        <button type="button" data-dir="down" aria-label="Decrease" ${disabled ? 'disabled' : ''}>−</button>
        <input
          id="${this._inputId}"
          type="number"
          inputmode="decimal"
          role="spinbutton"
          value="${valueAttr}"
          placeholder="${placeholder}"
          step="${step}"
          ${min != null ? `min="${min}"` : ''}
          ${max != null ? `max="${max}"` : ''}
          ${disabled ? 'disabled' : ''}
          ${required ? 'required' : ''}
          aria-valuenow="${valueAttr}"
        />
        <button type="button" data-dir="up" aria-label="Increase" ${disabled ? 'disabled' : ''}>+</button>
      </div>
    `;

    const input = this.shadowRoot.querySelector<HTMLInputElement>('input');
    const btns = this.shadowRoot.querySelectorAll<HTMLButtonElement>('button');
    if (!input) return;

    input.addEventListener('input', () => {
      this.setAttribute('value', input.value);
      this._emit();
      this._updateStepperState();
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
    btns.forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset['dir'] === 'up') this.stepUp();
        else this.stepDown();
      });
    });

    this._updateStepperState();
  }

  private _updateStepperState(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const v = this.value;
    const up = root.querySelector<HTMLButtonElement>('button[data-dir="up"]');
    const down = root.querySelector<HTMLButtonElement>('button[data-dir="down"]');
    if (up) up.disabled = this.disabled || (v != null && v >= this.max);
    if (down) down.disabled = this.disabled || (v != null && v <= this.min);
    const input = root.querySelector<HTMLInputElement>('input');
    if (input && v != null) input.setAttribute('aria-valuenow', String(v));
  }

  private _emit(): void {
    this.dispatchEvent(
      new CustomEvent<AtlasNumberInputChangeDetail>('change', {
        detail: { value: this.value },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

AtlasElement.define('atlas-number-input', AtlasNumberInput);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-number-input': AtlasNumberInput;
  }
}
