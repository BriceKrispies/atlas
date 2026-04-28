import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-swipe-actions> — row container that reveals trailing (and
 * optional leading) action buttons on horizontal swipe.
 *
 * Slots:
 *   leading-actions  — buttons revealed by swiping right (LTR).
 *   default          — the row content.
 *   trailing-actions — buttons revealed by swiping left (LTR).
 *
 * ─── Snap points ──────────────────────────────────────────────────────
 *   at-rest          — translate 0
 *   partially-open   — first action width past threshold
 *   fully-open       — total action width when dragged past second threshold
 *
 * ─── Keyboard contract (chosen: focus-revealed offscreen actions) ─────
 *   The actions in the leading/trailing slots remain real focusable
 *   buttons in the DOM. They are visually positioned offscreen at rest
 *   (clipped by overflow:hidden on the host) but are NOT removed from
 *   tab order — Tab moves through them naturally. When any action gains
 *   focus the row auto-opens to that side so it's visible. Pressing
 *   `Escape` while any descendant has focus closes the row.
 *
 *   Why this over `Space/Enter on row toggles open`?
 *     - Screen reader users get direct access to each action by name
 *       without having to discover a hidden gesture.
 *     - It keeps the visible action button hit area = the keyboard hit
 *       area; no secondary "menu mode" that desktop users can't see.
 *     - Tabbing into a long list still works — focus auto-revealing
 *       the row mirrors how mobile pull-to-reveal feels in pointer mode.
 *
 * Attributes:
 *   open      — at-rest (default) | partial-leading | full-leading |
 *               partial-trailing | full-trailing. Reflected.
 *   disabled  — fully blocks both gesture and keyboard reveal.
 *
 * Events (bubbling, composed):
 *   open   — CustomEvent<{ side: 'leading' | 'trailing'; full: boolean }>
 *   close  — CustomEvent<void>
 *   action — CustomEvent<{ side: 'leading' | 'trailing'; index: number }>
 *            fired when a slotted action button is activated.
 *
 * Constitutional notes:
 *   - C3.10 keyboard accessibility: every slotted action is a real
 *     focusable button; row auto-opens on focus reveal. Escape closes.
 *   - C16.2 touch targets: action buttons inside the leading/trailing
 *     slots are sized to a minimum of 44×44 via slotted ::part rules.
 *   - C13: pointer events drive transform-only animation; layout reads
 *     happen once at pointerdown to measure action panes.
 *   - R6.2 touch-action: `pan-y` on the row at rest (lets the page
 *     scroll vertically), `none` once we've captured the gesture.
 *   - prefers-reduced-motion: snap transition capped to 0ms.
 *
 * Note on splitting: action buttons are NOT a separate atlas-swipe-action
 * element. Consumers slot any focusable element (typically <atlas-button>);
 * the row owns the layout and gesture, the button stays a button. Adding a
 * dedicated element would duplicate the existing button surface without
 * adding semantics that the slot can't express.
 */
const sheet = createSheet(`
  :host {
    display: block;
    position: relative;
    overflow: hidden;
    isolation: isolate;
    background: var(--atlas-color-bg);
  }
  :host([disabled]) .row {
    pointer-events: auto;
  }
  /* Action panes sit absolutely behind the row so the row's transform
     reveals them. Both stretch full row height. */
  .pane {
    position: absolute;
    top: 0;
    bottom: 0;
    display: flex;
    align-items: stretch;
    /* Hidden until user reveals it. */
    z-index: 0;
  }
  .pane-leading  { left: 0; }
  .pane-trailing { right: 0; }
  .pane-leading  ::slotted(*),
  .pane-trailing ::slotted(*) {
    /* C16.2 — every action button at least 44×44 CSS px. */
    min-width: var(--atlas-touch-target-min, 44px);
    min-height: var(--atlas-touch-target-min, 44px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 0;
    /* Action buttons fill the pane height; consumers control colour
       via their own [variant]/[tone] attributes. */
    padding: 0 var(--atlas-space-md);
  }
  .row {
    position: relative;
    display: flex;
    align-items: center;
    z-index: 1;
    background: var(--atlas-color-bg);
    transform: translate3d(0, 0, 0);
    transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
    will-change: transform;
    touch-action: pan-y;
    min-height: var(--atlas-touch-target-min, 44px);
  }
  :host([data-grabbed]) .row {
    transition: none;
    touch-action: none;
  }
  /* Default content slot is allowed to grow naturally. */
  .row ::slotted(*) {
    flex: 1 1 auto;
  }
  @media (prefers-reduced-motion: reduce) {
    .row { transition-duration: 0ms !important; }
  }
`);

export type SwipeOpen =
  | 'at-rest'
  | 'partial-leading'
  | 'full-leading'
  | 'partial-trailing'
  | 'full-trailing';

export interface AtlasSwipeOpenDetail {
  side: 'leading' | 'trailing';
  full: boolean;
}

export interface AtlasSwipeActionDetail {
  side: 'leading' | 'trailing';
  index: number;
}

