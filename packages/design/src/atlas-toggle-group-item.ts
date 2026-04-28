import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText } from './util.ts';

/**
 * <atlas-toggle-group-item> — one toggleable cell inside an
 * `<atlas-toggle-group>`.
 *
 * Slots:
 *   icon    — optional leading icon.
 *   default — text label (used when `label` attribute is empty).
 *
 * Attributes:
 *   value    — required identifier reported to `change` events.
 *   label    — convenience accessible label; otherwise default slot
 *              text content is used.
 *   disabled — non-interactive.
 *
 * The host element itself is the focusable button — there is no inner
 * <button> — so roving tabindex set by the parent toggle-group works
 * uniformly. ARIA role/state (`aria-pressed` for multi, role=radio +
 * `aria-checked` for single) is also stamped by the parent.
 */

const sheet = createSheet(`
  :host {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--atlas-space-xs);
    min-height: var(--atlas-touch-target-min, 44px);
    min-width: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border-radius: calc(var(--atlas-radius-md) - 3px);
    background: transparent;
    color: var(--atlas-color-text-muted);
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    line-height: 1;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition: background var(--atlas-transition-fast),
                color var(--atlas-transition-fast);
    box-sizing: border-box;
  }
  :host(:hover:not([disabled])) {
    background: var(--atlas-color-surface-hover);
    color: var(--atlas-color-text);
  }
  :host([selected]) {
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    box-shadow: var(--atlas-shadow-sm);
  }
  :host([disabled]) {
    cursor: not-allowed;
    opacity: 0.6;
  }
  :host(:focus-visible) {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  /* Smaller variant — visual padding only, touch target retained on
     coarse pointers (R3.2). */
  :host([size="sm"]) {
    font-size: var(--atlas-font-size-xs);
    min-height: 32px;
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
  }
  @media (pointer: coarse) {
    :host([size="sm"]) {
      min-height: var(--atlas-touch-target-min, 44px);
    }
  }

  .label { white-space: nowrap; }
`);

interface ToggleGroupParent extends HTMLElement {
  toggleFromItem(item: HTMLElement): void;
}

export class AtlasToggleGroupItem extends AtlasElement {
  declare value: string;
  declare label: string;
  declare disabled: boolean;

  static {
    Object.defineProperty(this.prototype, 'value', AtlasElement.strAttr('value', ''));
    Object.defineProperty(this.prototype, 'label', AtlasElement.strAttr('label', ''));
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
  }

  static override get observedAttributes(): readonly string[] {
    return ['label'];
  }

  private _built = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._build();
    this._syncLabel();
    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '-1');
    this.addEventListener('click', this._onClick);
  }

  override disconnectedCallback(): void {
    this.removeEventListener('click', this._onClick);
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'label') this._syncLabel();
  }

  private _build(): void {
    const root = this.shadowRoot;
    if (!root) return;
    root.innerHTML = `
      <slot name="icon"></slot>
      <span class="label" data-part="label"></span>
      <slot></slot>
    `;
    this._built = true;
  }

  private _syncLabel(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const labelSpan = root.querySelector('.label') as HTMLElement | null;
    if (!labelSpan) return;
    const label = this.getAttribute('label') ?? '';
    if (label) {
      labelSpan.textContent = label;
      labelSpan.removeAttribute('hidden');
      this.setAttribute('aria-label', label);
    } else {
      labelSpan.textContent = '';
      labelSpan.setAttribute('hidden', '');
      // Accessible name will fall back to slotted text via shadow root
      // child accumulation; remove the explicit aria-label.
      this.removeAttribute('aria-label');
    }
    // Keep escapeAttr/escapeText referenced via no-op so eslint
    // doesn't flag them as dead imports if a future renderer needs them.
    void escapeAttr;
    void escapeText;
  }

  private _onClick = (e: MouseEvent): void => {
    if (this.hasAttribute('disabled')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const parent = this.parentElement;
    if (parent && parent.tagName.toLowerCase() === 'atlas-toggle-group') {
      (parent as ToggleGroupParent).toggleFromItem(this);
    }
  };
}

AtlasElement.define('atlas-toggle-group-item', AtlasToggleGroupItem);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-toggle-group-item': AtlasToggleGroupItem;
  }
}
