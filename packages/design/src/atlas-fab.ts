import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-fab> — floating action button.
 *
 * Positioned `position: fixed` at a corner of the viewport (mobile-first
 * default: bottom-right). On wider viewports the FAB optionally renders
 * as an extended FAB with the `label` attribute shown next to the icon.
 *
 * Slots:
 *   default — leading icon (e.g. <atlas-icon name="add">). Treat the
 *             slot as decorative; the accessible name comes from
 *             `label` or `aria-label`.
 *
 * Attributes:
 *   position  — bottom-right (default) | bottom-left | bottom-center
 *   label     — text label. When set + viewport ≥640px (or `extended`
 *               attribute is present), the FAB shows the label next to
 *               the icon. Always used as the accessible name fallback.
 *   extended  — (boolean) force-enable the extended-FAB layout.
 *   disabled  — (boolean)
 *
 * Events:
 *   native click bubbles. When both `surfaceId` and `name` are present,
 *   also emits `${surfaceId}.${name}-clicked` via this.emit(...).
 */

const sheet = createSheet(`
  :host {
    /* Size + container — 56×56 default, mobile-first. Sits above almost
       everything. */
    position: fixed;
    z-index: 60;
    width: 56px;
    height: 56px;
    bottom: max(env(safe-area-inset-bottom, 0px), var(--atlas-space-lg, 16px));
    --atlas-fab-side: var(--atlas-space-lg, 16px);
  }
  /* Position presets. */
  :host([position="bottom-left"]) {
    left: max(env(safe-area-inset-left, 0px), var(--atlas-fab-side));
    right: auto;
  }
  :host([position="bottom-center"]) {
    left: 50%;
    transform: translateX(-50%);
    right: auto;
  }
  /* Default = bottom-right */
  :host(:not([position])),
  :host([position="bottom-right"]) {
    right: max(env(safe-area-inset-right, 0px), var(--atlas-fab-side));
    left: auto;
  }

  button {
    /* Native button fully fills the host. Min 44×44 enforced by host
       sizing, plus an inner min for safety. */
    width: 100%;
    height: 100%;
    min-width: var(--atlas-touch-target-min, 44px);
    min-height: var(--atlas-touch-target-min, 44px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--atlas-space-sm);
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: var(--atlas-color-primary);
    color: var(--atlas-color-text-inverse);
    cursor: pointer;
    box-shadow: var(--atlas-shadow-lg);
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-md);
    font-weight: var(--atlas-font-weight-medium, 500);
    -webkit-tap-highlight-color: transparent;
    transition: background var(--atlas-transition-fast, 100ms ease),
                box-shadow var(--atlas-transition-fast, 100ms ease),
                transform var(--atlas-transition-fast, 100ms ease);
  }
  button:hover { background: var(--atlas-color-primary-hover); }
  button:active { transform: translateY(1px); }
  button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 3px;
  }
  button[disabled] {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .label {
    display: none;
    white-space: nowrap;
    padding-right: var(--atlas-space-md);
  }
  /* Extended FAB on wider viewports OR when host[extended] is set. */
  @media (min-width: 640px) {
    :host([label]) {
      width: auto;
      height: 56px;
      min-width: 56px;
    }
    :host([label]) button {
      padding: 0 var(--atlas-space-md);
    }
    :host([label]) .label {
      display: inline;
    }
  }
  :host([extended][label]) {
    width: auto;
    height: 56px;
  }
  :host([extended][label]) button {
    padding: 0 var(--atlas-space-md);
  }
  :host([extended][label]) .label {
    display: inline;
  }
  /* Center-aligned variant on wider viewports — keep transform but allow
     width to grow without breaking the centering. */
  @media (min-width: 640px) {
    :host([position="bottom-center"][label]) {
      transform: translateX(-50%);
    }
  }
  @media (hover: none) {
    button:hover { background: var(--atlas-color-primary); }
  }
  @media (prefers-reduced-motion: reduce) {
    button { transition: none; }
  }
`);

export class AtlasFab extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['label', 'disabled', 'position', 'extended'];
  }

  declare label: string;
  declare position: string;
  declare disabled: boolean;
  declare extended: boolean;

  static {
    Object.defineProperty(
      this.prototype,
      'label',
      AtlasElement.strAttr('label', ''),
    );
    Object.defineProperty(
      this.prototype,
      'position',
      AtlasElement.strAttr('position', 'bottom-right'),
    );
    Object.defineProperty(
      this.prototype,
      'disabled',
      AtlasElement.boolAttr('disabled'),
    );
    Object.defineProperty(
      this.prototype,
      'extended',
      AtlasElement.boolAttr('extended'),
    );
  }

  private _built = false;
  private _btn: HTMLButtonElement | null = null;
  private _labelEl: HTMLElement | null = null;

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
    this._sync(name);
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    const slot = document.createElement('slot');
    btn.appendChild(slot);
    const label = document.createElement('span');
    label.className = 'label';
    btn.appendChild(label);
    root.appendChild(btn);

    btn.addEventListener('click', (ev) => {
      if (this.hasAttribute('disabled')) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        return;
      }
      const name = this.getAttribute('name');
      if (this.surfaceId && name) {
        this.emit(`${this.surfaceId}.${name}-clicked`, {
          label: this.getAttribute('label') ?? '',
        });
      }
    });

    this._btn = btn;
    this._labelEl = label;
    this._built = true;
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('disabled');
  }

  private _sync(name: string): void {
    if (!this._btn) return;
    if (name === 'label') {
      const label = this.getAttribute('label') ?? '';
      if (this._labelEl) this._labelEl.textContent = label;
      // The accessible name is whichever is more specific: explicit
      // aria-label on the host wins; otherwise fall back to `label`.
      if (!this.hasAttribute('aria-label') && label) {
        this._btn.setAttribute('aria-label', label);
      } else if (!label) {
        this._btn.removeAttribute('aria-label');
      } else {
        this._btn.setAttribute('aria-label', label);
      }
    } else if (name === 'disabled') {
      if (this.hasAttribute('disabled')) {
        this._btn.setAttribute('disabled', '');
        this._btn.setAttribute('aria-disabled', 'true');
      } else {
        this._btn.removeAttribute('disabled');
        this._btn.removeAttribute('aria-disabled');
      }
    }
  }
}

AtlasElement.define('atlas-fab', AtlasFab);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-fab': AtlasFab;
  }
}
