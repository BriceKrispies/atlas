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
    display: flex;
    align-items: center;
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    min-height: var(--atlas-touch-target-min, 44px);
    transition: border-color var(--atlas-transition-fast);
  }
  .group:focus-within {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -1px;
    border-color: var(--atlas-color-primary);
  }
  .icon {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    color: var(--atlas-color-text-muted);
    pointer-events: none;
  }
  .icon svg { width: 16px; height: 16px; }
  input {
    flex: 1 1 auto;
    min-width: 0;
    padding: var(--atlas-space-sm) var(--atlas-space-xs) var(--atlas-space-sm) 0;
    border: none;
    background: transparent;
    font-size: max(16px, var(--atlas-font-size-md));
    font-family: inherit;
    line-height: var(--atlas-line-height);
    color: var(--atlas-color-text);
    outline: none;
  }
  input::placeholder { color: var(--atlas-color-text-muted); }
  input::-webkit-search-cancel-button { display: none; }
  .clear {
    flex: 0 0 auto;
    display: none;
    align-items: center;
    justify-content: center;
    width: var(--atlas-touch-target-min, 44px);
    height: var(--atlas-touch-target-min, 44px);
    border: none;
    background: transparent;
    color: var(--atlas-color-text-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .clear:hover { color: var(--atlas-color-text); }
  .clear:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -2px;
    border-radius: var(--atlas-radius-md);
  }
  .clear svg { width: 14px; height: 14px; }
  :host([has-value]) .clear { display: inline-flex; }
  :host([disabled]) .group {
    background: var(--atlas-color-surface);
    cursor: not-allowed;
  }
  :host([disabled]) input {
    color: var(--atlas-color-text-muted);
    cursor: not-allowed;
  }
`;

export interface AtlasSearchInputChangeDetail {
  value: string;
}
export interface AtlasSearchInputSearchDetail {
  value: string;
}

/**
 * `<atlas-search-input>` — text input pre-styled for searching.
 *
 * Emits `change` on every keystroke and `search` debounced (default 200ms)
 * for server-backed searches that shouldn't fire per-keypress.
 *
 * When to use: search fields above a list or table.
 * When NOT to use: use `<atlas-input type="text">` for generic text entry.
 *
 * Attributes:
 *   label, placeholder, name, disabled, value
 *   debounce — debounce ms for `search` event (default 200)
 *
 * Events:
 *   change → CustomEvent<AtlasSearchInputChangeDetail> (immediate)
 *   search → CustomEvent<AtlasSearchInputSearchDetail> (debounced)
 */
export class AtlasSearchInput extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['label', 'placeholder', 'value', 'disabled'];
  }

  private _inputId = `atlas-search-${Math.random().toString(36).slice(2, 8)}`;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

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
    this._toggleHasValue();
  }

  get disabled(): boolean {
    return this.hasAttribute('disabled');
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._render();
  }

  override disconnectedCallback(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    super.disconnectedCallback();
  }

  override attributeChangedCallback(): void {
    this._render();
  }

  clear(): void {
    this.value = '';
    this._emitChange();
    this._scheduleSearch();
    this.shadowRoot?.querySelector<HTMLInputElement>('input')?.focus();
  }

  private _render(): void {
    if (!this.shadowRoot) return;
    const label = this.getAttribute('label');
    const placeholder = this.getAttribute('placeholder') ?? 'Search…';
    const valueAttr = this.getAttribute('value') ?? '';
    const disabled = this.disabled;

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      ${label ? `<label for="${this._inputId}">${label}</label>` : ''}
      <div class="group" role="search">
        <span class="icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <circle cx="9" cy="9" r="6"/>
            <line x1="14" y1="14" x2="18" y2="18"/>
          </svg>
        </span>
        <input
          id="${this._inputId}"
          type="search"
          value="${valueAttr}"
          placeholder="${placeholder}"
          ${disabled ? 'disabled' : ''}
          autocomplete="off"
          spellcheck="false"
        />
        <button type="button" class="clear" aria-label="Clear search" tabindex="-1">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="5" y1="5" x2="15" y2="15"/>
            <line x1="15" y1="5" x2="5" y2="15"/>
          </svg>
        </button>
      </div>
    `;

    const input = this.shadowRoot.querySelector<HTMLInputElement>('input');
    const clearBtn = this.shadowRoot.querySelector<HTMLButtonElement>('.clear');
    if (!input) return;

    this._toggleHasValue();
    input.addEventListener('input', () => {
      this._toggleHasValue();
      this._emitChange();
      this._scheduleSearch();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && input.value !== '') {
        ev.preventDefault();
        this.clear();
      }
    });
    clearBtn?.addEventListener('click', () => this.clear());
  }

  private _toggleHasValue(): void {
    const input = this.shadowRoot?.querySelector<HTMLInputElement>('input');
    if (!input) return;
    if (input.value) this.setAttribute('has-value', '');
    else this.removeAttribute('has-value');
  }

  private _emitChange(): void {
    const input = this.shadowRoot?.querySelector<HTMLInputElement>('input');
    if (!input) return;
    this.dispatchEvent(
      new CustomEvent<AtlasSearchInputChangeDetail>('change', {
        detail: { value: input.value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _scheduleSearch(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    const ms = Number(this.getAttribute('debounce') ?? '200') || 0;
    const fire = (): void => {
      const input = this.shadowRoot?.querySelector<HTMLInputElement>('input');
      if (!input) return;
      this.dispatchEvent(
        new CustomEvent<AtlasSearchInputSearchDetail>('search', {
          detail: { value: input.value },
          bubbles: true,
          composed: true,
        }),
      );
    };
    if (ms <= 0) fire();
    else this._debounceTimer = setTimeout(fire, ms);
  }
}

AtlasElement.define('atlas-search-input', AtlasSearchInput);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-search-input': AtlasSearchInput;
  }
}
