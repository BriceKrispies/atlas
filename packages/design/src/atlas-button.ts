import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

const sheet = createSheet(`
  :host {
    display: inline-block;
  }
  button {
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-md);
    font-weight: var(--atlas-font-weight-medium);
    line-height: var(--atlas-line-height);
    /* WCAG 2.5.5 touch target. min-height wins on narrow phones; padding
       handles visual breathing room on wider viewports. */
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    cursor: pointer;
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    -webkit-tap-highlight-color: transparent;
    transition: background var(--atlas-transition-fast),
                border-color var(--atlas-transition-fast);
  }
  button:hover {
    background: var(--atlas-color-surface);
    border-color: var(--atlas-color-border-strong);
  }
  button:active {
    background: var(--atlas-color-surface-hover);
  }
  button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 1px;
  }
  button[disabled] {
    cursor: not-allowed;
    opacity: 0.6;
  }
  :host([variant="primary"]) button {
    background: var(--atlas-color-primary);
    color: var(--atlas-color-text-inverse);
    border-color: var(--atlas-color-primary);
  }
  :host([variant="primary"]) button:hover {
    background: var(--atlas-color-primary-hover);
    border-color: var(--atlas-color-primary-hover);
  }
  :host([variant="danger"]) button {
    background: var(--atlas-color-bg);
    color: var(--atlas-color-danger);
    border-color: var(--atlas-color-border);
  }
  :host([variant="danger"]) button:hover {
    background: var(--atlas-color-danger-subtle);
    border-color: var(--atlas-color-danger);
  }
  :host([variant="ghost"]) button {
    background: transparent;
    border-color: transparent;
    color: var(--atlas-color-text-muted);
  }
  :host([variant="ghost"]) button:hover {
    background: var(--atlas-color-surface);
    color: var(--atlas-color-text);
  }
  :host([size="sm"]) button {
    font-size: var(--atlas-font-size-sm);
    /* sm retains the full target minimum on touch; only padding shrinks. */
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
  }
  @media (hover: none) {
    button:hover {
      background: var(--atlas-color-bg);
      border-color: var(--atlas-color-border);
    }
    :host([variant="primary"]) button:hover {
      background: var(--atlas-color-primary);
      border-color: var(--atlas-color-primary);
    }
  }
`);

/**
 * <atlas-button> — primary click control.
 *
 * Attributes:
 *   variant  — "primary" | "danger" | "ghost" (default: neutral)
 *   size     — "sm" for compact sizing
 *   disabled — reflected to the inner <button>
 *
 * Events: native `click` bubbles through the shadow boundary. When both
 * `surfaceId` (from surface context) and `name` are present, also emits
 * `${surfaceId}.${name}-clicked` telemetry via `this.emit(...)`.
 */
export class AtlasButton extends AtlasElement {
  declare variant: string;
  declare size: string;
  declare disabled: boolean;

  static {
    Object.defineProperty(
      this.prototype,
      'variant',
      AtlasElement.strAttr('variant', ''),
    );
    Object.defineProperty(
      this.prototype,
      'size',
      AtlasElement.strAttr('size', ''),
    );
    Object.defineProperty(
      this.prototype,
      'disabled',
      AtlasElement.boolAttr('disabled'),
    );
  }

  static override get observedAttributes(): readonly string[] {
    return ['disabled'];
  }

  private readonly _btn: HTMLButtonElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);

    const btn = document.createElement('button');
    btn.type = 'button';
    const slot = document.createElement('slot');
    btn.appendChild(slot);
    root.appendChild(btn);
    this._btn = btn;

    btn.addEventListener('click', () => {
      const name = this.getAttribute('name');
      if (this.surfaceId && name) {
        this.emit(`${this.surfaceId}.${name}-clicked`);
      }
    });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._syncDisabled();
  }

  override attributeChangedCallback(name: string): void {
    if (name === 'disabled') this._syncDisabled();
  }

  private _syncDisabled(): void {
    if (this.hasAttribute('disabled')) {
      this._btn.setAttribute('disabled', '');
    } else {
      this._btn.removeAttribute('disabled');
    }
  }

  get label(): string {
    return this.textContent?.trim() ?? '';
  }
}

AtlasElement.define('atlas-button', AtlasButton);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-button': AtlasButton;
  }
}
