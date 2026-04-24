import { AtlasElement } from '@atlas/core';

const styles = `
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
`;

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
 *   checked   — boolean
 *   disabled  — boolean
 *   label     — text label (or use slotted text)
 *   name      — form name / testid suffix
 *
 * Events:
 *   change → CustomEvent<AtlasSwitchChangeDetail>
 */
export class AtlasSwitch extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['checked', 'disabled', 'label'];
  }

  private _inputId = `atlas-sw-${Math.random().toString(36).slice(2, 8)}`;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get checked(): boolean {
    return this.hasAttribute('checked');
  }
  set checked(v: boolean) {
    if (v) this.setAttribute('checked', '');
    else this.removeAttribute('checked');
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
    this._sync();
  }

  private _render(): void {
    if (!this.shadowRoot) return;
    const label = this.getAttribute('label') ?? '';
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <span class="track">
        <input
          id="${this._inputId}"
          type="checkbox"
          role="switch"
          ${this.checked ? 'checked' : ''}
          ${this.disabled ? 'disabled' : ''}
        />
        <span class="thumb" aria-hidden="true"></span>
      </span>
      <label class="label" for="${this._inputId}">${label}<slot></slot></label>
    `;
    this._sync();
    const input = this.shadowRoot.querySelector<HTMLInputElement>('input');
    input?.addEventListener('change', () => {
      this.checked = input.checked;
      this.dispatchEvent(
        new CustomEvent<AtlasSwitchChangeDetail>('change', {
          detail: { checked: this.checked },
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
    input.setAttribute('aria-checked', String(this.checked));
  }
}

AtlasElement.define('atlas-switch', AtlasSwitch);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-switch': AtlasSwitch;
  }
}
