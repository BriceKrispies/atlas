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
`;

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
 *   change → CustomEvent<AtlasDatePickerChangeDetail>
 */
export class AtlasDatePicker extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['label', 'value', 'min', 'max', 'disabled', 'required', 'placeholder'];
  }

  private _inputId = `atlas-date-${Math.random().toString(36).slice(2, 8)}`;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get value(): string {
    return this.shadowRoot?.querySelector<HTMLInputElement>('input')?.value
      ?? this.getAttribute('value') ?? '';
  }
  set value(v: string) {
    this.setAttribute('value', v);
    const input = this.shadowRoot?.querySelector<HTMLInputElement>('input');
    if (input) input.value = v;
  }

  get valueAsDate(): Date | null {
    const v = this.value;
    if (!v) return null;
    const d = new Date(`${v}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
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
    const valueAttr = this.getAttribute('value') ?? '';
    const min = this.getAttribute('min');
    const max = this.getAttribute('max');
    const disabled = this.disabled;
    const required = this.hasAttribute('required');

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      ${label ? `<label for="${this._inputId}">${label}</label>` : ''}
      <input
        id="${this._inputId}"
        type="date"
        value="${valueAttr}"
        ${min ? `min="${min}"` : ''}
        ${max ? `max="${max}"` : ''}
        ${disabled ? 'disabled' : ''}
        ${required ? 'required' : ''}
      />
    `;

    const input = this.shadowRoot.querySelector<HTMLInputElement>('input');
    input?.addEventListener('change', () => {
      this.setAttribute('value', input.value);
      this.dispatchEvent(
        new CustomEvent<AtlasDatePickerChangeDetail>('change', {
          detail: { value: input.value, valueAsDate: this.valueAsDate },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }
}

AtlasElement.define('atlas-date-picker', AtlasDatePicker);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-date-picker': AtlasDatePicker;
  }
}
