import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-split-button> — primary button + adjoining dropdown trigger.
 *
 * Composition:
 *   default slot — primary action label (e.g. "Save").
 *   menu slot    — dropdown content. Conventionally an
 *                  `<atlas-menu slot="menu">` from @atlas/design, but any
 *                  popover-shaped child is rendered as the panel
 *                  contents. The split-button itself does NOT implement
 *                  menu semantics — it composes whatever is slotted.
 *
 * Attributes:
 *   variant   — primary (default) | secondary | danger
 *   size      — sm | md (default)
 *   disabled  — disables both buttons
 *   open      — reflects panel state (read or set by author)
 *
 * Events:
 *   click      — bubbles from the primary button (native).
 *   open       — CustomEvent fired when the dropdown opens.
 *   close      — CustomEvent fired when the dropdown closes.
 *   When `surfaceId` + `name` are set, also emits
 *   `${surfaceId}.${name}-clicked` for the primary action via
 *   `this.emit(...)`. The slotted menu emits its own selection event.
 *
 * Keyboard:
 *   Space/Enter on primary → click.
 *   ArrowDown on primary or chevron → opens menu.
 *   Escape on chevron or panel → closes menu, returns focus to chevron.
 *
 * Touch targets (C16/R3): both inner buttons are min 44×44.
 */

const sheet = createSheet(`
  :host {
    display: inline-flex;
    position: relative;
  }
  :host([disabled]) {
    pointer-events: none;
    opacity: 0.6;
  }
  .group {
    display: inline-flex;
    align-items: stretch;
    /* The two buttons share a border so the seam reads as one control. */
  }
  button {
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-md);
    font-weight: var(--atlas-font-weight-medium);
    line-height: var(--atlas-line-height);
    min-height: var(--atlas-touch-target-min, 44px);
    min-width: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: background var(--atlas-transition-fast),
                border-color var(--atlas-transition-fast);
  }
  button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 1px;
    z-index: 1;
  }
  .primary {
    border-top-left-radius: var(--atlas-radius-md);
    border-bottom-left-radius: var(--atlas-radius-md);
  }
  .chevron {
    border-top-right-radius: var(--atlas-radius-md);
    border-bottom-right-radius: var(--atlas-radius-md);
    border-left-width: 0;
    padding-left: var(--atlas-space-sm);
    padding-right: var(--atlas-space-sm);
  }
  button:hover:not([disabled]) {
    background: var(--atlas-color-surface);
    border-color: var(--atlas-color-border-strong);
  }
  button[disabled] {
    cursor: not-allowed;
  }

  /* primary variant */
  :host([variant="primary"]) button {
    background: var(--atlas-color-primary);
    color: var(--atlas-color-text-inverse);
    border-color: var(--atlas-color-primary);
  }
  :host([variant="primary"]) button:hover:not([disabled]) {
    background: var(--atlas-color-primary-hover);
    border-color: var(--atlas-color-primary-hover);
  }
  :host([variant="primary"]) .chevron {
    /* slight darken to delineate the seam on solid backgrounds */
    box-shadow: inset 1px 0 0 0 rgba(0, 0, 0, 0.15);
  }

  /* danger variant */
  :host([variant="danger"]) button {
    background: var(--atlas-color-danger);
    color: var(--atlas-color-text-inverse);
    border-color: var(--atlas-color-danger);
  }
  :host([variant="danger"]) button:hover:not([disabled]) {
    background: var(--atlas-color-danger-hover, var(--atlas-color-danger));
    border-color: var(--atlas-color-danger-hover, var(--atlas-color-danger));
  }
  :host([variant="danger"]) .chevron {
    box-shadow: inset 1px 0 0 0 rgba(0, 0, 0, 0.15);
  }

  /* size sm — only padding; touch target remains 44px on coarse pointers */
  :host([size="sm"]) button {
    font-size: var(--atlas-font-size-sm);
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
  }

  .chev-icon {
    width: 12px;
    height: 12px;
    display: inline-block;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .panel {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: max(180px, 100%);
    background: var(--atlas-color-bg);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    box-shadow: var(--atlas-shadow-md);
    padding: var(--atlas-space-xs);
    z-index: 10;
  }
  .panel[hidden] { display: none; }
`);

export class AtlasSplitButton extends AtlasElement {
  declare variant: string;
  declare size: string;
  declare disabled: boolean;
  declare open: boolean;

