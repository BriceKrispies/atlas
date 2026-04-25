import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-capability-tile> — toggleable permission tile.
 *
 * Used inside `<atlas-capability-grid>` to express discrete agent
 * capabilities (e.g. "read content", "write media", "send email"). Each
 * tile is a keyboard-toggleable button with `aria-pressed`, sized to
 * meet the 44×44 touch target minimum (R3.1).
 *
 * Attributes:
 *   value       — string id submitted to the parent grid on toggle.
 *   label       — short title.
 *   description — supporting copy.
 *   selected    — (boolean) reflects pressed state.
 *   disabled    — (boolean)
 *
 * Slots:
 *   icon        — leading icon (atlas-icon, svg, etc).
 *
 * Events:
 *   toggle      — fires when the tile is toggled. detail: { value, selected }.
 *
 * Shadow DOM, encapsulated styles via adoptSheet().
 */
export interface AtlasCapabilityTileToggleDetail {
  value: string;
  selected: boolean;
}

const sheet = createSheet(`
  :host {
    display: block;
  }
  button {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--atlas-space-sm);
    align-items: start;
    width: 100%;
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-md);
    text-align: left;
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    cursor: pointer;
    font: inherit;
    font-family: var(--atlas-font-family);
    transition: background var(--atlas-transition-base, 150ms ease),
                border-color var(--atlas-transition-base, 150ms ease);
  }
  button:hover:not([aria-disabled="true"]) {
    background: var(--atlas-color-surface-hover, #f3f4f6);
  }
  button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  button[aria-pressed="true"] {
    border-color: var(--atlas-color-primary, #2563eb);
    background: var(--atlas-color-primary-subtle, #eff4ff);
    box-shadow: inset 0 0 0 1px var(--atlas-color-primary, #2563eb);
  }
  button[aria-disabled="true"] {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex: 0 0 auto;
    color: var(--atlas-color-text-muted);
  }
  button[aria-pressed="true"] .icon { color: var(--atlas-color-primary, #2563eb); }
  .text { min-width: 0; }
  .label {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-xs);
    font-weight: var(--atlas-font-weight-medium, 500);
    color: var(--atlas-color-text);
  }
  .label .checkmark {
    display: inline-flex;
    width: 16px;
    height: 16px;
    color: var(--atlas-color-primary, #2563eb);
    flex: 0 0 auto;
  }
  button:not([aria-pressed="true"]) .label .checkmark { visibility: hidden; }
  .description {
    margin-top: 2px;
    color: var(--atlas-color-text-muted);
    font-size: var(--atlas-font-size-sm);
  }
`);

export class AtlasCapabilityTile extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['value', 'label', 'description', 'selected', 'disabled'];
  }

  declare selected: boolean;
  declare disabled: boolean;
  static {
    Object.defineProperty(this.prototype, 'selected', AtlasElement.boolAttr('selected'));
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
  }

  private _built = false;
  private _btn: HTMLButtonElement | null = null;
  private _labelEl: HTMLElement | null = null;
  private _descEl: HTMLElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncAll();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'label') this._syncLabel();
    else if (name === 'description') this._syncDescription();
    else if (name === 'selected') this._syncSelected();
    else if (name === 'disabled') this._syncDisabled();
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', 'false');

    const iconWrap = document.createElement('span');
    iconWrap.className = 'icon';
    const slot = document.createElement('slot');
    slot.setAttribute('name', 'icon');
    iconWrap.appendChild(slot);

    const text = document.createElement('span');
    text.className = 'text';

    const label = document.createElement('span');
    label.className = 'label';

    const labelText = document.createElement('span');
    label.appendChild(labelText);

    const check = document.createElement('span');
    check.className = 'checkmark';
    check.setAttribute('aria-hidden', 'true');
    check.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l4 4 6-8"/></svg>';
    label.appendChild(check);

    const desc = document.createElement('span');
    desc.className = 'description';

    text.appendChild(label);
    text.appendChild(desc);

    btn.appendChild(iconWrap);
    btn.appendChild(text);
    root.appendChild(btn);

    btn.addEventListener('click', () => this._onClick());

    this._btn = btn;
    this._labelEl = labelText;
    this._descEl = desc;
    this._built = true;
  }

  private _syncAll(): void {
    this._syncLabel();
    this._syncDescription();
    this._syncSelected();
    this._syncDisabled();
  }

  private _syncLabel(): void {
    if (this._labelEl) this._labelEl.textContent = this.getAttribute('label') ?? '';
  }
  private _syncDescription(): void {
    if (this._descEl) this._descEl.textContent = this.getAttribute('description') ?? '';
  }
  private _syncSelected(): void {
    if (this._btn) this._btn.setAttribute('aria-pressed', this.selected ? 'true' : 'false');
  }
  private _syncDisabled(): void {
    if (!this._btn) return;
    if (this.disabled) this._btn.setAttribute('aria-disabled', 'true');
    else this._btn.removeAttribute('aria-disabled');
  }

  private _onClick(): void {
    if (this.disabled) return;
    this.selected = !this.selected;
    const value = this.getAttribute('value') ?? '';
    this.dispatchEvent(
      new CustomEvent<AtlasCapabilityTileToggleDetail>('toggle', {
        detail: { value, selected: this.selected },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

AtlasElement.define('atlas-capability-tile', AtlasCapabilityTile);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-capability-tile': AtlasCapabilityTile;
  }
}
