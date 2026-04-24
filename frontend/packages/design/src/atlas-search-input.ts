import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText, uid } from './util.ts';
import './atlas-icon.ts';

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
  .icon atlas-icon { width: 16px; height: 16px; }
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
  .clear atlas-icon { width: 14px; height: 14px; }
  :host([has-value]) .clear { display: inline-flex; }
  :host([disabled]) .group {
    background: var(--atlas-color-surface);
    cursor: not-allowed;
  }
  :host([disabled]) input {
    color: var(--atlas-color-text-muted);
    cursor: not-allowed;
  }
`);

export interface AtlasSearchInputChangeDetail {
  value: string;
}
export interface AtlasSearchInputInputDetail {
  value: string;
}
export interface AtlasSearchInputSearchDetail {
  value: string;
}

/**
 * `<atlas-search-input>` — text input pre-styled for searching.
 *
 * Render strategy: shadow-DOM shell is built ONCE in `connectedCallback`.
 * Structural attr that triggers full rebuild: `label` presence toggle. All
 * others (placeholder, value, disabled) are surgical.
 *
 * Events:
 *   input  → CustomEvent<AtlasSearchInputInputDetail>  — every keystroke
 *   change → CustomEvent<AtlasSearchInputChangeDetail> — on commit (blur)
 *   search → CustomEvent<AtlasSearchInputSearchDetail> — debounced (default 200ms)
 *
 * Form-associated: participates in `<form>` + `FormData` via ElementInternals.
 */
export class AtlasSearchInput extends AtlasElement {
  static formAssociated = true;

  static override get observedAttributes(): readonly string[] {
    return ['label', 'placeholder', 'value', 'disabled'];
  }

  declare disabled: boolean;

  static {
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
  }

  private readonly _inputId = uid('atlas-search');
  private readonly _internals: ElementInternals;
  private _built = false;
  private _pendingValue: string | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
    this._internals = this.attachInternals();
  }

  get value(): string {
    return this._input?.value ?? this._pendingValue ?? this.getAttribute('value') ?? '';
  }
  set value(v: string) {
    const str = v == null ? '' : String(v);
    this._pendingValue = str;
    this.setAttribute('value', str);
    const input = this._input;
    if (input && input.value !== str) input.value = str;
    this._toggleHasValue();
    this._internals.setFormValue(str);
  }

  private get _input(): HTMLInputElement | null {
    return this.shadowRoot?.querySelector<HTMLInputElement>('input') ?? null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncAll();
  }

  override disconnectedCallback(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    super.disconnectedCallback();
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

  clear(): void {
    const input = this._input;
    this.value = '';
    this._emitChange();
    this._scheduleSearch();
    input?.focus();
  }

  private _rebuildShell(): void {
    this._built = false;
    this._buildShell();
    this._syncAll();
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const label = this.getAttribute('label');

    root.innerHTML = `
      ${label ? `<label for="${escapeAttr(this._inputId)}">${escapeText(label)}</label>` : ''}
      <div class="group" role="search">
        <span class="icon" aria-hidden="true">
          <atlas-icon name="search"></atlas-icon>
        </span>
        <input
          id="${escapeAttr(this._inputId)}"
          type="search"
          inputmode="search"
          enterkeyhint="search"
          autocomplete="off"
          spellcheck="false"
        />
        <button type="button" class="clear" aria-label="Clear search" tabindex="-1">
          <atlas-icon name="x"></atlas-icon>
        </button>
      </div>
    `;

    const input = this._input;
    const clearBtn = root.querySelector<HTMLButtonElement>('.clear');
    if (!input) return;

    input.addEventListener('input', () => {
      this._pendingValue = input.value;
      this._toggleHasValue();
      this._internals.setFormValue(input.value);
      this.dispatchEvent(
        new CustomEvent<AtlasSearchInputInputDetail>('input', {
          detail: { value: input.value },
          bubbles: true,
          composed: true,
        }),
      );
      this._scheduleSearch();
    });

    input.addEventListener('change', () => {
      this._internals.setFormValue(input.value);
      this._emitChange();
    });

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && input.value !== '') {
        ev.preventDefault();
        this.clear();
      }
    });
    clearBtn?.addEventListener('click', () => this.clear());

    this._built = true;
  }

  private _syncAll(): void {
    this._sync('placeholder');
    this._sync('value');
    this._sync('disabled');
    this._toggleHasValue();
  }

  private _sync(name: string): void {
    const input = this._input;
    if (!input) return;
    switch (name) {
      case 'placeholder': {
        const p = this.getAttribute('placeholder') ?? 'Search…';
        input.setAttribute('placeholder', p);
        break;
      }
      case 'value': {
        const v = this.getAttribute('value') ?? '';
        if (input.value !== v) {
          input.value = v;
          this._pendingValue = v;
          this._internals.setFormValue(v);
          this._toggleHasValue();
        }
        break;
      }
      case 'disabled':
        input.disabled = this.hasAttribute('disabled');
        break;
    }
  }

  private _toggleHasValue(): void {
    const input = this._input;
    if (!input) return;
    if (input.value) this.setAttribute('has-value', '');
    else this.removeAttribute('has-value');
  }

  private _emitChange(): void {
    const input = this._input;
    if (!input) return;
    this.dispatchEvent(
      new CustomEvent<AtlasSearchInputChangeDetail>('change', {
        detail: { value: input.value },
        bubbles: true,
        composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-changed`, { value: input.value });
    }
  }

  private _scheduleSearch(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    const ms = Number(this.getAttribute('debounce') ?? '200') || 0;
    const fire = (): void => {
      const input = this._input;
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
