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
  textarea {
    width: 100%;
    min-height: calc(var(--atlas-touch-target-min, 44px) * 2);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    font-size: max(16px, var(--atlas-font-size-md));
    font-family: var(--atlas-font-family);
    line-height: var(--atlas-line-height);
    color: var(--atlas-color-text);
    background: var(--atlas-color-bg);
    box-sizing: border-box;
    resize: vertical;
    transition: border-color var(--atlas-transition-fast);
  }
  :host([autoresize]) textarea {
    resize: none;
    overflow: hidden;
  }
  textarea::placeholder {
    color: var(--atlas-color-text-muted);
  }
  textarea:focus {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -1px;
    border-color: var(--atlas-color-primary);
  }
  textarea:disabled {
    background: var(--atlas-color-surface);
    color: var(--atlas-color-text-muted);
    cursor: not-allowed;
  }
  .count {
    display: block;
    margin-top: var(--atlas-space-xs);
    font-size: var(--atlas-font-size-xs);
    color: var(--atlas-color-text-muted);
    text-align: right;
  }
  .count[data-over] {
    color: var(--atlas-color-danger);
  }
`;

export interface AtlasTextareaChangeDetail {
  value: string;
}

/**
 * `<atlas-textarea>` — multi-line text input.
 *
 * When to use: for prose fields where users will enter more than one line
 * (descriptions, comments, addresses).
 * When NOT to use: use `<atlas-input>` for single-line fields.
 *
 * Attributes:
 *   label, placeholder, name, required, disabled, readonly
 *   rows          — visible rows (default 4)
 *   maxlength     — when set, a live counter is rendered
 *   autoresize    — grow height with content (disables manual resize)
 *
 * Events:
 *   change → CustomEvent<AtlasTextareaChangeDetail>
 */
export class AtlasTextarea extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['label', 'placeholder', 'rows', 'disabled', 'readonly', 'maxlength', 'required'];
  }

  private _inputId = `atlas-ta-${Math.random().toString(36).slice(2, 8)}`;
  private _pendingValue: string | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get value(): string {
    return this.shadowRoot?.querySelector('textarea')?.value ?? this._pendingValue ?? '';
  }
  set value(v: string) {
    this._pendingValue = v;
    const ta = this.shadowRoot?.querySelector<HTMLTextAreaElement>('textarea');
    if (ta) {
      ta.value = v;
      this._updateCount();
      this._autoresize();
    }
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
    const label = this.getAttribute('label') ?? '';
    const placeholder = this.getAttribute('placeholder') ?? '';
    const rows = this.getAttribute('rows') ?? '4';
    const maxlength = this.getAttribute('maxlength');
    const disabled = this.hasAttribute('disabled');
    const readonly = this.hasAttribute('readonly');
    const required = this.hasAttribute('required');

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      ${label ? `<label for="${this._inputId}">${label}</label>` : ''}
      <textarea
        id="${this._inputId}"
        rows="${rows}"
        placeholder="${placeholder}"
        ${disabled ? 'disabled' : ''}
        ${readonly ? 'readonly' : ''}
        ${required ? 'required' : ''}
        ${maxlength ? `maxlength="${maxlength}"` : ''}
      ></textarea>
      ${maxlength ? `<span class="count" aria-live="polite"></span>` : ''}
    `;

    const ta = this.shadowRoot.querySelector<HTMLTextAreaElement>('textarea');
    if (!ta) return;
    if (this._pendingValue != null) ta.value = this._pendingValue;
    this._updateCount();
    this._autoresize();

    ta.addEventListener('input', () => {
      this._pendingValue = ta.value;
      this._updateCount();
      this._autoresize();
      this.dispatchEvent(
        new CustomEvent<AtlasTextareaChangeDetail>('change', {
          detail: { value: ta.value },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }

  private _updateCount(): void {
    const count = this.shadowRoot?.querySelector<HTMLElement>('.count');
    const ta = this.shadowRoot?.querySelector<HTMLTextAreaElement>('textarea');
    const maxAttr = this.getAttribute('maxlength');
    if (!count || !ta || !maxAttr) return;
    const max = Number(maxAttr);
    const len = ta.value.length;
    count.textContent = `${len} / ${max}`;
    if (len > max) count.setAttribute('data-over', '');
    else count.removeAttribute('data-over');
  }

  private _autoresize(): void {
    if (!this.hasAttribute('autoresize')) return;
    const ta = this.shadowRoot?.querySelector<HTMLTextAreaElement>('textarea');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }
}

AtlasElement.define('atlas-textarea', AtlasTextarea);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-textarea': AtlasTextarea;
  }
}
