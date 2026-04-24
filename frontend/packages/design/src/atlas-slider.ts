import { AtlasElement } from '@atlas/core';

const styles = `
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
`;

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
 *   format      — "percent" | "plain" (default plain)
 *
 * Events:
 *   change → CustomEvent<AtlasSliderChangeDetail>
 */
export class AtlasSlider extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['label', 'value', 'min', 'max', 'step', 'disabled', 'show-value', 'format'];
  }

  private _inputId = `atlas-sld-${Math.random().toString(36).slice(2, 8)}`;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get value(): number {
    const a = this.shadowRoot?.querySelector<HTMLInputElement>('input')?.value
      ?? this.getAttribute('value');
    const n = Number(a ?? 0);
    return Number.isFinite(n) ? n : 0;
  }
  set value(v: number) {
    this.setAttribute('value', String(v));
    const input = this.shadowRoot?.querySelector<HTMLInputElement>('input');
    if (input) input.value = String(v);
    this._updateValueDisplay();
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

  private _render(): void {
    if (!this.shadowRoot) return;
    const label = this.getAttribute('label');
    const valueAttr = this.getAttribute('value') ?? '0';
    const min = this.getAttribute('min') ?? '0';
    const max = this.getAttribute('max') ?? '100';
    const step = this.getAttribute('step') ?? '1';
    const disabled = this.disabled;
    const showValue = this.hasAttribute('show-value');

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      ${label || showValue ? `
        <div class="header">
          ${label ? `<label for="${this._inputId}">${label}</label>` : '<span></span>'}
          ${showValue ? `<span class="value" aria-live="polite"></span>` : ''}
        </div>
      ` : ''}
      <input
        id="${this._inputId}"
        type="range"
        value="${valueAttr}"
        min="${min}"
        max="${max}"
        step="${step}"
        ${disabled ? 'disabled' : ''}
      />
    `;

    const input = this.shadowRoot.querySelector<HTMLInputElement>('input');
    if (!input) return;
    input.addEventListener('input', () => {
      this.setAttribute('value', input.value);
      this._updateValueDisplay();
      this.dispatchEvent(
        new CustomEvent<AtlasSliderChangeDetail>('change', {
          detail: { value: Number(input.value) },
          bubbles: true,
          composed: true,
        }),
      );
    });
    this._updateValueDisplay();
  }

  private _updateValueDisplay(): void {
    const out = this.shadowRoot?.querySelector<HTMLElement>('.value');
    if (!out) return;
    const input = this.shadowRoot?.querySelector<HTMLInputElement>('input');
    const v = Number(input?.value ?? this.getAttribute('value') ?? 0);
    const fmt = this.getAttribute('format');
    out.textContent = fmt === 'percent' ? `${v}%` : String(v);
  }
}

AtlasElement.define('atlas-slider', AtlasSlider);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-slider': AtlasSlider;
  }
}
