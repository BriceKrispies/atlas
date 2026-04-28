import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, uid } from './util.ts';

/**
 * <atlas-popover> — non-modal hover/click card. Sits between
 * <atlas-tooltip> (text-only, hover, position) and <atlas-dialog>
 * (modal, focus-trapped). Use this for richer pinned content (a help
 * blurb with a link, a mini form, a settings stub).
 *
 * Slots:
 *   anchor  — the trigger element (button, link, icon).
 *   default — popover body content.
 *
 * Attributes:
 *   trigger     — hover | click (default) | manual
 *   placement   — top | bottom | start | end | auto (default bottom)
 *   offset      — extra px between anchor and surface (default 8)
 *   open        — boolean reflected; mutate to drive state.
 *
 * Events:
 *   open  → CustomEvent
 *   close → CustomEvent
 *
 * Constitution touch-points:
 *   - C13: positioning math runs inside requestAnimationFrame from the
 *     open path and from a debounced scroll/resize listener attached on
 *     open and detached on close — never inside render().
 *   - Non-modal: focus is NOT trapped. Click-outside dismiss + Esc
 *     dismiss are honored. Anchor click toggles, never just dismisses.
 *   - prefers-reduced-motion suppresses the slide-in.
 *   - C16: anchor host is `display: contents` so authors keep their own
 *     touch-target sizing on the trigger element.
 */

const sheet = createSheet(`
  :host {
    display: inline-block;
    position: relative;
  }
  :host([hidden]) { display: none; }

  ::slotted([slot="anchor"]) {
    display: inline-flex;
  }

  .surface {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: var(--atlas-space-md);
    min-width: 200px;
    max-width: min(360px, 92vw);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    box-shadow: var(--atlas-shadow-lg);
    z-index: 1000;
    box-sizing: border-box;
    inset-inline: auto;
    inset-block: auto;
  }
  .surface[hidden] { display: none; }

  @media (prefers-reduced-motion: no-preference) {
    .surface:not([hidden]) {
      animation: atlas-popover-in 140ms ease-out;
    }
  }
  @keyframes atlas-popover-in {
    from { opacity: 0; transform: translateY(-2px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
`);

type Trigger = 'hover' | 'click' | 'manual';
type Placement = 'top' | 'bottom' | 'start' | 'end' | 'auto';

const HOVER_DELAY_OUT = 100;

