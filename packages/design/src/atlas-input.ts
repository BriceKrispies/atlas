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
  input {
    width: 100%;
    /* 44×44 touch target and 16px minimum font to suppress iOS zoom-on-focus.
       Vertical padding is derived from min-height so the caret stays centered
       even when the user bumps the root font-size. */
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    font-size: max(16px, var(--atlas-font-size-md));
    font-family: var(--atlas-font-family);
    line-height: var(--atlas-line-height);
    color: var(--atlas-color-text);
    background: var(--atlas-color-bg);
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
    transition: border-color var(--atlas-transition-fast);
  }
  input::placeholder {
    color: var(--atlas-color-text-muted);
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
`);

export interface AtlasInputChangeDetail {
  value: string;
}
export interface AtlasInputInputDetail {
  value: string;
}

/**
 * `<atlas-input>` — single-line text input.
 *
 * Render strategy: shadow-DOM shell is built ONCE in `connectedCallback` via
 * `_buildShell()`. `attributeChangedCallback` dispatches to `_sync(name)` for
 * surgical updates. Structural attrs that trigger full rebuild: `label`
 * (presence of the <label> node). All others are surgical.
 *
 * Events:
 *   input  → CustomEvent<AtlasInputInputDetail>  — every keystroke
 *   change → CustomEvent<AtlasInputChangeDetail> — on commit (blur)
 *
 * Form-associated: participates in `<form>` + `FormData` via ElementInternals.
 */
export class AtlasInput extends AtlasElement {
  static formAssociated = true;

  static override get observedAttributes(): readonly string[] {
    return [
      'label',
      'type',
      'placeholder',
      'value',
      'required',
      'disabled',
      'readonly',
      'minlength',
      'maxlength',
      'pattern',
      'autocomplete',
      'inputmode',
      'autocapitalize',
      'autocorrect',
      'spellcheck',
      'enterkeyhint',
    ];
  }

  declare disabled: boolean;
  declare required: boolean;
  declare readOnly: boolean;
  declare type: string;

  static {
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'required', AtlasElement.boolAttr('required'));
    Object.defineProperty(this.prototype, 'readOnly', AtlasElement.boolAttr('readonly'));
    Object.defineProperty(this.prototype, 'type', AtlasElement.strAttr('type', 'text'));
  }

  private readonly _inputId = uid('atlas-input');
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
    return this._input?.value ?? this._pendingValue ?? this.getAttribute('value') ?? '';
  }
  set value(v: string) {
    const str = v == null ? '' : String(v);
    this._pendingValue = str;
    const input = this._input;
    if (input && input.value !== str) input.value = str;
    this._internals.setFormValue(str);
    this._updateValidity(str);
  }

  /** The underlying <input> element once the shell is built. */
  private get _input(): HTMLInputElement | null {
    return this.shadowRoot?.querySelector<HTMLInputElement>('input') ?? null;
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
    this._sync(name);
  }

  /** Build the persistent shadow-DOM shell once. */
  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const label = this.getAttribute('label') ?? '';
    root.innerHTML = `
      ${label ? `<label for="${escapeAttr(this._inputId)}">${escapeText(label)}</label>` : ''}
      <input id="${escapeAttr(this._inputId)}" />
    `;

    const input = this._input;
    if (!input) return;

    // input fires on every keystroke.
    input.addEventListener('input', () => {
      this._pendingValue = input.value;
      if (this.hasAttribute('value')) {
        // Reflect live value if consumer is attribute-driven. Avoid setAttribute
        // to not retrigger observedAttributes rebuild.
      }
      this._internals.setFormValue(input.value);
      this._updateValidity(input.value);
      this.dispatchEvent(
        new CustomEvent<AtlasInputInputDetail>('input', {
          detail: { value: input.value },
          bubbles: true,
          composed: true,
        }),
      );
    });

    // change fires on commit (blur, per native <input> semantics).
    input.addEventListener('change', () => {
      this._internals.setFormValue(input.value);
      this._updateValidity(input.value);
      this.dispatchEvent(
        new CustomEvent<AtlasInputChangeDetail>('change', {
          detail: { value: input.value },
          bubbles: true,
          composed: true,
        }),
      );
      const name = this.getAttribute('name');
      if (name && this.surfaceId) {
        this.emit(`${this.surfaceId}.${name}-changed`, { value: input.value });
      }
    });

    this._built = true;
  }

  private _syncAll(): void {
    this._sync('type');
    this._sync('placeholder');
    this._sync('value');
    this._sync('required');
    this._sync('disabled');
    this._sync('readonly');
    this._sync('minlength');
    this._sync('maxlength');
    this._sync('pattern');
    this._sync('autocomplete');
    this._sync('inputmode');
    this._sync('autocapitalize');
    this._sync('autocorrect');
    this._sync('spellcheck');
    this._sync('enterkeyhint');
    this._sync('label');
    // Apply type-based input defaults once after all attrs are in place.
    this._applyTypeDefaults();
  }

  private _sync(name: string): void {
    const input = this._input;
    if (!input) return;
    switch (name) {
      case 'label':
        this._syncLabel();
        break;
      case 'type': {
        const t = this.getAttribute('type') ?? 'text';
        input.type = t;
        this._applyTypeDefaults();
        break;
      }
      case 'placeholder': {
        const p = this.getAttribute('placeholder');
        if (p == null) input.removeAttribute('placeholder');
        else input.setAttribute('placeholder', p);
        break;
      }
      case 'value': {
        const v = this.getAttribute('value') ?? '';
        // Only write if drifted — never clobber caret mid-typing.
        if (input.value !== v) {
          input.value = v;
          this._pendingValue = v;
          this._internals.setFormValue(v);
          this._updateValidity(v);
        }
        break;
      }
      case 'required':
        input.required = this.hasAttribute('required');
        this._updateValidity(input.value);
        break;
      case 'disabled':
        input.disabled = this.hasAttribute('disabled');
        break;
      case 'readonly':
        input.readOnly = this.hasAttribute('readonly');
        break;
      case 'minlength':
      case 'maxlength':
      case 'pattern':
      case 'autocomplete':
      case 'inputmode':
      case 'autocapitalize':
      case 'autocorrect':
      case 'enterkeyhint': {
        const v = this.getAttribute(name);
        if (v == null) input.removeAttribute(name);
        else input.setAttribute(name, v);
        break;
      }
      case 'spellcheck': {
        const v = this.getAttribute('spellcheck');
        if (v == null) input.removeAttribute('spellcheck');
        else input.setAttribute('spellcheck', v);
        break;
      }
    }
  }

  /** Surgically update the <label> for the shell without rebuilding <input>. */
  private _syncLabel(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const labelText = this.getAttribute('label') ?? '';
    let labelEl = root.querySelector<HTMLLabelElement>('label');
    if (labelText) {
      if (!labelEl) {
        labelEl = document.createElement('label');
        labelEl.setAttribute('for', this._inputId);
        root.insertBefore(labelEl, root.querySelector('input'));
      }
      labelEl.textContent = labelText;
    } else if (labelEl) {
      labelEl.remove();
    }
  }

  /**
   * Apply sensible mobile-keyboard defaults based on `type`. Consumers may
   * override any of these by setting the attribute explicitly on the host.
   * Never clobbers an explicit host attribute.
   */
  private _applyTypeDefaults(): void {
    const input = this._input;
    if (!input) return;
    const type = this.getAttribute('type') ?? 'text';

    const setIfUnset = (attr: string, value: string): void => {
      // If host has it explicitly, the _sync already propagated it; skip.
      if (this.hasAttribute(attr)) return;
      input.setAttribute(attr, value);
    };

    // Wipe previously-applied defaults if type changed — only for attrs the
    // host didn't explicitly set. We detect "implicit" defaults by absence
    // of the host attr.
    const wipeIfUnset = (attr: string): void => {
      if (this.hasAttribute(attr)) return;
      input.removeAttribute(attr);
    };

    // Reset these first — each type re-applies what it needs.
    for (const attr of [
      'inputmode',
      'autocapitalize',
      'autocorrect',
      'spellcheck',
      'enterkeyhint',
    ]) {
      wipeIfUnset(attr);
    }

    switch (type) {
      case 'email':
        setIfUnset('inputmode', 'email');
        setIfUnset('autocapitalize', 'off');
        setIfUnset('autocorrect', 'off');
        setIfUnset('spellcheck', 'false');
        setIfUnset('enterkeyhint', 'next');
        break;
      case 'tel':
        setIfUnset('inputmode', 'tel');
        setIfUnset('autocapitalize', 'off');
        setIfUnset('autocorrect', 'off');
        break;
      case 'url':
        setIfUnset('inputmode', 'url');
        setIfUnset('autocapitalize', 'off');
        setIfUnset('autocorrect', 'off');
        setIfUnset('spellcheck', 'false');
        break;
      case 'number': {
        const step = this.getAttribute('step') ?? '';
        const hasDecimal = step.includes('.');
        setIfUnset('inputmode', hasDecimal ? 'decimal' : 'numeric');
        break;
      }
      case 'search':
        setIfUnset('inputmode', 'search');
        setIfUnset('enterkeyhint', 'search');
        break;
      case 'password':
        setIfUnset('autocapitalize', 'off');
        setIfUnset('autocorrect', 'off');
        setIfUnset('spellcheck', 'false');
        break;
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

AtlasElement.define('atlas-input', AtlasInput);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-input': AtlasInput;
  }
}
