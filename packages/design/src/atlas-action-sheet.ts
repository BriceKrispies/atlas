import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, uid } from './util.ts';

/**
 * <atlas-action-sheet> — iOS-style sheet of actions presented from the
 * bottom edge on mobile, and as a centred dropdown-ish menu on wider
 * viewports. Uses native `<dialog>` for focus trap, Esc-to-close, and
 * inert-outside semantics.
 *
 * Composition:
 *   <atlas-action-sheet heading="Move file">
 *     <atlas-action-sheet-item value="copy">Copy</atlas-action-sheet-item>
 *     <atlas-action-sheet-item value="move" variant="primary">Move</atlas-action-sheet-item>
 *     <atlas-action-sheet-item value="delete" variant="destructive">Delete</atlas-action-sheet-item>
 *     <atlas-action-sheet-item value="cancel" cancel>Cancel</atlas-action-sheet-item>
 *   </atlas-action-sheet>
 *
 * API:
 *   .open(), .close(returnValue?)
 *
 * Attributes:
 *   open       — (boolean, reflected)
 *   heading    — optional title above the list
 *   description — optional sub-title below the heading
 *   dismissible — (boolean, default true)
 *
 * Events:
 *   action     — CustomEvent<{ value: string }> — fires when an item is
 *                chosen. Bubbles + composed.
 *   open / close
 */
export interface AtlasActionSheetActionDetail {
  value: string;
}

const sheet = createSheet(`
  :host {
    display: contents;
  }
  dialog {
    margin: 0;
    margin-top: auto;
    width: 100vw;
    max-width: 100vw;
    max-height: 90vh;
    padding: var(--atlas-space-md);
    border: 0;
    border-top-left-radius: var(--atlas-radius-lg);
    border-top-right-radius: var(--atlas-radius-lg);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    box-shadow: var(--atlas-shadow-lg);
    position: fixed;
    inset: auto 0 0 0;
    box-sizing: border-box;
  }
  dialog::backdrop {
    background: rgba(15, 18, 25, 0.45);
  }
  .head {
    text-align: center;
    padding: var(--atlas-space-xs) var(--atlas-space-md) var(--atlas-space-md);
  }
  .head[hidden] { display: none; }
  .head h2 {
    margin: 0;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-md);
    font-weight: var(--atlas-font-weight-medium, 500);
    color: var(--atlas-color-text);
  }
  .head p {
    margin: var(--atlas-space-xs) 0 0;
    font-size: var(--atlas-font-size-sm);
    color: var(--atlas-color-text-muted);
  }
  .group {
    display: flex;
    flex-direction: column;
    background: var(--atlas-color-surface);
    border-radius: var(--atlas-radius-md);
    overflow: hidden;
  }
  .group + .cancel-group {
    margin-top: var(--atlas-space-sm);
  }
  /* Slotted item rows. Touch target ≥44 enforced by atlas-action-sheet-item */
  ::slotted(atlas-action-sheet-item) {
    border-bottom: 1px solid var(--atlas-color-border);
  }
  ::slotted(atlas-action-sheet-item:last-of-type) {
    border-bottom: 0;
  }

  /* Mobile-first: edge-to-edge sheet. Wider viewports get a centred,
     narrower card. */
  @media (min-width: 640px) {
    dialog {
      width: min(420px, calc(100vw - 2 * var(--atlas-space-lg)));
      max-width: min(420px, calc(100vw - 2 * var(--atlas-space-lg)));
      inset: auto auto var(--atlas-space-xl) 50%;
      transform: translateX(-50%);
      border-radius: var(--atlas-radius-lg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    dialog { transition: none; }
  }
`);