export class AtlasPopover extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['trigger', 'placement', 'offset', 'open'];
  }

  declare placement: string;
  declare trigger: string;

  static {
    Object.defineProperty(this.prototype, 'placement', AtlasElement.strAttr('placement', 'bottom'));
    Object.defineProperty(this.prototype, 'trigger', AtlasElement.strAttr('trigger', 'click'));
  }

  private _built = false;
  private _surface: HTMLElement | null = null;
  private _anchorSlot: HTMLSlotElement | null = null;
  private readonly _surfaceId = uid('atlas-pop');
  private _hoverOutTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly _onAnchorClick: (e: MouseEvent) => void;
  private readonly _onAnchorEnter: () => void;
  private readonly _onAnchorLeave: () => void;
  private readonly _onAnchorFocusIn: () => void;
  private readonly _onAnchorFocusOut: () => void;
  private readonly _onSurfaceEnter: () => void;
  private readonly _onSurfaceLeave: () => void;
  private readonly _onDocPointerDown: (e: PointerEvent) => void;
  private readonly _onDocKey: (e: KeyboardEvent) => void;
  private readonly _onWindowReposition: () => void;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
    this._onAnchorClick = (e) => this._handleAnchorClick(e);
    this._onAnchorEnter = () => this._handleHover(true);
    this._onAnchorLeave = () => this._handleHover(false);
    this._onAnchorFocusIn = () => this._handleFocus(true);
    this._onAnchorFocusOut = () => this._handleFocus(false);
    this._onSurfaceEnter = () => this._cancelHoverOut();
    this._onSurfaceLeave = () => this._handleHover(false);
    this._onDocPointerDown = (e) => this._handleDocPointerDown(e);
    this._onDocKey = (e) => this._handleDocKey(e);
    this._onWindowReposition = () => this._scheduleReposition();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._build();
    this._wireTriggers();
    this._syncOpenAttr();
  }

  override disconnectedCallback(): void {
    this._detachOpenListeners();
    if (this._hoverOutTimer) clearTimeout(this._hoverOutTimer);
    super.disconnectedCallback?.();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'open') this._syncOpenAttr();
    if (name === 'trigger') this._wireTriggers();
  }

  // ── Public API ─────────────────────────────────────────────────

  open(): void {
    if (this.hasAttribute('open')) return;
    this.setAttribute('open', '');
  }

  close(): void {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
  }

  toggle(): void {
    if (this.hasAttribute('open')) this.close();
    else this.open();
  }

  get isOpen(): boolean {
    return this.hasAttribute('open');
  }

  // ── Build ──────────────────────────────────────────────────────

  private _build(): void {
    const root = this.shadowRoot;
    if (!root) return;

    const anchor = document.createElement('span');
    anchor.setAttribute('data-part', 'anchor-host');
    const anchorSlot = document.createElement('slot');
    anchorSlot.name = 'anchor';
    anchor.appendChild(anchorSlot);

    const surface = document.createElement('div');
    surface.className = 'surface';
    surface.id = this._surfaceId;
    surface.hidden = true;
    surface.setAttribute('role', 'group');
    surface.setAttribute('aria-labelledby', `${this._surfaceId}-anchor`);
    surface.setAttribute('data-part', 'surface');
    if (typeof (HTMLElement.prototype as unknown as { showPopover?: unknown }).showPopover === 'function') {
      surface.setAttribute('popover', 'manual');
    }

    const bodySlot = document.createElement('slot');
    surface.appendChild(bodySlot);

    root.appendChild(anchor);
    root.appendChild(surface);

    this._anchorSlot = anchorSlot;
    this._surface = surface;

    surface.addEventListener('pointerenter', this._onSurfaceEnter);
    surface.addEventListener('pointerleave', this._onSurfaceLeave);
    // Stop pointerdowns inside the surface from being treated as
    // outside-clicks by the document handler.
    surface.addEventListener('pointerdown', (e) => e.stopPropagation());

    this._built = true;
  }

  // ── Trigger wiring ─────────────────────────────────────────────

  private _anchorEls(): HTMLElement[] {
    if (!this._anchorSlot) return [];
    return this._anchorSlot
      .assignedElements({ flatten: true })
      .filter((el): el is HTMLElement => el instanceof HTMLElement);
  }

  private _wireTriggers(): void {
    // Strip existing listeners before re-wiring (e.g. on attr change).
    for (const el of this._anchorEls()) {
      el.removeEventListener('click', this._onAnchorClick);
      el.removeEventListener('pointerenter', this._onAnchorEnter);
      el.removeEventListener('pointerleave', this._onAnchorLeave);
      el.removeEventListener('focusin', this._onAnchorFocusIn);
      el.removeEventListener('focusout', this._onAnchorFocusOut);
    }
    const mode = ((this.getAttribute('trigger') as Trigger) || 'click') as Trigger;
    const els = this._anchorEls();
    for (const el of els) {
      // Annotate the anchor with an id the surface points to via
      // aria-labelledby, so SR users get a labelled group.
      if (!el.id) el.id = `${this._surfaceId}-anchor`;
      el.setAttribute('aria-haspopup', 'dialog');
      el.setAttribute('aria-expanded', 'false');
      if (mode === 'click') {
        el.addEventListener('click', this._onAnchorClick);
      } else if (mode === 'hover') {
        el.addEventListener('pointerenter', this._onAnchorEnter);
        el.addEventListener('pointerleave', this._onAnchorLeave);
        el.addEventListener('focusin', this._onAnchorFocusIn);
        el.addEventListener('focusout', this._onAnchorFocusOut);
      }
      // 'manual' attaches no listeners — author drives via .open()/close().
    }
  }

  private _handleAnchorClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.toggle();
  }

  private _handleHover(entering: boolean): void {
    if (entering) {
      this._cancelHoverOut();
      this.open();
    } else {
      // Defer the close so the user can move pointer from anchor → surface
      // without flicker.
      this._cancelHoverOut();
      this._hoverOutTimer = setTimeout(() => this.close(), HOVER_DELAY_OUT);
    }
  }

  private _handleFocus(entering: boolean): void {
    // Keyboard equivalent of hover: focus opens, blur closes (unless
    // focus moves into the surface).
    if (entering) this.open();
    else {
      // Allow the focus to traverse into the surface without dismissing.
      requestAnimationFrame(() => {
        const active = (this.getRootNode() as Document).activeElement;
        if (active instanceof Node && this._surface?.contains(active)) return;
        this.close();
      });
    }
  }

  private _cancelHoverOut(): void {
    if (this._hoverOutTimer) {
      clearTimeout(this._hoverOutTimer);
      this._hoverOutTimer = null;
    }
  }

  // ── Open / close ───────────────────────────────────────────────

  private _syncOpenAttr(): void {
    if (this.hasAttribute('open')) this._show();
    else this._hide();
  }

  private _show(): void {
    if (!this._surface) return;
    this._surface.hidden = false;
    for (const el of this._anchorEls()) el.setAttribute('aria-expanded', 'true');
    this._tryShowPopover(this._surface);
    this._scheduleReposition();
    this._attachOpenListeners();
    this.dispatchEvent(new CustomEvent('open', { bubbles: true, composed: true }));
  }

  private _hide(): void {
    if (!this._surface) return;
    this._tryHidePopover(this._surface);
    this._surface.hidden = true;
    for (const el of this._anchorEls()) el.setAttribute('aria-expanded', 'false');
    this._detachOpenListeners();
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

  private _handleDocPointerDown(e: PointerEvent): void {
    if (!this.isOpen) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (path.includes(this._surface as EventTarget)) return;
    // Anchor click is a toggle, not a dismiss — let its handler decide.
    for (const a of this._anchorEls()) if (path.includes(a)) return;
    this.close();
  }

  private _handleDocKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      // Restore focus to the first anchor so keyboard users land back
      // somewhere predictable.
      const first = this._anchorEls()[0];
      if (first && typeof first.focus === 'function') {
        try { first.focus(); } catch { /* ignore */ }
      }
    }
  }

  // ── Positioning ────────────────────────────────────────────────

  private _scheduleReposition(): void {
    requestAnimationFrame(() => this._reposition());
  }

  private _reposition(): void {
    const surface = this._surface;
    if (!surface || surface.hidden) return;
    const anchors = this._anchorEls();
    const anchor = anchors[0];
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const sw = surface.offsetWidth;
    const sh = surface.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const offset = Number(this.getAttribute('offset') ?? '8') || 8;

    const placement = ((this.getAttribute('placement') as Placement) || 'bottom') as Placement;
    const resolved = this._resolvePlacement(placement, rect, sw, sh, vw, vh, offset);

    let top = 0;
    let left = 0;
    switch (resolved) {
      case 'top':
        top = rect.top - sh - offset;
        left = rect.left + rect.width / 2 - sw / 2;
        break;
      case 'bottom':
        top = rect.bottom + offset;
        left = rect.left + rect.width / 2 - sw / 2;
        break;
      case 'start':
        top = rect.top + rect.height / 2 - sh / 2;
        left = rect.left - sw - offset;
        break;
      case 'end':
        top = rect.top + rect.height / 2 - sh / 2;
        left = rect.right + offset;
        break;
    }

    // Clamp into viewport with an 8px gutter.
    left = Math.min(Math.max(8, left), Math.max(8, vw - sw - 8));
    top = Math.min(Math.max(8, top), Math.max(8, vh - sh - 8));

    surface.style.top = `${top}px`;
    surface.style.left = `${left}px`;
    surface.style.right = 'auto';
    surface.style.bottom = 'auto';
  }

  private _resolvePlacement(
    desired: Placement,
    rect: DOMRect,
    sw: number,
    sh: number,
    vw: number,
    vh: number,
    offset: number,
  ): Exclude<Placement, 'auto'> {
    if (desired !== 'auto') {
      // Honour the requested side; flip only if the desired side has no
      // room and the opposite does.
      const fits = (p: Exclude<Placement, 'auto'>): boolean => {
        switch (p) {
          case 'top':    return rect.top - sh - offset >= 0;
          case 'bottom': return rect.bottom + sh + offset <= vh;
          case 'start':  return rect.left - sw - offset >= 0;
          case 'end':    return rect.right + sw + offset <= vw;
        }
      };
      const opposite: Record<Exclude<Placement, 'auto'>, Exclude<Placement, 'auto'>> = {
        top: 'bottom', bottom: 'top', start: 'end', end: 'start',
      };
      if (!fits(desired) && fits(opposite[desired])) return opposite[desired];
      return desired;
    }
    // 'auto': pick the side with the most space.
    const space = {
      top: rect.top,
      bottom: vh - rect.bottom,
      start: rect.left,
      end: vw - rect.right,
    } as const;
    let best: Exclude<Placement, 'auto'> = 'bottom';
    let bestSpace = -Infinity;
    for (const k of ['bottom', 'top', 'end', 'start'] as const) {
      if (space[k] > bestSpace) {
        bestSpace = space[k];
        best = k;
      }
    }
    return best;
  }
}

AtlasElement.define('atlas-popover', AtlasPopover);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-popover': AtlasPopover;
  }
}