export class AtlasSwipeActions extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['disabled', 'open'];
  }

  declare disabled: boolean;

  static {
    Object.defineProperty(
      this.prototype,
      'disabled',
      AtlasElement.boolAttr('disabled'),
    );
  }

  private _built = false;
  private _row: HTMLDivElement | null = null;
  private _leadingPane: HTMLDivElement | null = null;
  private _trailingPane: HTMLDivElement | null = null;
  private _leadingSlot: HTMLSlotElement | null = null;
  private _trailingSlot: HTMLSlotElement | null = null;

  private _activePointerId: number | null = null;
  private _startX = 0;
  private _startY = 0;
  private _gestureLocked: 'horizontal' | 'vertical' | null = null;
  private _baseOffset = 0;
  private _currentOffset = 0;

  // Cached pane widths captured at gesture start (avoids layout reads
  // mid-pointermove).
  private _leadingWidth = 0;
  private _trailingWidth = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncOpen();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'open') this._syncOpen();
    if (name === 'disabled' && this.disabled) {
      this._releasePointer();
      this._setOffset(0);
      this.setAttribute('open', 'at-rest');
    }
  }

  /** Programmatic API. */
  open(side: 'leading' | 'trailing', full = false): void {
    const next: SwipeOpen = full
      ? side === 'leading' ? 'full-leading' : 'full-trailing'
      : side === 'leading' ? 'partial-leading' : 'partial-trailing';
    if (this.getAttribute('open') !== next) {
      this.setAttribute('open', next);
    }
  }

  close(): void {
    if (this.getAttribute('open') !== 'at-rest') {
      this.setAttribute('open', 'at-rest');
    }
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;

    const leadingPane = document.createElement('div');
    leadingPane.className = 'pane pane-leading';
    const leadingSlot = document.createElement('slot');
    leadingSlot.setAttribute('name', 'leading-actions');
    leadingPane.appendChild(leadingSlot);

    const trailingPane = document.createElement('div');
    trailingPane.className = 'pane pane-trailing';
    const trailingSlot = document.createElement('slot');
    trailingSlot.setAttribute('name', 'trailing-actions');
    trailingPane.appendChild(trailingSlot);

    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('data-part', 'row');
    const defaultSlot = document.createElement('slot');
    row.appendChild(defaultSlot);

    root.append(leadingPane, trailingPane, row);

    this._leadingPane = leadingPane;
    this._trailingPane = trailingPane;
    this._leadingSlot = leadingSlot;
    this._trailingSlot = trailingSlot;
    this._row = row;

    row.addEventListener('pointerdown', this._onPointerDown);
    row.addEventListener('pointermove', this._onPointerMove);
    row.addEventListener('pointerup', this._onPointerEnd);
    row.addEventListener('pointercancel', this._onPointerEnd);

    // Keyboard / focus contract: when an action gains focus auto-open
    // that side; on Escape close.
    leadingSlot.addEventListener('slotchange', () => this._wireSlotted('leading'));
    trailingSlot.addEventListener('slotchange', () => this._wireSlotted('trailing'));

    this.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.getAttribute('open') !== 'at-rest') {
        this.close();
      }
    });

    // Initial wiring (slotchange already fires for initial assignment in
    // most engines, but call it once for safety).
    this._wireSlotted('leading');
    this._wireSlotted('trailing');

    this._built = true;
  }

  private _wireSlotted(side: 'leading' | 'trailing'): void {
    const slot = side === 'leading' ? this._leadingSlot : this._trailingSlot;
    if (!slot) return;
    const elements = slot.assignedElements();
    elements.forEach((el, idx) => {
      const tagged = el as HTMLElement & { _swipeBound?: boolean };
      if (tagged._swipeBound) return;
      tagged._swipeBound = true;
      el.addEventListener('focus', () => {
        if (this.disabled) return;
        // Auto-reveal the side on keyboard focus.
        this.open(side, /* full */ true);
      });
      el.addEventListener('click', () => {
        if (this.disabled) return;
        this.dispatchEvent(
          new CustomEvent<AtlasSwipeActionDetail>('action', {
            detail: { side, index: idx },
            bubbles: true,
            composed: true,
          }),
        );
        const name = this.getAttribute('name');
        if (name && this.surfaceId) {
          this.emit(`${this.surfaceId}.${name}-action`, { side, index: idx });
        }
        // Common pattern: an action click closes the row.
        this.close();
      });
    });
  }

  // ───── Pointer gesture ──────────────────────────────────────────────

  private _onPointerDown = (ev: PointerEvent): void => {
    if (this.disabled) return;
    if (this._activePointerId !== null) return;
    // Only initiate from primary button on mouse / any touch-pen.
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    this._activePointerId = ev.pointerId;
    this._startX = ev.clientX;
    this._startY = ev.clientY;
    this._gestureLocked = null;
    // One layout read at gesture start — cache pane widths so pointermove
    // is pure arithmetic.
    this._leadingWidth = this._leadingPane?.getBoundingClientRect().width ?? 0;
    this._trailingWidth = this._trailingPane?.getBoundingClientRect().width ?? 0;
    this._baseOffset = this._currentOffset;
  };

  private _onPointerMove = (ev: PointerEvent): void => {
    if (this._activePointerId !== ev.pointerId) return;
    if (this.disabled) return;
    const dx = ev.clientX - this._startX;
    const dy = ev.clientY - this._startY;
    if (this._gestureLocked === null) {
      // Threshold for committing axis (avoid hijacking vertical scroll).
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        this._gestureLocked = 'horizontal';
        this.setAttribute('data-grabbed', '');
        try {
          (this._row ?? this).setPointerCapture(ev.pointerId);
        } catch {
          // some test envs reject capture
        }
      } else {
        this._gestureLocked = 'vertical';
        // Let the page scroll — drop the gesture entirely.
        this._activePointerId = null;
        return;
      }
    }
    if (this._gestureLocked !== 'horizontal') return;
    let next = this._baseOffset + dx;
    // Bound by available action widths plus a tiny rubber band overshoot.
    const minOffset = -this._trailingWidth - 32;
    const maxOffset = this._leadingWidth + 32;
    if (next < minOffset) next = minOffset;
    if (next > maxOffset) next = maxOffset;
    // No leading actions? clamp to <=0. No trailing? clamp to >=0.
    if (this._leadingWidth === 0 && next > 0) next = 0;
    if (this._trailingWidth === 0 && next < 0) next = 0;
    this._setOffset(next);
    ev.preventDefault();
  };

  private _onPointerEnd = (ev: PointerEvent): void => {
    if (this._activePointerId !== ev.pointerId) return;
    this._releasePointer();
    if (this.disabled) return;
    if (this._gestureLocked !== 'horizontal') {
      // Vertical or no-op — nothing to settle.
      return;
    }
    // Snap to the nearest detent.
    const o = this._currentOffset;
    let target: SwipeOpen = 'at-rest';
    if (o <= -this._trailingWidth * 0.85 && this._trailingWidth > 0) {
      target = 'full-trailing';
    } else if (o <= -this._trailingWidth * 0.35 && this._trailingWidth > 0) {
      target = 'partial-trailing';
    } else if (o >= this._leadingWidth * 0.85 && this._leadingWidth > 0) {
      target = 'full-leading';
    } else if (o >= this._leadingWidth * 0.35 && this._leadingWidth > 0) {
      target = 'partial-leading';
    }
    if (this.getAttribute('open') === target) {
      // Even if attribute didn't change, snap visual offset to detent.
      this._setOffset(this._offsetForState(target));
    } else {
      this.setAttribute('open', target);
    }
  };

  private _releasePointer(): void {
    if (this._activePointerId !== null) {
      try {
        (this._row ?? this).releasePointerCapture(this._activePointerId);
      } catch {
        // already released
      }
    }
    this._activePointerId = null;
    this._gestureLocked = null;
    this.removeAttribute('data-grabbed');
  }

  // ───── State / transform ────────────────────────────────────────────

  private _syncOpen(): void {
    const state = (this.getAttribute('open') ?? 'at-rest') as SwipeOpen;
    const target = this._offsetForState(state);
    this._setOffset(target);
    if (state === 'at-rest') {
      this.dispatchEvent(
        new CustomEvent('close', { bubbles: true, composed: true }),
      );
      const name = this.getAttribute('name');
      if (name && this.surfaceId) this.emit(`${this.surfaceId}.${name}-closed`, {});
    } else {
      const side: 'leading' | 'trailing' = state.endsWith('leading')
        ? 'leading'
        : 'trailing';
      const full = state.startsWith('full');
      this.dispatchEvent(
        new CustomEvent<AtlasSwipeOpenDetail>('open', {
          detail: { side, full },
          bubbles: true,
          composed: true,
        }),
      );
      const name = this.getAttribute('name');
      if (name && this.surfaceId) {
        this.emit(`${this.surfaceId}.${name}-opened`, { side, full });
      }
    }
  }

  private _offsetForState(state: SwipeOpen): number {
    // Width discovery: if the gesture hasn't run yet our cached widths
    // are 0 — measure now (cheap, only on state change).
    const lw = this._leadingWidth || (this._leadingPane?.getBoundingClientRect().width ?? 0);
    const tw = this._trailingWidth || (this._trailingPane?.getBoundingClientRect().width ?? 0);
    switch (state) {
      case 'at-rest':           return 0;
      case 'partial-leading':   return lw > 0 ? Math.min(lw, 88) : 0;
      case 'full-leading':      return lw;
      case 'partial-trailing':  return tw > 0 ? -Math.min(tw, 88) : 0;
      case 'full-trailing':     return -tw;
      default:                  return 0;
    }
  }

  private _setOffset(px: number): void {
    this._currentOffset = px;
    if (!this._row) return;
    this._row.style.transform = px === 0
      ? 'translate3d(0, 0, 0)'
      : `translate3d(${px.toFixed(1)}px, 0, 0)`;
  }
}

AtlasElement.define('atlas-swipe-actions', AtlasSwipeActions);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-swipe-actions': AtlasSwipeActions;
  }
}