export class AtlasActionSheet extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['open', 'heading', 'description', 'dismissible'];
  }

  declare dismissible: boolean;

  static {
    Object.defineProperty(
      this.prototype,
      'dismissible',
      AtlasElement.boolAttr('dismissible'),
    );
  }

  private readonly _headingId = uid('atlas-as-h');
  private _built = false;
  private _dialog: HTMLDialogElement | null = null;
  private _headWrap: HTMLElement | null = null;
  private _headHeading: HTMLElement | null = null;
  private _headDescription: HTMLElement | null = null;
  private _activeIndex = -1;

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

  open(): void {
    if (!this._dialog) return;
    if (!this._dialog.open) {
      this._dialog.showModal();
      if (!this.hasAttribute('open')) this.setAttribute('open', '');
      this._activeIndex = this._firstFocusableIndex();
      this._syncActive();
      this.dispatchEvent(
        new CustomEvent('open', { bubbles: true, composed: true }),
      );
    }
  }

  close(returnValue: string = ''): void {
    if (this._dialog?.open) this._dialog.close(returnValue);
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;

    const d = document.createElement('dialog');
    d.setAttribute('data-part', 'sheet');
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-labelledby', this._headingId);

    // Head (heading + description)
    const headWrap = document.createElement('div');
    headWrap.className = 'head';
    const h = document.createElement('h2');
    h.id = this._headingId;
    headWrap.appendChild(h);
    const p = document.createElement('p');
    headWrap.appendChild(p);

    // Two slots: default = action items; "cancel" = a sticky last item
    // (iOS-style "Cancel" button visually offset from the rest).
    const group = document.createElement('div');
    group.className = 'group';
    const itemsSlot = document.createElement('slot');
    itemsSlot.setAttribute('role', 'group');
    group.appendChild(itemsSlot);

    const cancelGroup = document.createElement('div');
    cancelGroup.className = 'group cancel-group';
    const cancelSlot = document.createElement('slot');
    cancelSlot.setAttribute('name', 'cancel');
    cancelGroup.appendChild(cancelSlot);

    cancelSlot.addEventListener('slotchange', () => {
      const has = cancelSlot.assignedNodes({ flatten: true }).length > 0;
      cancelGroup.style.display = has ? '' : 'none';
    });
    cancelGroup.style.display = 'none';

    d.appendChild(headWrap);
    d.appendChild(group);
    d.appendChild(cancelGroup);
    root.appendChild(d);

    d.addEventListener('close', () => {
      if (this.hasAttribute('open')) this.removeAttribute('open');
      this.dispatchEvent(
        new CustomEvent<{ returnValue: string }>('close', {
          detail: { returnValue: d.returnValue ?? '' },
          bubbles: true,
          composed: true,
        }),
      );
    });
    d.addEventListener('click', (ev) => {
      if (!this._isDismissible()) return;
      if (ev.target === d) d.close();
    });

    // Listen for action-item activation (CustomEvent bubbles from light DOM
    // children — composed=true means it crosses the shadow boundary).
    this.addEventListener('atlas-action-sheet-item:activate', (ev) => {
      const detail = (ev as CustomEvent<{ value: string }>).detail;
      this.dispatchEvent(
        new CustomEvent<AtlasActionSheetActionDetail>('action', {
          detail: { value: detail.value },
          bubbles: true,
          composed: true,
        }),
      );
      const name = this.getAttribute('name');
      if (name && this.surfaceId) {
        this.emit(`${this.surfaceId}.${name}-action`, { value: detail.value });
      }
      this.close(detail.value);
    });

    // Keyboard arrow-navigation across items.
    d.addEventListener('keydown', (ev) => this._onKey(ev));

    this._dialog = d;
    this._headWrap = headWrap;
    this._headHeading = h;
    this._headDescription = p;
    this._built = true;
  }

  private _items(): HTMLElement[] {
    // Combine default-slot and cancel-slot items, in order.
    const main = Array.from(
      this.querySelectorAll(':scope > atlas-action-sheet-item:not([slot])'),
    ) as HTMLElement[];
    const cancel = Array.from(
      this.querySelectorAll(':scope > atlas-action-sheet-item[slot="cancel"]'),
    ) as HTMLElement[];
    return [...main, ...cancel].filter((el) => !el.hasAttribute('disabled'));
  }

  private _firstFocusableIndex(): number {
    return this._items().length > 0 ? 0 : -1;
  }

  private _syncActive(): void {
    const items = this._items();
    items.forEach((el, i) => {
      if (i === this._activeIndex) {
        el.setAttribute('data-active', '');
        el.focus({ preventScroll: true });
      } else {
        el.removeAttribute('data-active');
      }
    });
  }

  private _onKey(ev: KeyboardEvent): void {
    const items = this._items();
    if (items.length === 0) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this._activeIndex = (this._activeIndex + 1) % items.length;
      this._syncActive();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this._activeIndex =
        (this._activeIndex - 1 + items.length) % items.length;
      this._syncActive();
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      this._activeIndex = 0;
      this._syncActive();
    } else if (ev.key === 'End') {
      ev.preventDefault();
      this._activeIndex = items.length - 1;
      this._syncActive();
    }
    // Enter / Space are handled inside the item itself.
  }

  private _syncAll(): void {
    this._syncHead();
    this._syncOpenAttr();
  }

  private _sync(name: string): void {
    if (name === 'open') this._syncOpenAttr();
    else if (name === 'heading' || name === 'description') this._syncHead();
  }

  private _syncOpenAttr(): void {
    if (!this._dialog) return;
    const want = this.hasAttribute('open');
    if (want && !this._dialog.open) this.open();
    else if (!want && this._dialog.open) this.close();
  }

  private _syncHead(): void {
    if (!this._headWrap || !this._headHeading || !this._headDescription) return;
    const heading = this.getAttribute('heading') ?? '';
    const description = this.getAttribute('description') ?? '';
    this._headHeading.textContent = heading;
    this._headDescription.textContent = description;
    if (description) {
      this._headDescription.style.display = '';
    } else {
      this._headDescription.style.display = 'none';
    }
    if (!heading && !description) {
      this._headWrap.setAttribute('hidden', '');
    } else {
      this._headWrap.removeAttribute('hidden');
    }
  }

  private _isDismissible(): boolean {
    return this.getAttribute('dismissible') !== 'false';
  }
}

