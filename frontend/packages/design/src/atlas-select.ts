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
    position: relative;
  }
  select {
    width: 100%;
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) calc(var(--atlas-space-md) * 2 + 8px) var(--atlas-space-sm) var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    font-size: max(16px, var(--atlas-font-size-md));
    font-family: inherit;
    line-height: var(--atlas-line-height);
    color: var(--atlas-color-text);
    background: var(--atlas-color-bg);
    box-sizing: border-box;
    appearance: none;
    -webkit-appearance: none;
    -webkit-tap-highlight-color: transparent;
    cursor: pointer;
    transition: border-color var(--atlas-transition-fast);
  }
  select:focus {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -1px;
    border-color: var(--atlas-color-primary);
  }
  select:disabled {
    background: var(--atlas-color-surface);
    color: var(--atlas-color-text-muted);
    cursor: not-allowed;
  }
  .caret {
    position: absolute;
    right: var(--atlas-space-md);
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--atlas-color-text-muted);
  }
  .caret svg { width: 12px; height: 12px; display: block; }
  :host([invalid]) select {
    border-color: var(--atlas-color-danger);
  }
`;

export interface AtlasSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface AtlasSelectChangeDetail {
  value: string;
}

interface RawOption {
  value: unknown;
  label?: unknown;
  disabled?: unknown;
}

/**
 * `<atlas-select>` — single-choice dropdown (wraps native `<select>`).
 *
 * When to use: mutually exclusive choice from ~6+ options where a radio
 * group would be too tall.
 * When NOT to use: use `<atlas-radio-group>` for ≤ 5 options where all
 * should be visible; use `<atlas-multi-select>` for picking multiple values.
 *
 * Native `<select>` is chosen for accessibility: it opens a real OS-level
 * picker on mobile and has proven keyboard handling.
 *
 * API:
 *   .options = [{ value, label, disabled? }, ...]
 *   .value   = 'draft'
 *
 * Attributes:
 *   label, name, placeholder, disabled, required, invalid
 *
 * Events:
 *   change → CustomEvent<AtlasSelectChangeDetail>
 */
export class AtlasSelect extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['label', 'placeholder', 'disabled', 'required'];
  }

  private _inputId = `atlas-sel-${Math.random().toString(36).slice(2, 8)}`;
  private _options: AtlasSelectOption[] = [];
  private _pendingValue: string | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get options(): AtlasSelectOption[] {
    return this._options.slice();
  }
  set options(next: readonly RawOption[] | null | undefined) {
    this._options = Array.isArray(next)
      ? next.map((o) => {
          const opt: AtlasSelectOption = {
            value: String(o.value),
            label: String(o.label ?? o.value),
          };
          if (o.disabled === true) opt.disabled = true;
          return opt;
        })
      : [];
    this._render();
  }

  get value(): string {
    const sel = this.shadowRoot?.querySelector<HTMLSelectElement>('select');
    return sel?.value ?? this._pendingValue ?? '';
  }
  set value(v: string) {
    this._pendingValue = v;
    const sel = this.shadowRoot?.querySelector<HTMLSelectElement>('select');
    if (sel) sel.value = v;
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
    const placeholder = this.getAttribute('placeholder');
    const disabled = this.disabled;
    const required = this.hasAttribute('required');

    const optsHtml = this._options
      .map((o) => {
        const attrs = [
          `value="${escapeAttr(o.value)}"`,
          o.disabled ? 'disabled' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<option ${attrs}>${escapeText(o.label)}</option>`;
      })
      .join('');

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      ${label ? `<label for="${this._inputId}">${label}</label>` : ''}
      <div class="group">
        <select
          id="${this._inputId}"
          ${disabled ? 'disabled' : ''}
          ${required ? 'required' : ''}
        >
          ${placeholder != null ? `<option value="" disabled ${this._pendingValue ? '' : 'selected'}>${escapeText(placeholder)}</option>` : ''}
          ${optsHtml}
        </select>
        <span class="caret" aria-hidden="true">
          <svg viewBox="0 0 12 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1.5 6,6.5 11,1.5"/></svg>
        </span>
      </div>
    `;

    const sel = this.shadowRoot.querySelector<HTMLSelectElement>('select');
    if (!sel) return;
    if (this._pendingValue != null) sel.value = this._pendingValue;
    sel.addEventListener('change', () => {
      this._pendingValue = sel.value;
      this.dispatchEvent(
        new CustomEvent<AtlasSelectChangeDetail>('change', {
          detail: { value: sel.value },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

AtlasElement.define('atlas-select', AtlasSelect);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-select': AtlasSelect;
  }
}
