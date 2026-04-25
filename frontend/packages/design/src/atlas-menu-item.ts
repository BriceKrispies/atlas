import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-menu-item> — a single row inside <atlas-menu>. Carries
 * `role="menuitem"` and exposes a `value` attribute that is echoed in
 * the parent menu's `select` event detail.
 *
 * Attributes:
 *   value       — string echoed on activation (defaults to text content).
 *   disabled    — boolean; non-interactive + visually muted.
 *   destructive — boolean; danger-toned (delete actions).
 *   icon        — optional `name` for an `<atlas-icon>` rendered ahead of
 *                 the label slot.
 *   shortcut    — optional small text shown right-aligned (e.g. "⌘K").
 *
 * Children appearing in the default slot become the visible label.
 * Activation (Enter / Space / click) bubbles up to the parent
 * <atlas-menu> through a synthetic `atlas-menu-item-activate` CustomEvent
 * with `{ value }`. The parent translates that into the public `select`
 * event with the same payload.
 *
 * Shadow DOM. Touch target compliance (44×44 on coarse pointers) is
 * enforced via the host stylesheet.
 */
const sheet = createSheet(`
  :host {
    display: block;
    font-family: var(--atlas-font-family);
  }
  :host([hidden]) { display: none; }

  .row {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    width: 100%;
    box-sizing: border-box;
    padding: var(--atlas-space-xs) var(--atlas-space-sm);
    min-height: 32px;
    border: 0;
    border-radius: var(--atlas-radius-sm);
    background: transparent;
    color: var(--atlas-color-text);
    font: inherit;
    text-align: start;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .row:focus { outline: none; }
  :host(:focus-visible) .row,
  :host([data-active="true"]) .row {
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-primary);
    outline: none;
  }
  :host([disabled]) .row {
    color: var(--atlas-color-text-muted);
    cursor: not-allowed;
    opacity: 0.7;
  }
  :host([destructive]) .row { color: var(--atlas-color-danger); }
  :host([destructive][data-active="true"]) .row,
  :host([destructive]:focus-visible) .row {
    background: color-mix(in oklab, var(--atlas-color-danger) 12%, transparent);
    color: var(--atlas-color-danger);
  }

  .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .icon { flex: 0 0 auto; width: 16px; height: 16px; display: inline-flex; }
  .shortcut {
    flex: 0 0 auto;
    font-size: var(--atlas-font-size-sm);
    color: var(--atlas-color-text-muted);
    margin-left: auto;
  }

  /* Coarse pointer (touch / pen): assert 44px minimum target per C16. */
  @media (pointer: coarse) {
    .row { min-height: var(--atlas-touch-target-min, 44px); }
  }
`);

export class AtlasMenuItem extends AtlasElement {
  declare disabled: boolean;
  declare destructive: boolean;
  declare value: string;
  declare icon: string;
  declare shortcut: string;

  static {
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'destructive', AtlasElement.boolAttr('destructive'));
    Object.defineProperty(this.prototype, 'value', AtlasElement.strAttr('value', ''));
    Object.defineProperty(this.prototype, 'icon', AtlasElement.strAttr('icon', ''));
    Object.defineProperty(this.prototype, 'shortcut', AtlasElement.strAttr('shortcut', ''));
  }

  static override get observedAttributes(): readonly string[] {
    return ['disabled', 'destructive', 'icon', 'shortcut'];
  }

  private _built = false;
  private _row: HTMLElement | null = null;
  private _iconEl: HTMLElement | null = null;
  private _shortcutEl: HTMLElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._build();
    this._sync('icon');
    this._sync('shortcut');
    this._sync('disabled');
    if (!this.hasAttribute('role')) this.setAttribute('role', 'menuitem');
    // Items participate in roving tabindex managed by the parent menu.
    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '-1');
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    this._sync(name);
  }

  /** Programmatic activation. Fires the same internal activate event. */
  activate(): void {
    if (this.disabled) return;
    this.dispatchEvent(
      new CustomEvent<{ value: string }>('atlas-menu-item-activate', {
        detail: { value: this._resolvedValue() },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Plain-text label, used by the menu for typeahead. */
  get textLabel(): string {
    return (this.textContent ?? '').trim();
  }

  private _resolvedValue(): string {
    const v = this.getAttribute('value');
    if (v != null && v !== '') return v;
    return this.textLabel;
  }

  private _build(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('data-part', 'row');

    const iconEl = document.createElement('span');
    iconEl.className = 'icon';
    iconEl.hidden = true;
    iconEl.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'label';
    const slot = document.createElement('slot');
    label.appendChild(slot);

    const shortcutEl = document.createElement('span');
    shortcutEl.className = 'shortcut';
    shortcutEl.hidden = true;

    row.appendChild(iconEl);
    row.appendChild(label);
    row.appendChild(shortcutEl);
    root.appendChild(row);

    this._row = row;
    this._iconEl = iconEl;
    this._shortcutEl = shortcutEl;

    // Pointer activation. Note: we DO NOT preventDefault on pointerdown so
    // the menu's outside-click logic can still treat clicks correctly.
    row.addEventListener('click', (e) => {
      if (this.disabled) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      this.activate();
    });

    this._built = true;
  }

  private _sync(name: string): void {
    if (name === 'disabled') {
      this.setAttribute('aria-disabled', this.disabled ? 'true' : 'false');
      return;
    }
    if (name === 'icon' && this._iconEl) {
      const v = this.getAttribute('icon') ?? '';
      this._iconEl.hidden = !v;
      // Build the icon via DOM APIs so we don't have to escape user input
      // into innerHTML — and so atlas-icon participates in upgrade.
      this._iconEl.replaceChildren();
      if (v) {
        const icon = document.createElement('atlas-icon');
        icon.setAttribute('name', v);
        this._iconEl.appendChild(icon);
      }
      return;
    }
    if (name === 'shortcut' && this._shortcutEl) {
      const v = this.getAttribute('shortcut') ?? '';
      this._shortcutEl.hidden = !v;
      this._shortcutEl.textContent = v;
    }
  }
}

AtlasElement.define('atlas-menu-item', AtlasMenuItem);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-menu-item': AtlasMenuItem;
  }
}