AtlasElement.define('atlas-action-sheet', AtlasActionSheet);

/**
 * <atlas-action-sheet-item> — single row inside an atlas-action-sheet.
 * Renders a button with a 44×44 minimum touch target and dispatches a
 * composed `atlas-action-sheet-item:activate` CustomEvent on click /
 * Enter / Space, which the parent sheet handles.
 *
 * Attributes:
 *   value     — required identifier emitted in the parent sheet's
 *               `action` detail.
 *   variant   — default | primary | destructive
 *   disabled  — (boolean)
 *   cancel    — (boolean) styles this row as a sticky cancel option
 *               (use with slot="cancel" on the parent sheet).
 */
const itemSheet = createSheet(`
  :host {
    display: block;
  }
  button {
    width: 100%;
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border: 0;
    background: transparent;
    color: var(--atlas-color-text);
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-md);
    font-weight: var(--atlas-font-weight-medium, 500);
    cursor: pointer;
    text-align: center;
    -webkit-tap-highlight-color: transparent;
    transition: background var(--atlas-transition-fast, 100ms ease);
  }
  button:hover { background: var(--atlas-color-surface-hover); }
  button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -2px;
  }
  :host([data-active]) button { background: var(--atlas-color-surface-hover); }
  :host([variant="primary"]) button {
    color: var(--atlas-color-primary);
    font-weight: 600;
  }
  :host([variant="destructive"]) button {
    color: var(--atlas-color-danger);
    font-weight: 600;
  }
  :host([disabled]) button {
    opacity: 0.5;
    cursor: not-allowed;
  }
  @media (hover: none) {
    button:hover { background: transparent; }
  }
`);

export class AtlasActionSheetItem extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['disabled', 'variant'];
  }

  declare value: string;
  declare variant: string;
  declare disabled: boolean;
  declare cancel: boolean;

  static {
    Object.defineProperty(
      this.prototype,
      'value',
      AtlasElement.strAttr('value', ''),
    );
    Object.defineProperty(
      this.prototype,
      'variant',
      AtlasElement.strAttr('variant', 'default'),
    );
    Object.defineProperty(
      this.prototype,
      'disabled',
      AtlasElement.boolAttr('disabled'),
    );
    Object.defineProperty(
      this.prototype,
      'cancel',
      AtlasElement.boolAttr('cancel'),
    );
  }

  private _built = false;
  private _btn: HTMLButtonElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, itemSheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._sync('disabled');
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    this._sync(name);
  }

  /** Programmatic activation — dispatches the same activate event the
   * sheet listens for. Useful in tests. */
  activate(): void {
    if (this.hasAttribute('disabled')) return;
    const value = this.getAttribute('value') ?? '';
    this.dispatchEvent(
      new CustomEvent<{ value: string }>(
        'atlas-action-sheet-item:activate',
        { detail: { value }, bubbles: true, composed: true },
      ),
    );
  }

  override focus(options?: FocusOptions): void {
    this._btn?.focus(options);
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    const slot = document.createElement('slot');
    btn.appendChild(slot);
    root.appendChild(btn);
    btn.addEventListener('click', () => this.activate());
    btn.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        this.activate();
      }
    });
    this._btn = btn;
    this._built = true;
  }

  private _sync(name: string): void {
    if (!this._btn) return;
    if (name === 'disabled') {
      if (this.hasAttribute('disabled')) {
        this._btn.setAttribute('aria-disabled', 'true');
      } else {
        this._btn.removeAttribute('aria-disabled');
      }
    } else if (name === 'variant') {
      const v = this.getAttribute('variant') ?? 'default';
      if (v === 'destructive') {
        this._btn.setAttribute('aria-label', `${this._btn.textContent ?? ''} (destructive)`.trim());
      } else {
        this._btn.removeAttribute('aria-label');
      }
    }
  }
}

AtlasElement.define('atlas-action-sheet-item', AtlasActionSheetItem);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-action-sheet': AtlasActionSheet;
    'atlas-action-sheet-item': AtlasActionSheetItem;
  }
}
