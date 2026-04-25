import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr } from './util.ts';

/**
 * <atlas-bottom-nav> + <atlas-bottom-nav-item> — thumb-reachable bottom
 * navigation tab bar (mobile chrome pattern).
 *
 * Differs from sibling primitives:
 *   - <atlas-tab-bar>  — segmented pill picker (in-chrome view switcher).
 *   - <atlas-tabs>     — content-tabs with underline indicator.
 *   - <atlas-nav>      — landmark wrapping a sidebar / vertical nav list.
 *   - <atlas-bottom-nav> is a horizontal, fixed-to-bottom bar of 3-5
 *     wide tap targets (icon + label) for top-level destinations on
 *     mobile, with safe-area inset padding.
 *
 * Composition (light-DOM children):
 *
 *   <atlas-bottom-nav name="primary" value="home" aria-label="Primary">
 *     <atlas-bottom-nav-item value="home" label="Home">
 *       <atlas-icon slot="icon" name="home"></atlas-icon>
 *     </atlas-bottom-nav-item>
 *     <atlas-bottom-nav-item value="inbox" label="Inbox" badge-count="3">
 *       <atlas-icon slot="icon" name="inbox"></atlas-icon>
 *     </atlas-bottom-nav-item>
 *     <atlas-bottom-nav-item value="me" label="Me">
 *       <atlas-icon slot="icon" name="user"></atlas-icon>
 *     </atlas-bottom-nav-item>
 *   </atlas-bottom-nav>
 *
 * The parent owns the active value: setting `value` on it flips
 * `aria-selected` and `aria-current="page"` on the matching child.
 *
 * ## Why role="tablist" and not role="navigation"
 *
 * The WAI-ARIA APG documents BOTH options for a bottom tab bar. We pick
 * `tablist` because:
 *   1. The interaction is "exactly one selected" — the canonical Tabs
 *      pattern. Arrow keys cycle, Enter/Space activates, focus follows
 *      selection. Wrapping in a redundant <nav> would just confuse SR
 *      users.
 *   2. Telemetry and tests can rely on the same conventions used by
 *      <atlas-tab-bar> / <atlas-tabs>.
 * The parent emits `change` (DOM event) AND, when `name` + `surfaceId`
 * are present, the telemetry event `${surfaceId}.${name}-changed`.
 *
 * Active item indicator is NOT colour-only (C3.11): the active label
 * uses font-weight: bold AND a top accent bar; non-active items keep
 * the default weight and no accent. Colour ALSO changes, but is
 * redundant.
 *
 * Mobile-first: fixed to bottom with `padding-bottom: env(safe-area-inset-bottom)`
 * so the bar clears the iOS home indicator. On ≥md viewports the bar
 * stays by default; set `hide-above="md"` (or `lg`) to drop it on
 * larger viewports — useful when an admin shell sidebar takes over.
 */

const sheet = createSheet(`
  :host {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    justify-content: space-around;
    box-sizing: border-box;
    width: 100%;
    background: var(--atlas-color-bg);
    border-top: 1px solid var(--atlas-color-border);
    /* Honour the iOS home-indicator inset so the bottom row of icons
       sits above the system gesture area. */
    padding-bottom: env(safe-area-inset-bottom, 0);
    /* Stick to the bottom of the nearest scroll container. Surfaces
       that need the bar as document-level chrome should set
       position: fixed; bottom: 0; on the host via consumer CSS. */
    position: sticky;
    bottom: 0;
    z-index: 20;
  }
  /* hide-above="md" — drop bar at the md breakpoint (R1.1: 900px) */
  @media (min-width: 900px) {
    :host([hide-above="md"]) { display: none; }
  }
  @media (min-width: 1200px) {
    :host([hide-above="lg"]) { display: none; }
  }
  ::slotted(atlas-bottom-nav-item) {
    flex: 1 1 0;
    min-width: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    :host { transition: none; }
  }
`);

