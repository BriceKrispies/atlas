import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';
import './atlas-menu-item.ts';
import './atlas-menu-separator.ts';
import type { AtlasMenuItem } from './atlas-menu-item.ts';

/**
 * <atlas-menu> — dropdown / context menu. Authors declare items as light
 * children (`<atlas-menu-item>` / `<atlas-menu-separator>`). The menu
 * itself is rendered into a shadow shell that hosts the popup surface
 * and a `<slot>` that re-parents the items at render time. This means
 * styling and ARIA on items remain authored on the light DOM nodes (so
 * `name=` test ids still work for any item that opts in) while the menu
 * controls keyboard, focus and outside-dismiss in shadow.
 *
 * Anchoring:
 *   - If `anchor="#id"` is set, that element is the trigger. The menu
 *     wires click + long-press handlers on it.
 *   - Otherwise the immediately preceding light DOM sibling of the
 *     <atlas-menu> is treated as the trigger.
 *   - Programmatic `.open(anchorEl?)` accepts an explicit anchor and is
 *     useful for synthesised context-menu invocations.
 *
 * Positioning prefers the native popover API + CSS anchor positioning
 * when supported; falls back to absolute math driven by
 * `getBoundingClientRect` inside requestAnimationFrame on open and on
 * scroll/resize while open.
 *
 * Events:
 *   - `select`  → CustomEvent<{ value: string }> on item activation.
 *   - `open`    → CustomEvent
 *   - `close`   → CustomEvent
 *
 * Attributes:
 *   anchor       — CSS selector for the trigger element (optional).
 *   open         — boolean reflected; setting/removing toggles.
 *   placement    — bottom (default) | top | start | end.
 *   long-press   — boolean; if present, triggers also open on
 *                  >500ms touch hold (mobile context menu).
 *
 * Constitution touch-points:
 *   - C3.10: keyboard pattern — ↑/↓ cycle, Home/End, typeahead, Esc
 *     close, Enter/Space activate. Focus is trapped inside menu while
 *     open and restored to trigger on close.
 *   - C13: positioning math runs only inside requestAnimationFrame
 *     scheduled from `open()`; never inside render(). Scroll/resize
 *     listeners are added on open and detached on close.
 *   - C16: items are at least 44×44 on coarse pointers (asserted by
 *     `<atlas-menu-item>`'s own stylesheet).
 */

const LONG_PRESS_MS = 500;
const LONG_PRESS_TOLERANCE_PX = 8;

const sheet = createSheet(`
  :host { display: contents; }

  .surface {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 4px;
    min-width: 180px;
    max-width: min(360px, 92vw);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    box-shadow: var(--atlas-shadow-lg);
    z-index: 1000;
    box-sizing: border-box;
    overflow: auto;
    max-height: min(70vh, 480px);
    /* Reset native popover defaults so our positioning sticks. */
    inset-inline: auto;
    inset-block: auto;
  }
  .surface[hidden] { display: none; }
  .surface:not([hidden]) { display: block; }

  .surface:focus { outline: none; }

  /* When the host is rendered into a [popover] container the UA
     positions it; we still set position:fixed in JS via top/left. */

  @media (prefers-reduced-motion: no-preference) {
    .surface:not([hidden]) {
      animation: atlas-menu-in 120ms ease-out;
    }
  }
  @keyframes atlas-menu-in {
    from { opacity: 0; transform: translateY(-2px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`);

type Placement = 'top' | 'bottom' | 'start' | 'end';

export interface AtlasMenuSelectDetail {
  value: string;
}

