import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-breadcrumbs> — trail of `<atlas-breadcrumb-item>` segments.
 *
 * Wraps its slotted items in a `<nav aria-label="Breadcrumb">` with an
 * `<ol>` list semantics. The visual separator (default "/") is drawn by
 * the parent between siblings, so consumers don't author it themselves.
 *
 * Attributes:
 *   label     — accessible name (defaults to "Breadcrumb")
 *   separator — visual separator string (default "/"). Cosmetic only;
 *               not announced.
 *
 * Overflow strategy:
 *   On narrow viewports (or when the trail grows beyond the host's
 *   width), middle items collapse behind a "…" overflow button. The
 *   first and last items always remain visible; intermediate items are
 *   marked `collapsed` so CSS hides them. The overflow button is a
 *   menu button (`aria-haspopup="menu"`, `aria-expanded`) revealing a
 *   dropdown of the hidden links — keyboard accessible.
 *
 *   Measurement happens in a ResizeObserver attached in
 *   `connectedCallback`, NEVER in render() (per the constitution C13.4
 *   and the component-conventions render pipeline rule).
 */

const sheet = createSheet(`
  :host {
    display: block;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    color: var(--atlas-color-text-muted);
    min-width: 0;
  }
  nav { display: block; min-width: 0; }
  ol {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 0;
    list-style: none;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  li {
    display: inline-flex;
    align-items: center;
    min-width: 0;
  }
  li[data-part="sep"] {
    padding: 0 var(--atlas-space-xs);
    color: var(--atlas-color-text-muted);
    user-select: none;
    flex: 0 0 auto;
  }
  /* The overflow trigger looks like an item but is a button. */
  button.overflow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--atlas-touch-target-min, 44px);
    min-height: var(--atlas-touch-target-min, 44px);
    padding: 0 var(--atlas-space-sm);
    border: 1px solid transparent;
    border-radius: var(--atlas-radius-sm);
    background: transparent;
    color: var(--atlas-color-text-muted);
    font: inherit;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  button.overflow:hover { background: var(--atlas-color-surface); border-color: var(--atlas-color-border); }
  button.overflow:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  /* Dropdown — a menu of the collapsed items. Positioned beneath the
     overflow trigger via a wrapper. */
  .overflow-wrap {
    position: relative;
    display: inline-flex;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 50;
    min-width: 180px;
    margin: 0;
    padding: var(--atlas-space-xs);
    list-style: none;
    background: var(--atlas-color-bg);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    box-shadow: var(--atlas-shadow-md);
  }
  .menu[hidden] { display: none; }
  .menu li {
    display: block;
    min-width: 0;
  }
  .menu a {
    display: block;
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border-radius: var(--atlas-radius-sm);
    color: var(--atlas-color-text);
    text-decoration: none;
    min-height: var(--atlas-touch-target-min, 44px);
  }
  .menu a:hover { background: var(--atlas-color-surface); }
  .menu a:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -2px;
  }
`);

export class AtlasBreadcrumbs extends AtlasElement {
  declare label: string;
  declare separator: string;

  static {
    Object.defineProperty(this.prototype, 'label', AtlasElement.strAttr('label', 'Breadcrumb'));
    Object.defineProperty(this.prototype, 'separator', AtlasElement.strAttr('separator', '/'));
  }

  static override get observedAttributes(): readonly string[] {
    return ['label', 'separator'];
  }

  private _built = false;
  private _nav: HTMLElement | null = null;
  private _list: HTMLOListElement | null = null;
  private _overflowBtn: HTMLButtonElement | null = null;
  private _overflowItem: HTMLLIElement | null = null;
  private _menuList: HTMLUListElement | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  private _slotChangeHandler: (() => void) | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._render();