const itemSheet = createSheet(`
  :host {
    /* 56×56 minimum tap target (R3.1 plus the spec's explicit 56). */
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    box-sizing: border-box;
    min-width: 56px;
    min-height: 56px;
    padding: 6px var(--atlas-space-xs);
    background: transparent;
    color: var(--atlas-color-text-muted);
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-xs);
    font-weight: var(--atlas-font-weight-normal);
    line-height: 1.2;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    text-align: center;
    position: relative;
    transition:
      color var(--atlas-transition-fast),
      background var(--atlas-transition-fast);
    outline: none;
  }
  :host([disabled]) {
    color: var(--atlas-color-text-disabled, var(--atlas-color-text-muted));
    pointer-events: none;
    opacity: 0.6;
  }
  :host(:focus-visible) {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -2px;
  }
  :host(:hover) {
    color: var(--atlas-color-text);
    background: var(--atlas-color-surface-hover);
  }
  /* Active state — NOT colour-only (C3.11). Bold weight + top accent
     bar in addition to the colour change. */
  :host([aria-selected="true"]) {
    color: var(--atlas-color-primary);
    font-weight: var(--atlas-font-weight-medium);
  }
  :host([aria-selected="true"]) .indicator {
    background: var(--atlas-color-primary);
  }
  .indicator {
    position: absolute;
    top: 0;
    left: 25%;
    right: 25%;
    height: 3px;
    border-radius: 0 0 2px 2px;
    background: transparent;
    transition: background var(--atlas-transition-fast);
  }
  .icon-row {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    line-height: 1;
  }
  .label {
    /* fluid xs label — never wraps. */
    font-size: var(--atlas-font-size-xs);
    line-height: 1.1;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  ::slotted([slot="icon"]) {
    width: 22px;
    height: 22px;
  }
  /* Badge floats top-right of the icon */
  .badge-host {
    position: absolute;
    top: -4px;
    right: -10px;
    pointer-events: none;
  }
  @media (hover: none) {
    :host(:hover) {
      color: var(--atlas-color-text-muted);
      background: transparent;
    }
    :host([aria-selected="true"]:hover) {
      color: var(--atlas-color-primary);
    }
  }
`);

export interface AtlasBottomNavChangeDetail {
  value: string;
  previousValue: string | null;
}

/* ------------------------------------------------------------------ */
/* <atlas-bottom-nav>                                                  */
/* ------------------------------------------------------------------ */

export class AtlasBottomNav extends AtlasElement {
  declare hideAbove: string;

  static {
    Object.defineProperty(
      this.prototype,
      'hideAbove',
      AtlasElement.strAttr('hide-above', ''),
    );
  }

  static override get observedAttributes(): readonly string[] {
    return ['value', 'name'];
  }