export class AtlasMenu extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['anchor', 'open', 'placement', 'long-press'];
  }

  declare placement: string;

  static {
    Object.defineProperty(this.prototype, 'placement', AtlasElement.strAttr('placement', 'bottom'));
  }

  private _built = false;
  private _surface: HTMLElement | null = null;
  private _slot: HTMLSlotElement | null = null;
  private _activeIndex = -1;
  private _typeahead = '';
  private _typeaheadTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastAnchor: HTMLElement | null = null;
  private _previouslyFocused: Element | null = null;

  // Bound listeners we keep references to so we can detach.
  private readonly _onDocPointerDown: (e: PointerEvent) => void;
  private readonly _onDocKey: (e: KeyboardEvent) => void;
  private readonly _onWindowReposition: () => void;

  // Long-press (touch context menu) state.
  private _pressTimer: ReturnType<typeof setTimeout> | null = null;
  private _pressOrigin: { x: number; y: number } | null = null;
  private _pressTriggered = false;

  // Anchor handlers (kept so we can detach on disconnect / anchor swap).
  private _anchorEl: HTMLElement | null = null;
  private readonly _onAnchorClick: (e: MouseEvent) => void;
  private readonly _onAnchorPointerDown: (e: PointerEvent) => void;
  private readonly _onAnchorPointerMove: (e: PointerEvent) => void;
  private readonly _onAnchorPointerUp: () => void;
  private readonly _onAnchorContextMenu: (e: MouseEvent) => void;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);

    this._onDocPointerDown = (e) => this._handleDocPointerDown(e);
    this._onDocKey = (e) => this._handleDocKey(e);
    this._onWindowReposition = () => this._scheduleReposition();
    this._onAnchorClick = (e) => this._onAnchorActivate(e);
    this._onAnchorPointerDown = (e) => this._onAnchorPress(e);
    this._onAnchorPointerMove = (e) => this._onAnchorPressMove(e);
    this._onAnchorPointerUp = () => this._cancelLongPress();
    this._onAnchorContextMenu = (e) => this._onAnchorRightClick(e);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._build();
    this._wireAnchor();
    this._syncOpenAttr();
  }

  override disconnectedCallback(): void {
    this._teardownAnchor();
    this._detachOpenListeners();
    if (this._typeaheadTimer) clearTimeout(this._typeaheadTimer);
    this._cancelLongPress();
    super.disconnectedCallback?.();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'anchor') {
      this._teardownAnchor();
      this._wireAnchor();
    } else if (name === 'open') {
      this._syncOpenAttr();
    }
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Programmatic open. Pass an anchor to override the resolved one. */
  open(anchor?: HTMLElement): void {
    if (this.hasAttribute('open')) return;
    if (anchor) this._lastAnchor = anchor;
    else this._lastAnchor = this._resolveAnchor();
    this.setAttribute('open', '');
  }

  close(): void {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
  }

  toggle(anchor?: HTMLElement): void {
    if (this.hasAttribute('open')) this.close();
    else this.open(anchor);
  }

  get isOpen(): boolean {
    return this.hasAttribute('open');
  }

  // ── Build ──────────────────────────────────────────────────────

  private _build(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const surface = document.createElement('div');
    surface.className = 'surface';
    surface.setAttribute('role', 'menu');
    surface.setAttribute('tabindex', '-1');
    surface.hidden = true;
    surface.setAttribute('data-part', 'surface');
    // Use native popover API when available — gives us top-layer + UA
    // outside-light-dismiss for free. We still wire our own dismiss for
    // older browsers and to keep behaviour consistent.
    if (typeof (HTMLElement.prototype as unknown as { showPopover?: unknown }).showPopover === 'function') {
      surface.setAttribute('popover', 'manual');
    }

    const slot = document.createElement('slot');
    surface.appendChild(slot);
    root.appendChild(surface);

    this._surface = surface;
    this._slot = slot;

    // Item activation events bubble through the slot; intercept them
    // and translate to the public select event.
    surface.addEventListener('atlas-menu-item-activate', (e) => {
      const detail = (e as CustomEvent<{ value: string }>).detail;
      this._emitSelect(detail?.value ?? '');
      this.close();
    });

    surface.addEventListener('keydown', (e) => this._onSurfaceKey(e));
    // Stop pointerdowns originating inside the menu from triggering the
    // document-level outside-click handler.
    surface.addEventListener('pointerdown', (e) => e.stopPropagation());

    this._built = true;
  }

  // ── Anchor wiring ──────────────────────────────────────────────

  private _resolveAnchor(): HTMLElement | null {
    const sel = this.getAttribute('anchor');
    if (sel) {
      try {
        const root = this.getRootNode() as Document | ShadowRoot;
        const found = root.querySelector(sel);
        if (found instanceof HTMLElement) return found;
      } catch {
        /* invalid selector — ignore */
      }
    }
    // Fall back to the immediately preceding sibling.
    const prev = this.previousElementSibling;
    if (prev instanceof HTMLElement) return prev;
    return null;
  }

  private _wireAnchor(): void {
    const anchor = this._resolveAnchor();
    if (!anchor) return;
    this._anchorEl = anchor;
    if (!anchor.hasAttribute('aria-haspopup')) {
      anchor.setAttribute('aria-haspopup', 'menu');
    }
    anchor.setAttribute('aria-expanded', 'false');
    anchor.addEventListener('click', this._onAnchorClick);
    if (this.hasAttribute('long-press')) {
      anchor.addEventListener('pointerdown', this._onAnchorPointerDown);
      anchor.addEventListener('pointermove', this._onAnchorPointerMove);
      anchor.addEventListener('pointerup', this._onAnchorPointerUp);
      anchor.addEventListener('pointercancel', this._onAnchorPointerUp);
      anchor.addEventListener('pointerleave', this._onAnchorPointerUp);
      anchor.addEventListener('contextmenu', this._onAnchorContextMenu);
    }
  }

  private _teardownAnchor(): void {
    const anchor = this._anchorEl;
    if (!anchor) return;
    anchor.removeEventListener('click', this._onAnchorClick);
    anchor.removeEventListener('pointerdown', this._onAnchorPointerDown);
    anchor.removeEventListener('pointermove', this._onAnchorPointerMove);
    anchor.removeEventListener('pointerup', this._onAnchorPointerUp);
    anchor.removeEventListener('pointercancel', this._onAnchorPointerUp);
    anchor.removeEventListener('pointerleave', this._onAnchorPointerUp);
    anchor.removeEventListener('contextmenu', this._onAnchorContextMenu);
    this._anchorEl = null;
  }

  private _onAnchorActivate(e: MouseEvent): void {
    // If a long-press already fired, swallow the synthesised click.
    if (this._pressTriggered) {
      this._pressTriggered = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    this.toggle(e.currentTarget as HTMLElement);
  }

  private _onAnchorPress(e: PointerEvent): void {
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    this._pressOrigin = { x: e.clientX, y: e.clientY };
    this._pressTriggered = false;
    this._pressTimer = setTimeout(() => {
      this._pressTriggered = true;
      this.open(this._anchorEl ?? undefined);
    }, LONG_PRESS_MS);
  }

  private _onAnchorPressMove(e: PointerEvent): void {
    if (!this._pressOrigin || !this._pressTimer) return;
    const dx = e.clientX - this._pressOrigin.x;
    const dy = e.clientY - this._pressOrigin.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_TOLERANCE_PX) this._cancelLongPress();
  }

  private _cancelLongPress(): void {
    if (this._pressTimer) {
      clearTimeout(this._pressTimer);
      this._pressTimer = null;
    }
    this._pressOrigin = null;
  }

  private _onAnchorRightClick(e: MouseEvent): void {
    // When long-press is enabled we also catch the desktop context-menu
    // gesture and route it to our menu.
    e.preventDefault();
    this.open(this._anchorEl ?? undefined);
  }

  // ── Open / close lifecycle ─────────────────────────────────────

  private _syncOpenAttr(): void {
    if (this.hasAttribute('open')) this._show();
    else this._hide();
  }

  private _show(): void {
    if (!this._surface) return;
    this._previouslyFocused = (this.getRootNode() as Document).activeElement;
    this._surface.hidden = false;
    if (this._anchorEl) this._anchorEl.setAttribute('aria-expanded', 'true');
    this._tryShowPopover(this._surface);
    this._scheduleReposition();
    this._attachOpenListeners();
    // Focus first enabled item; if none, focus surface for Esc handling.
    queueMicrotask(() => {
      const items = this._items();
      const first = items.findIndex((i) => !i.disabled);
      this._setActive(first >= 0 ? first : -1);
      if (first < 0) this._surface?.focus();
    });
    this.dispatchEvent(new CustomEvent('open', { bubbles: true, composed: true }));
  }

  private _hide(): void {
    if (!this._surface) return;
    this._tryHidePopover(this._surface);
    this._surface.hidden = true;
    if (this._anchorEl) this._anchorEl.setAttribute('aria-expanded', 'false');
    this._detachOpenListeners();
    this._activeIndex = -1;
    this._items().forEach((i) => i.removeAttribute('data-active'));
    // Restore focus to the trigger (or wherever it came from) so keyboard
    // users land back where they started — required by C3.10.
    const restore = this._previouslyFocused as HTMLElement | null;
    if (restore && typeof restore.focus === 'function') {
      try { restore.focus(); } catch { /* ignore */ }
    } else if (this._anchorEl && typeof this._anchorEl.focus === 'function') {
      try { this._anchorEl.focus(); } catch { /* ignore */ }
    }
    this._previouslyFocused = null;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private _tryShowPopover(el: HTMLElement): void {
    const fn = (el as unknown as { showPopover?: () => void }).showPopover;
    if (typeof fn === 'function') {
      try { fn.call(el); } catch { /* already shown */ }
    }
  }

  private _tryHidePopover(el: HTMLElement): void {
    const fn = (el as unknown as { hidePopover?: () => void }).hidePopover;
    if (typeof fn === 'function') {
      try { fn.call(el); } catch { /* already hidden */ }
    }
  }

  private _attachOpenListeners(): void {
    document.addEventListener('pointerdown', this._onDocPointerDown, true);
    document.addEventListener('keydown', this._onDocKey, true);
    window.addEventListener('scroll', this._onWindowReposition, true);
    window.addEventListener('resize', this._onWindowReposition);
  }

  private _detachOpenListeners(): void {
    document.removeEventListener('pointerdown', this._onDocPointerDown, true);
    document.removeEventListener('keydown', this._onDocKey, true);
    window.removeEventListener('scroll', this._onWindowReposition, true);
    window.removeEventListener('resize', this._onWindowReposition);
  }

  // ── Outside / global handlers ──────────────────────────────────

  private _handleDocPointerDown(e: PointerEvent): void {
    if (!this.isOpen) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (path.includes(this._surface as EventTarget)) return;
    // Clicking the anchor itself should be a toggle, NOT a stray dismiss.
    if (this._anchorEl && path.includes(this._anchorEl)) return;
    this.close();
  }

  private _handleDocKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  // ── Keyboard inside the menu ───────────────────────────────────

  private _onSurfaceKey(e: KeyboardEvent): void {
    const items = this._items();
    if (items.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._setActive(this._nextEnabled(this._activeIndex, +1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._setActive(this._nextEnabled(this._activeIndex, -1));
        break;
      case 'Home':
        e.preventDefault();
        this._setActive(this._nextEnabled(-1, +1));
        break;
      case 'End':
        e.preventDefault();
        this._setActive(this._nextEnabled(items.length, -1));
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const item = items[this._activeIndex];
        if (item && !item.disabled) item.activate();
        break;
      }
      case 'Tab':
        // Trap focus inside menu — Tab cycles to next item.
        e.preventDefault();
        this._setActive(this._nextEnabled(this._activeIndex, e.shiftKey ? -1 : +1));
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          this._typeaheadTo(e.key.toLowerCase());
        }
    }
  }

  private _typeaheadTo(ch: string): void {
    this._typeahead += ch;
    if (this._typeaheadTimer) clearTimeout(this._typeaheadTimer);
    this._typeaheadTimer = setTimeout(() => { this._typeahead = ''; }, 600);
    const items = this._items();
    const start = Math.max(this._activeIndex, 0);
    const total = items.length;
    for (let off = 1; off <= total; off++) {
      const idx = (start + off) % total;
      const item = items[idx];
      if (!item || item.disabled) continue;
      if (item.textLabel.toLowerCase().startsWith(this._typeahead)) {
        this._setActive(idx);
        return;
      }
    }
  }

  private _items(): AtlasMenuItem[] {
    if (!this._slot) return [];
    const assigned = this._slot.assignedElements({ flatten: true });
    const items: AtlasMenuItem[] = [];
    for (const el of assigned) {
      if (el.tagName.toLowerCase() === 'atlas-menu-item') {
        items.push(el as AtlasMenuItem);
      }
    }
    return items;
  }

  private _nextEnabled(from: number, dir: 1 | -1): number {
    const items = this._items();
    const total = items.length;
    if (total === 0) return -1;
    let i = from;
    for (let step = 0; step < total; step++) {
      i = (i + dir + total) % total;
      const it = items[i];
      if (it && !it.disabled) return i;
    }
    return -1;
  }

  private _setActive(idx: number): void {
    const items = this._items();
    items.forEach((it, i) => {
      if (i === idx) {
        it.setAttribute('data-active', 'true');
        it.tabIndex = 0;
        it.focus();
      } else {
        it.removeAttribute('data-active');
        it.tabIndex = -1;
      }
    });
    this._activeIndex = idx;
  }

  private _emitSelect(value: string): void {
    this.dispatchEvent(
      new CustomEvent<AtlasMenuSelectDetail>('select', {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-selected`, { value });
    }
  }

  // ── Positioning ────────────────────────────────────────────────

  private _scheduleReposition(): void {
    requestAnimationFrame(() => this._reposition());
  }

  private _reposition(): void {
    const surface = this._surface;
    if (!surface || surface.hidden) return;
    const anchor = this._lastAnchor ?? this._anchorEl;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const placement = (this.getAttribute('placement') as Placement) || 'bottom';
    // Measure the surface AFTER it's visible so width/height reflect
    // actual content. Min-width is mirrored from the anchor for visual
    // alignment when there's room.
    surface.style.minWidth = `${Math.max(rect.width, 180)}px`;
    const sw = surface.offsetWidth;
    const sh = surface.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 4;

    let top = 0;
    let left = 0;
    switch (placement) {
      case 'top':
        top = rect.top - sh - gap;
        left = rect.left;
        break;
      case 'start':
        top = rect.top;
        left = rect.left - sw - gap;
        break;
      case 'end':
        top = rect.top;
        left = rect.right + gap;
        break;
      case 'bottom':
      default:
        top = rect.bottom + gap;
        left = rect.left;
    }

    // Flip if the chosen placement spills off-viewport.
    if (placement === 'bottom' && top + sh > vh && rect.top - sh - gap >= 0) {
      top = rect.top - sh - gap;
    } else if (placement === 'top' && top < 0 && rect.bottom + sh + gap <= vh) {
      top = rect.bottom + gap;
    }
    // Clamp into viewport.
    left = Math.min(Math.max(8, left), Math.max(8, vw - sw - 8));
    top = Math.min(Math.max(8, top), Math.max(8, vh - sh - 8));

    surface.style.top = `${top}px`;
    surface.style.left = `${left}px`;
    surface.style.right = 'auto';
    surface.style.bottom = 'auto';
  }
}

AtlasElement.define('atlas-menu', AtlasMenu);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-menu': AtlasMenu;
  }
}
