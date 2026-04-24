import { AtlasElement } from '@atlas/core';

const styles = `
  :host {
    display: inline-flex;
    align-items: flex-start;
    gap: var(--atlas-space-sm);
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    /* Preserve 44×44 touch target even if label text is short. */
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
  .mark svg {
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
  :host([checked]) .mark svg,
  :host([indeterminate]) .mark svg {
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
`;

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
 *   checked         — boolean
 *   indeterminate   — boolean (mutually exclusive w/ checked semantics)
 *   disabled        — boolean
 *   required        — boolean
 *   name            — form name / testid suffix
 *   value           — submitted value (default "on")
 *   label           — text label (text content also works via <slot>)
 *
 * Events:
 *   change → CustomEvent<AtlasCheckboxChangeDetail>
 */
export class AtlasCheckbox extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['checked', 'disabled', 'indeterminate', 'label', 'required'];
  }

  private _inputId = `atlas-cb-${Math.random().toString(36).slice(2, 8)}`;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get checked(): boolean {
    return this.hasAttribute('checked');
  }
  set checked(v: boolean) {
    this._setBoolAttr('checked', v);
  }

  get indeterminate(): boolean {
    return this.hasAttribute('indeterminate');
  }
  set indeterminate(v: boolean) {
    this._setBoolAttr('indeterminate', v);
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }
  set disabled(v: boolean) {
    this._setBoolAttr('disabled', v);
  }

  get required(): boolean {
    return this.hasAttribute('required');
  }
  set required(v: boolean) {
    this._setBoolAttr('required', v);
  }

  get value(): string {
    return this.getAttribute('value') ?? 'on';
  }
  set value(v: string) {
    this.setAttribute('value', v);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._render();
  }

  override attributeChangedCallback(): void {
    this._sync();
  }

  private _setBoolAttr(name: string, v: boolean): void {
    if (v) this.setAttribute(name, '');
    else this.removeAttribute(name);
  }

  private _render(): void {
    if (!this.shadowRoot) return;
    const label = this.getAttribute('label') ?? '';
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <span class="control">
        <input
          id="${this._inputId}"
          type="checkbox"
          ${this.checked ? 'checked' : ''}
          ${this.disabled ? 'disabled' : ''}
          ${this.required ? 'required' : ''}
          aria-describedby=""
        />
        <span class="mark" aria-hidden="true">
          <svg class="tick" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,8 7,12 13,4"/></svg>
          <svg class="dash" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="8" x2="13" y2="8"/></svg>
        </span>
      </span>
      <label class="label" for="${this._inputId}">${label}<slot></slot></label>
    `;
    this._sync();
    const input = this.shadowRoot.querySelector<HTMLInputElement>('input');
    if (!input) return;
    input.addEventListener('change', () => {
      if (this.indeterminate) this.indeterminate = false;
      this.checked = input.checked;
      this.dispatchEvent(
        new CustomEvent<AtlasCheckboxChangeDetail>('change', {
          detail: { checked: this.checked, value: this.value },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }

  private _sync(): void {
    const input = this.shadowRoot?.querySelector<HTMLInputElement>('input');
    if (!input) return;
    input.checked = this.checked;
    input.disabled = this.disabled;
    input.required = this.required;
    input.indeterminate = this.indeterminate;
    input.setAttribute('aria-checked', this.indeterminate ? 'mixed' : String(this.checked));
  }
}

AtlasElement.define('atlas-checkbox', AtlasCheckbox);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-checkbox': AtlasCheckbox;
  }
}