  private _built = false;
  private _slot: HTMLSlotElement | null = null;
  private _slotChangeBound = (): void => this._syncItems();
  private _itemKeyBound = (e: KeyboardEvent): void => this._onKey(e);
  private _itemClickBound = (e: Event): void => this._onClick(e);

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) {
      this._buildShell();
      this._built = true;
    }
    this.setAttribute('role', 'tablist');
    if (!this.hasAttribute('aria-orientation')) {
      this.setAttribute('aria-orientation', 'horizontal');
    }
    this.addEventListener('keydown', this._itemKeyBound);
    this.addEventListener('click', this._itemClickBound);
    this._syncItems();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this._itemKeyBound);
    this.removeEventListener('click', this._itemClickBound);
    if (this._slot) this._slot.removeEventListener('slotchange', this._slotChangeBound);
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'value' || name === 'name') {
      this._syncItems();
    }
  }

  get value(): string | null {
    return this.getAttribute('value');
  }
  set value(next: string | null) {
    if (next == null) this.removeAttribute('value');
    else this.setAttribute('value', String(next));
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    adoptSheet(root, sheet);
    const slot = document.createElement('slot');
    this._slot = slot;
    slot.addEventListener('slotchange', this._slotChangeBound);
    root.appendChild(slot);
  }

  private _items(): AtlasBottomNavItem[] {
    return Array.from(
      this.querySelectorAll<AtlasBottomNavItem>(':scope > atlas-bottom-nav-item'),
    );
  }

  private _syncItems(): void {
    const value = this.getAttribute('value');
    const barName = this.getAttribute('name');
    const sid = this.surfaceId;
    const items = this._items();
    let activeIndex = -1;
    items.forEach((item, idx) => {
      const v = item.getAttribute('value');
      const isActive = v != null && v === value;
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) {
        item.setAttribute('aria-current', 'page');
        item.setAttribute('tabindex', '0');
        activeIndex = idx;
      } else {
        item.removeAttribute('aria-current');
        item.setAttribute('tabindex', '-1');
      }
      // Auto-testid for items: `${surfaceId}.${barName}.${value}` —
      // mirrors the tab-bar convention so tests can target items by
      // their stable value, not their label.
      if (sid && barName && v) {
        item.setAttribute('data-testid', `${sid}.${barName}.${v}`);
      }
    });
    // If nothing is active, fall back to making the first item focusable.
    if (activeIndex === -1 && items.length > 0) {
      items[0]!.setAttribute('tabindex', '0');
    }
  }

  private _onClick(e: Event): void {
    const path = e.composedPath();
    const item = path.find(
      (n): n is AtlasBottomNavItem =>
        n instanceof Element && n.tagName === 'ATLAS-BOTTOM-NAV-ITEM',
    );
    if (!item) return;
    if (item.hasAttribute('disabled')) return;
    const value = item.getAttribute('value');
    if (value != null) this._select(value);
  }

  private _onKey(e: KeyboardEvent): void {
    const items = this._items().filter((it) => !it.hasAttribute('disabled'));
    if (items.length === 0) return;
    const active = (e.target as HTMLElement | null)?.closest(
      'atlas-bottom-nav-item',
    ) as AtlasBottomNavItem | null;
    const idx = active ? items.indexOf(active) : -1;
    let next = idx;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = idx < 0 ? 0 : (idx + 1) % items.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'Enter':
      case ' ': {
        if (active) {
          const v = active.getAttribute('value');
          if (v != null) {
            e.preventDefault();
            this._select(v);
          }
        }
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    const target = items[next];
    if (!target) return;
    target.focus();
    const v = target.getAttribute('value');
    if (v != null) this._select(v);
  }

  private _select(value: string): void {
    const previousValue = this.getAttribute('value');
    if (previousValue === value) return;
    this.setAttribute('value', value);
    // attributeChangedCallback will re-sync.
    this.dispatchEvent(
      new CustomEvent<AtlasBottomNavChangeDetail>('change', {
        detail: { value, previousValue },
        bubbles: true,
        composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-changed`, { value });
    }
  }
}

AtlasElement.define('atlas-bottom-nav', AtlasBottomNav);

/* ------------------------------------------------------------------ */
/* <atlas-bottom-nav-item>                                             */
/* ------------------------------------------------------------------ */

export class AtlasBottomNavItem extends AtlasElement {
  declare disabled: boolean;
  declare badgeCount: string;

  static {
    Object.defineProperty(
      this.prototype,
      'disabled',
      AtlasElement.boolAttr('disabled'),
    );
    Object.defineProperty(
      this.prototype,
      'badgeCount',
      AtlasElement.strAttr('badge-count', ''),
    );
  }

  static override get observedAttributes(): readonly string[] {
    return ['label', 'badge-count', 'disabled'];
  }

  private _built = false;
  private _labelEl: HTMLElement | null = null;
  private _badgeHost: HTMLElement | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) {
      this._buildShell();
      this._built = true;
    }
    // role / aria-selected are managed by the parent <atlas-bottom-nav>.
    if (!this.hasAttribute('tabindex')) {
      this.setAttribute('tabindex', '-1');
    }
    this._syncLabel();
    this._syncBadge();
    this._syncDisabled();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'label') this._syncLabel();
    if (name === 'badge-count') this._syncBadge();
    if (name === 'disabled') this._syncDisabled();
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    adoptSheet(root, itemSheet);

    // Top accent indicator (purely visual; not announced).
    const indicator = document.createElement('span');
    indicator.className = 'indicator';
    indicator.setAttribute('aria-hidden', 'true');

    // Icon + badge stack.
    const iconRow = document.createElement('span');
    iconRow.className = 'icon-row';
    const iconSlot = document.createElement('slot');
    iconSlot.setAttribute('name', 'icon');
    iconRow.appendChild(iconSlot);
    const badgeHost = document.createElement('span');
    badgeHost.className = 'badge-host';
    badgeHost.setAttribute('aria-hidden', 'true');
    iconRow.appendChild(badgeHost);
    this._badgeHost = badgeHost;

    // Label (text from the `label` attribute).
    const label = document.createElement('span');
    label.className = 'label';
    this._labelEl = label;

    root.append(indicator, iconRow, label);
  }

  private _syncLabel(): void {
    if (!this._labelEl) return;
    // textContent is auto-escaped by the DOM — safe for user content.
    this._labelEl.textContent = this.getAttribute('label') ?? '';
    // Provide accessible name for AT users via the host's aria-label
    // when none has been provided externally.
    if (!this.hasAttribute('aria-label')) {
      const lbl = this.getAttribute('label');
      if (lbl) this.setAttribute('aria-label', lbl);
    }
  }

  private _syncBadge(): void {
    if (!this._badgeHost) return;
    const raw = this.getAttribute('badge-count');
    this._badgeHost.replaceChildren();
    if (!raw) return;
    // Coerce numeric counts to a "99+" cap; otherwise render the raw
    // string verbatim. Reuses <atlas-badge> rather than reimplementing
    // the pill — light-DOM composition (the badge sits inside our
    // shadow tree, but it's still a child element with its own shadow).
    const n = Number(raw);
    let display: string;
    if (Number.isFinite(n)) {
      const i = Math.max(0, Math.floor(n));
      if (i === 0) return;
      display = i > 99 ? '99+' : String(i);
    } else {
      display = raw;
    }
    const badge = document.createElement('atlas-badge');
    badge.setAttribute('status', 'draft');
    // Append via DOM, not innerHTML — display already a primitive string.
    badge.textContent = display;
    // Defensive — if the consumer somehow pushed HTML in, escape it for
    // any later toString conversions.
    badge.setAttribute('data-count', escapeAttr(display));
    this._badgeHost.appendChild(badge);
  }

  private _syncDisabled(): void {
    if (this.hasAttribute('disabled')) {
      this.setAttribute('aria-disabled', 'true');
      this.setAttribute('tabindex', '-1');
    } else {
      this.removeAttribute('aria-disabled');
    }
  }
}

AtlasElement.define('atlas-bottom-nav-item', AtlasBottomNavItem);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-bottom-nav': AtlasBottomNav;
    'atlas-bottom-nav-item': AtlasBottomNavItem;
  }
}