    // ResizeObserver fires when the host's width changes. We re-evaluate
    // overflow there — never inside render(). Fallback: also recompute
    // on window resize.
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._recomputeOverflow());
      this._resizeObserver.observe(this);
    }

    // Re-render when the slotted item list changes.
    const onMutate = (): void => {
      this._render();
    };
    this._slotChangeHandler = onMutate;
    this.addEventListener('slotchange', onMutate, true);

    document.addEventListener('click', this._onDocClick, true);
    this.addEventListener('keydown', this._onKey);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    if (this._slotChangeHandler) {
      this.removeEventListener('slotchange', this._slotChangeHandler, true);
      this._slotChangeHandler = null;
    }
    document.removeEventListener('click', this._onDocClick, true);
    this.removeEventListener('keydown', this._onKey);
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'label') this._syncLabel();
    if (name === 'separator') this._render();
  }

  private _isItem(el: Element): boolean {
    return el.tagName.toLowerCase() === 'atlas-breadcrumb-item';
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', this.getAttribute('label') ?? 'Breadcrumb');
    const ol = document.createElement('ol');
    nav.appendChild(ol);
    root.appendChild(nav);
    this._nav = nav;
    this._list = ol;
    this._built = true;
  }

  private _syncLabel(): void {
    if (!this._nav) return;
    this._nav.setAttribute('aria-label', this.getAttribute('label') ?? 'Breadcrumb');
  }

  /**
   * Rebuild the list around the slotted items. Each item gets wrapped
   * in an <li>, separated by inert separator <li>s. The overflow
   * trigger lives between the first item and the trailing window when
   * needed.
   */
  private _render(): void {
    if (!this._list) return;
    // Reset visual collapsed state on every render.
    const items = Array.from(this.children).filter(this._isItem) as HTMLElement[];
    for (const item of items) item.removeAttribute('collapsed');

    // Build the list. We use real <a>-style anchors via slotted items,
    // so the document tree is: ol > li > slot=item, li[sep], li > slot=item …
    const sep = this.getAttribute('separator') || '/';
    this._list.innerHTML = '';
    this._overflowBtn = null;
    this._overflowItem = null;
    this._menuList = null;

    items.forEach((item, i) => {
      const li = document.createElement('li');
      // Each slotted item lives in its own <slot name="..."> so the
      // assigned-node mapping is one-to-one. We use named slots indexed
      // by position to keep this stable across re-renders.
      const slotName = `item-${i}`;
      item.setAttribute('slot', slotName);
      const slot = document.createElement('slot');
      slot.setAttribute('name', slotName);
      li.appendChild(slot);
      this._list?.appendChild(li);
      if (i < items.length - 1) {
        const sepLi = document.createElement('li');
        sepLi.dataset['part'] = 'sep';
        sepLi.setAttribute('aria-hidden', 'true');
        sepLi.textContent = sep;
        this._list?.appendChild(sepLi);
      }
    });

    // Build the overflow trigger but keep it detached until measurement
    // says we need it.
    this._buildOverflowTrigger(items);

    // After layout, decide if any items must be collapsed.
    queueMicrotask(() => this._recomputeOverflow());
  }

  private _buildOverflowTrigger(items: HTMLElement[]): void {
    if (!this._list) return;
    const li = document.createElement('li');
    li.dataset['part'] = 'overflow';
    li.hidden = true;
    const wrap = document.createElement('span');
    wrap.className = 'overflow-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'overflow';
    btn.setAttribute('aria-label', 'Show hidden breadcrumbs');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '…';
    btn.addEventListener('click', () => this._toggleMenu());

    const menu = document.createElement('ul');
    menu.className = 'menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    // Pre-populate menu items (one per intermediate slotted item). Even
    // if collapsed flips frequently, the menu always lists every item
    // except the first and last; CSS-driven visibility is enough.
    items.slice(1, items.length - 1).forEach((item) => {
      const itemLabel = item.textContent?.trim() ?? '';
      const href = item.getAttribute('href') ?? '#';
      const mli = document.createElement('li');
      mli.setAttribute('role', 'none');
      const a = document.createElement('a');
      a.setAttribute('role', 'menuitem');
      a.setAttribute('href', href);
      a.textContent = itemLabel;
      mli.appendChild(a);
      menu.appendChild(mli);
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    li.appendChild(wrap);
    // Append at the end of the list; when shown, CSS order rule below
    // pushes it after the first item.
    this._list.appendChild(li);
    this._overflowBtn = btn;
    this._overflowItem = li;
    this._menuList = menu;
  }

  /**
   * Decide whether to collapse middle items. Strategy:
   *   1. Reset collapsed/hidden state.
   *   2. If `scrollWidth > clientWidth`, collapse the middle (positions
   *      1..N-2) and show the overflow trigger between item 0 and the
   *      trailing items.
   *   3. We progressively un-collapse from the right until either the
   *      trail fits or all middle items are visible.
   */
  private _recomputeOverflow(): void {
    if (!this._list) return;
    const items = Array.from(this.children).filter(this._isItem) as HTMLElement[];
    if (items.length <= 2) {
      // No middle to collapse; hide the trigger.
      if (this._overflowItem) this._overflowItem.hidden = true;
      return;
    }
    // Reset.
    for (const item of items) item.removeAttribute('collapsed');
    if (this._overflowItem) this._overflowItem.hidden = true;
    // Hide also the separator before the overflow trigger.
    const seps = Array.from(this._list.querySelectorAll<HTMLLIElement>('li[data-part="sep"]'));
    for (const s of seps) s.hidden = false;

    // Forced fit: if `scrollWidth <= clientWidth`, we're done.
    if (this._list.scrollWidth <= this._list.clientWidth + 1) return;

    // Collapse all middle items first; show the overflow trigger.
    const middle = items.slice(1, items.length - 1);
    for (const m of middle) m.setAttribute('collapsed', '');
    if (this._overflowItem) {
      this._overflowItem.hidden = false;
      // Position the trigger after the first item by reordering. Each
      // sep-li sits between adjacent items; moving the trigger is
      // simpler than rewiring siblings.
      this._list.insertBefore(this._overflowItem, this._list.children[1] ?? null);
    }
    // Hide every sep that flanks a collapsed item EXCEPT the one
    // separating the overflow trigger from the trailing item.
    this._reflowSeparators(items);

    // Try un-collapsing from the right while still fitting.
    for (let k = middle.length - 1; k >= 0; k--) {
      const item = middle[k];
      if (!item) continue;
      item.removeAttribute('collapsed');
      this._reflowSeparators(items);
      if (this._list.scrollWidth > this._list.clientWidth + 1) {
        // Doesn't fit — re-collapse and stop.
        item.setAttribute('collapsed', '');
        this._reflowSeparators(items);
        break;
      }
    }
  }

  /**
   * Hide separators that sit next to a collapsed neighbour (so we don't
   * end up with "Home / / Item"). Always show the separator preceding
   * the overflow trigger and the separator preceding the first
   * un-collapsed trailing item.
   */
  private _reflowSeparators(items: HTMLElement[]): void {
    if (!this._list) return;
    const seps = Array.from(this._list.querySelectorAll<HTMLLIElement>('li[data-part="sep"]'));
    // Each sep sits between items[i] and items[i+1] (i = 0..n-2). We
    // hide it iff items[i+1] is collapsed.
    for (let i = 0; i < seps.length; i++) {
      const next = items[i + 1];
      const sep = seps[i];
      if (!sep) continue;
      sep.hidden = !!next && next.hasAttribute('collapsed');
    }
  }

  private _toggleMenu(): void {
    if (!this._overflowBtn || !this._menuList) return;
    const open = this._overflowBtn.getAttribute('aria-expanded') === 'true';
    this._setMenuOpen(!open);
  }

  private _setMenuOpen(open: boolean): void {
    if (!this._overflowBtn || !this._menuList) return;
    this._overflowBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    this._menuList.hidden = !open;
  }

  private readonly _onDocClick = (ev: Event): void => {
    if (!this._menuList || this._menuList.hidden) return;
    const target = ev.target;
    if (!(target instanceof Node)) return;
    if (this.contains(target)) return;
    this._setMenuOpen(false);
  };

  private readonly _onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && this._menuList && !this._menuList.hidden) {
      this._setMenuOpen(false);
      this._overflowBtn?.focus();
    }
  };
}

AtlasElement.define('atlas-breadcrumbs', AtlasBreadcrumbs);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-breadcrumbs': AtlasBreadcrumbs;
  }
}
