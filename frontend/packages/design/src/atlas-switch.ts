import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, uid } from './util.ts';

const sheet = createSheet(`
  :host {
    display: inline-flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    min-height: var(--atlas-touch-target-min, 44px);
  }
  :host([disabled]) {
    cursor: not-allowed;
    color: var(--atlas-color-text-muted);
  }
  .track {
    position: relative;
    flex: 0 0 auto;
    width: 36px;
    height: 20px;
    border-radius: 999px;
    background: var(--atlas-color-border-strong);
    transition: background var(--atlas-transition-base);
  }
  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: inherit;
    border-radius: 999px;
  }
  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--atlas-color-bg);
    box-shadow: var(--atlas-shadow-sm);
    transition: transform var(--atlas-transition-base);
    pointer-events: none;
  }
  :host([checked]) .track {
    background: var(--atlas-color-primary);
  }
  :host([checked]) .thumb {
    transform: translateX(16px);
  }
  :host([disabled]) .track {
    background: var(--atlas-color-surface);
  }
  :host([disabled][checked]) .track {
    background: var(--atlas-color-border);
  }
  input:focus-visible + .thumb,
  :host(:focus-visible) .track {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  .label {
    font-size: var(--atlas-font-size-md);
    line-height: var(--atlas-line-height);
    user-select: none;
  }
`);

export interface AtlasSwitchChangeDetail {
  checked: boolean;
}

/**
 * `<atlas-switch>` — on/off toggle with instant effect.
 *
 * When to use: settings that take effect immediately (e.g. "Enable notifications").
 * When NOT to use: use `<atlas-checkbox>` for form opt-ins that are submitted
 * later; use `<atlas-radio-group>` for exclusive choices.
 *
 * Attributes:
 *   checked   - boolean
 *   disabled  - boolean
 *   required  - boolean
 *   label     - text label (or use slotted text)
 *   name      - form name / testid suffix
 *
 * Events:
 *   change -> CustomEvent<AtlasSwitchChangeDetail>
 */
export class AtlasSwitch extends AtlasElement {
  static formAssociated = true;

  static override get observedAttributes(): readonly string[] {
    return ['checked', 'disabled', 'label', 'required'];
  }

  declare checked: boolean;
  declare disabled: boolean;
  declare required: boolean;

  static {
    Object.defineProperty(this.prototype, 'checked', AtlasElement.boolAttr('checked'));
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'required', AtlasElement.boolAttr('required'));
  }

  private readonly _inputId = uid('atlas-sw');
  private readonly _internals: ElementInternals;
  private _built = false;
  private _input: HTMLInputElement | null = null;
  private _labelEl: HTMLLabelElement | null = null;
  private _onInputChange = (): void => {
    if (!this._input) return;
    this.checked = this._input.checked;
    this._commit();
    this.dispatchEvent(
      new CustomEvent<AtlasSwitchChangeDetail>('change', {
        detail: { checked: this.checked },
        bubbles: true,
        composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-changed`, {
        checked: this.checked,
      });
    }
  };

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._internals = this.attachInternals();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncAll();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    this._sync(name);
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    adoptSheet(root, sheet);
    root.innerHTML = `
      <span class="track">
        <input id="${escapeAttr(this._inputId)}" type="checkbox" role="switch" />
        <span class="thumb" aria-hidden="true"></span>
      </span>
      <label class="label" for="${escapeAttr(this._inputId)}"><span class="label-text"></span><slot></slot></label>
    `;
    this._input = root.querySelector<HTMLInputElement>('input');
    this._labelEl = root.querySelector<HTMLLabelElement>('label.label');
    this._input?.addEventListener('change', this._onInputChange);
    this._built = true;
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('checked');
    this._sync('disabled');
    this._sync('required');
    this._commit();
  }

  private _sync(name: string): void {
    const input = this._input;
    if (!input) return;
    switch (name) {
      case 'checked':
        input.checked = this.checked;
        input.setAttribute('aria-checked', String(this.checked));
        this._commit();
        break;
      case 'disabled':
        input.disabled = this.disabled;
        break;
      case 'required':
        input.required = this.required;
        this._commit();
        break;
      case 'label': {
        const labelText = this._labelEl?.querySelector<HTMLElement>('.label-text');
        if (labelText) labelText.textContent = this.getAttribute('label') ?? '';
        break;
      }
    }
  }

  private _commit(): void {
    // A switch submits "on" when on and nothing when off — same as a checkbox.
    const submitted = this.checked ? 'on' : null;
    this._internals.setFormValue(submitted);
    if (this.required && !this.checked) {
      this._internals.setValidity(
        { valueMissing: true },
        'Required',
        this._input ?? undefined,
      );
    } else {
      this._internals.setValidity({});
    }
  }
}

AtlasElement.define('atlas-switch', AtlasSwitch);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-switch': AtlasSwitch;
  }
}
