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
`);

export interface AtlasTextareaChangeDetail {
  value: string;
}
export interface AtlasTextareaInputDetail {
  value: string;
}

/**
 * `<atlas-textarea>` — multi-line text input.
 *
 * Render strategy: shadow-DOM shell is built ONCE in `connectedCallback`.
 * Structural attrs that trigger a full rebuild: `label` presence toggle and
 * `maxlength` presence toggle (adds/removes the `.count` element). All others
 * are surgical. Autoresize + character-count update on every `input` without
 * re-rendering.
 *
 * Events:
 *   input  → CustomEvent<AtlasTextareaInputDetail>  — every keystroke
 *   change → CustomEvent<AtlasTextareaChangeDetail> — on commit (blur)
 *
 * Form-associated: participates in `<form>` + `FormData` via ElementInternals.
 */
export class AtlasTextarea extends AtlasElement {
  static formAssociated = true;

  static override get observedAttributes(): readonly string[] {
    return [
      'label',
      'placeholder',
      'rows',
      'value',
      'disabled',
      'readonly',
      'maxlength',
      'required',
    ];
  }

  declare disabled: boolean;
  declare required: boolean;
  declare readOnly: boolean;

  static {
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'required', AtlasElement.boolAttr('required'));
    Object.defineProperty(this.prototype, 'readOnly', AtlasElement.boolAttr('readonly'));
  }

  private readonly _inputId = uid('atlas-ta');
  private readonly _internals: ElementInternals;
  private _built = false;
  private _pendingValue: string | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
    this._internals = this.attachInternals();
  }

  get value(): string {
    return this._textarea?.value ?? this._pendingValue ?? '';
  }
  set value(v: string) {
    const str = v == null ? '' : String(v);
    this._pendingValue = str;
    const ta = this._textarea;
    if (ta && ta.value !== str) {
      ta.value = str;
      this._updateCount();
      this._autoresize();
    }
    this._internals.setFormValue(str);
    this._updateValidity(str);
  }

  private get _textarea(): HTMLTextAreaElement | null {
    return this.shadowRoot?.querySelector<HTMLTextAreaElement>('textarea') ?? null;
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
    // Presence toggles for label / maxlength add or remove elements; rebuild.
    if (name === 'label' || name === 'maxlength') {
      const wasPresent = oldVal !== null;
      const isPresent = newVal !== null;
      if (wasPresent !== isPresent) {
        this._rebuildShell();
        return;
      }
    }
    this._sync(name);
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
    const maxlength = this.getAttribute('maxlength');

    root.innerHTML = `
      ${label ? `<label for="${escapeAttr(this._inputId)}">${escapeText(label)}</label>` : ''}
      <textarea id="${escapeAttr(this._inputId)}"></textarea>
      ${maxlength != null ? `<span class="count" aria-live="polite"></span>` : ''}
    `;

    const ta = this._textarea;
    if (!ta) return;

    if (this._pendingValue != null) ta.value = this._pendingValue;

    ta.addEventListener('input', () => {
      this._pendingValue = ta.value;
      this._updateCount();
      this._autoresize();
      this._internals.setFormValue(ta.value);
      this._updateValidity(ta.value);
      this.dispatchEvent(
        new CustomEvent<AtlasTextareaInputDetail>('input', {
          detail: { value: ta.value },
          bubbles: true,
          composed: true,
        }),
      );
    });

    ta.addEventListener('change', () => {
      this._internals.setFormValue(ta.value);
      this._updateValidity(ta.value);
      this.dispatchEvent(
        new CustomEvent<AtlasTextareaChangeDetail>('change', {
          detail: { value: ta.value },
          bubbles: true,
          composed: true,
        }),
      );
      const name = this.getAttribute('name');
      if (name && this.surfaceId) {
        this.emit(`${this.surfaceId}.${name}-changed`, { value: ta.value });
      }
    });

    this._built = true;
  }

  private _syncAll(): void {
    this._sync('rows');
    this._sync('placeholder');
    this._sync('value');
    this._sync('disabled');
    this._sync('readonly');
    this._sync('required');
    this._sync('maxlength');
    this._updateCount();
    this._autoresize();
  }

  private _sync(name: string): void {
    const ta = this._textarea;
    if (!ta) return;
    switch (name) {
      case 'rows': {
        const rows = this.getAttribute('rows');
        ta.rows = rows != null ? Number(rows) || 4 : 4;
        break;
      }
      case 'placeholder': {
        const p = this.getAttribute('placeholder');
        if (p == null) ta.removeAttribute('placeholder');
        else ta.setAttribute('placeholder', p);
        break;
      }
      case 'value': {
        const v = this.getAttribute('value') ?? '';
        if (ta.value !== v) {
          ta.value = v;
          this._pendingValue = v;
          this._internals.setFormValue(v);
          this._updateValidity(v);
          this._updateCount();
          this._autoresize();
        }
        break;
      }
      case 'disabled':
        ta.disabled = this.hasAttribute('disabled');
        break;
      case 'readonly':
        ta.readOnly = this.hasAttribute('readonly');
        break;
      case 'required':
        ta.required = this.hasAttribute('required');
        this._updateValidity(ta.value);
        break;
      case 'maxlength': {
        const m = this.getAttribute('maxlength');
        if (m == null) ta.removeAttribute('maxlength');
        else ta.setAttribute('maxlength', m);
        this._updateCount();
        break;
      }
    }
  }

  private _updateCount(): void {
    const count = this.shadowRoot?.querySelector<HTMLElement>('.count');
    const ta = this._textarea;
    const maxAttr = this.getAttribute('maxlength');
    if (!count || !ta || maxAttr == null) return;
    const max = Number(maxAttr);
    const len = ta.value.length;
    count.textContent = `${len} / ${max}`;
    if (len > max) count.setAttribute('data-over', '');
    else count.removeAttribute('data-over');
  }

  private _autoresize(): void {
    if (!this.hasAttribute('autoresize')) return;
    const ta = this._textarea;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }

  private _updateValidity(value: string): void {
    const anchor = this._textarea ?? undefined;
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

AtlasElement.define('atlas-textarea', AtlasTextarea);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-textarea': AtlasTextarea;
  }
}