  static {
    Object.defineProperty(this.prototype, 'variant', AtlasElement.strAttr('variant', ''));
    Object.defineProperty(this.prototype, 'size', AtlasElement.strAttr('size', ''));
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'open', AtlasElement.boolAttr('open'));
  }

  static override get observedAttributes(): readonly string[] {
    return ['disabled', 'open'];
  }

  private _built = false;
  private _primary: HTMLButtonElement | null = null;
  private _chevron: HTMLButtonElement | null = null;
  private _panel: HTMLElement | null = null;
  private _onDocClick = (e: MouseEvent): void => {
    if (!this.hasAttribute('open')) return;
    const path = e.composedPath();
    if (!path.includes(this)) this._setOpen(false);
  };

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._build();
    this._syncDisabled();
    this._syncOpen();
    document.addEventListener('click', this._onDocClick);
  }

  override disconnectedCallback(): void {
    document.removeEventListener('click', this._onDocClick);
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'disabled') this._syncDisabled();
    if (name === 'open') this._syncOpen();
  }

  private _build(): void {
    const root = this.shadowRoot;
    if (!root) return;

    const group = document.createElement('div');
    group.className = 'group';

    const primary = document.createElement('button');
    primary.type = 'button';
    primary.className = 'primary';
    primary.setAttribute('data-part', 'primary');
    const labelSlot = document.createElement('slot');
    primary.appendChild(labelSlot);
    primary.addEventListener('click', () => {
      const name = this.getAttribute('name');
      if (this.surfaceId && name) {
        this.emit(`${this.surfaceId}.${name}-clicked`);
      }
    });
    primary.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._setOpen(true);
      }
    });

    const chevron = document.createElement('button');
    chevron.type = 'button';
    chevron.className = 'chevron';
    chevron.setAttribute('data-part', 'chevron');
    chevron.setAttribute('aria-haspopup', 'menu');
    chevron.setAttribute('aria-expanded', 'false');
    chevron.setAttribute('aria-label', 'Open menu');
    chevron.innerHTML = `
      <svg class="chev-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M4 6l4 4 4-4"/>
      </svg>
    `;
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      this._setOpen(!this.hasAttribute('open'));
    });
    chevron.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this._setOpen(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._setOpen(false);
      }
    });

    group.appendChild(primary);
    group.appendChild(chevron);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('data-part', 'panel');
    panel.hidden = true;
    const menuSlot = document.createElement('slot');
    menuSlot.name = 'menu';
    panel.appendChild(menuSlot);
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this._setOpen(false);
        chevron.focus();
      }
    });

    root.appendChild(group);
    root.appendChild(panel);

    this._primary = primary;
    this._chevron = chevron;
    this._panel = panel;
    this._built = true;
  }

  /**
   * Programmatic test-id propagation: the split-button has a single
   * `name`, but exposes two distinct interactive regions. Mirror the
   * `name` to a `.primary` and `.chevron` suffix so tests can target
   * each. Handled via attribute observation rather than render-time
   * interpolation to keep `_build` idempotent.
   */
  private _testIds(): void {
    const sid = this.surfaceId;
    const name = this.getAttribute('name');
    if (!sid || !name || !this._primary || !this._chevron) return;
    this._primary.setAttribute('data-testid', `${sid}.${name}.primary`);
    this._chevron.setAttribute('data-testid', `${sid}.${name}.chevron`);
  }

  private _syncDisabled(): void {
    const disabled = this.hasAttribute('disabled');
    if (this._primary) this._primary.toggleAttribute('disabled', disabled);
    if (this._chevron) this._chevron.toggleAttribute('disabled', disabled);
    this._testIds();
  }

  private _setOpen(next: boolean): void {
    if (next === this.hasAttribute('open')) return;
    this.toggleAttribute('open', next);
  }

  private _syncOpen(): void {
    const isOpen = this.hasAttribute('open');
    if (this._panel) this._panel.hidden = !isOpen;
    if (this._chevron) this._chevron.setAttribute('aria-expanded', String(isOpen));
    this.dispatchEvent(
      new CustomEvent(isOpen ? 'open' : 'close', { bubbles: true, composed: true }),
    );
    this._testIds();
  }
}

AtlasElement.define('atlas-split-button', AtlasSplitButton);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-split-button': AtlasSplitButton;
  }
}
