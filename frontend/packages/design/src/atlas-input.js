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
`;

class AtlasInput extends AtlasElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    super.connectedCallback();

    const label = this.getAttribute('label') ?? '';
    const type = this.getAttribute('type') ?? 'text';
    const placeholder = this.getAttribute('placeholder') ?? '';
    const required = this.hasAttribute('required');
    const inputId = `input-${Math.random().toString(36).slice(2, 8)}`;

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      ${label ? `<label for="${inputId}">${label}</label>` : ''}
      <input
        id="${inputId}"
        type="${type}"
        placeholder="${placeholder}"
        ${required ? 'required' : ''}
      />
    `;

    this.shadowRoot.querySelector('input').addEventListener('input', (e) => {
      this.dispatchEvent(new CustomEvent('change', {
        detail: { value: e.target.value },
        bubbles: true,
      }));
    });
  }

  get value() {
    return this.shadowRoot?.querySelector('input')?.value ?? '';
  }

  set value(v) {
    const input = this.shadowRoot?.querySelector('input');
    if (input) input.value = v;
  }
}

AtlasElement.define('atlas-input', AtlasInput);
