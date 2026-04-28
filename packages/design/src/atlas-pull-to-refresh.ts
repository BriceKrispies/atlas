import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-pull-to-refresh> — wraps a scrollable region. When the user pulls
 * down at scrollTop=0 past a threshold (default 64px), shows a refresh
 * indicator (atlas-spinner) and dispatches the `refresh` CustomEvent.
 *
 * ─── Event contract (chosen: "busy" attribute) ─────────────────────────
 *   The consumer toggles a reflected `busy` attribute. This was chosen
 *   over a `detail.waitFor(promise)` API because:
 *     1. It mirrors the reactive signal-driven model used elsewhere in the
 *        platform (see C14 Event-Driven Data Flow). Components observe
 *        signals, not awaited promises inside event handlers.
 *     2. The spinner needs to remain visible until the consumer's data
 *        round-trip is done; surfaces typically toggle `busy` from a
 *        loading signal, no extra glue required.
 *     3. It keeps render() pure — no awaits inside event handlers.
 *
 *   Lifecycle:
 *     pointerdown at scrollTop===0 → user drags down past threshold →
 *     element fires `refresh` (CustomEvent, bubbles, composed) →
 *     consumer sets `busy="true"` → spinner stays pinned at the top →
 *     consumer fetches & finishes → consumer removes `busy` →
 *     spinner animates back to rest.
 *
 *   If `busy` is already true at pointerdown, the gesture is suppressed.
 *
 * Attributes:
 *   threshold — pixels of pull required to trigger refresh (default 64).
 *   disabled  — fully blocks the gesture (no pointer capture, no spinner).
 *   busy      — reflected; true while the consumer is refreshing.
 *
 * Slots:
 *   default — the scrollable content (must scroll vertically).
 *   refresh-button — optional; when provided, used as the desktop
 *     keyboard/mouse alternative on `(hover: hover) and (pointer: fine)`.
 *     Clicking it dispatches `refresh` exactly like a successful pull.
 *
 * Events:
 *   refresh — bubbles, composed. Fires once per gesture (or per click of
 *             the slotted refresh-button).
 *
 * Constitutional notes:
 *   - C3.10: keyboard/desktop users get a focusable refresh-button slot.
 *   - C16.2: when the slotted button is an atlas-button it inherits the
 *            44×44 touch target; if a raw <button> is slotted, this
 *            element does not enforce sizing on it (consumer concern).
 *   - C13: the drag uses transform-only animation; no layout reads in the
 *          pointermove handler beyond a single scrollTop check at start.
 *   - R6.2: track has `touch-action: pan-y` (vertical scroll allowed,
 *           pointer cancellation only kicks in once we capture).
 *   - prefers-reduced-motion: snap-back transition is capped to 0ms.
 */
const sheet = createSheet(`
  :host {
    display: block;
    position: relative;
    overflow: hidden;
    /* The host is the visible viewport; its track scrolls inside. */
    isolation: isolate;
    contain: layout paint;
  }
  :host([disabled]) .indicator { display: none; }
  .indicator {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--atlas-color-primary);
    /* Sits above the track, translated up off-screen by default. */
    transform: translate3d(0, -100%, 0);
    pointer-events: none;
    z-index: 1;
  }
  :host([busy]) .indicator { transform: translate3d(0, 0, 0); }
  .indicator atlas-spinner {
    transition: transform 160ms ease-out;
  }
  :host([data-pulling]) .indicator atlas-spinner {
    transition: none;
  }
  .track {
    height: 100%;
    width: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    /* R6.2 — let the browser still own vertical scroll until we
       explicitly capture the pointer. */
    touch-action: pan-y;
    will-change: transform;
    transform: translate3d(0, 0, 0);
    transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  :host([data-pulling]) .track {
    transition: none;
  }
  :host([busy]) .track {
    transform: translate3d(0, 56px, 0);
  }
  .desktop-refresh {
    position: absolute;
    top: var(--atlas-space-xs);
    right: var(--atlas-space-xs);
    z-index: 2;
    display: none;
  }
  /* Show the desktop refresh button on fine-pointer devices only. */
  @media (hover: hover) and (pointer: fine) {
    .desktop-refresh.has-content { display: block; }
  }
  ::slotted([slot="refresh-button"]) {
    /* Consumer-controlled. We only ensure visibility at minimum size. */
    min-height: var(--atlas-touch-target-min, 44px);
    min-width: var(--atlas-touch-target-min, 44px);
  }
  @media (prefers-reduced-motion: reduce) {
    .track,
    .indicator atlas-spinner {
      transition-duration: 0ms !important;
    }
  }
`);

export class AtlasPullToRefresh extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['disabled', 'busy', 'threshold'];
  }

  declare disabled: boolean;
  declare busy: boolean;

  static {
    Object.defineProperty(
      this.prototype,
      'disabled',
      AtlasElement.boolAttr('disabled'),
    );
    Object.defineProperty(
      this.prototype,
      'busy',
      AtlasElement.boolAttr('busy'),
    );
  }

  private _built = false;
  private _track: HTMLDivElement | null = null;
  private _indicator: HTMLDivElement | null = null;
  private _spinner: HTMLElement | null = null;
  private _activePointerId: number | null = null;
  private _startY = 0;
  private _pullDistance = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    this._sync(name);
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    // No user content interpolation — pure structural shell. Consumer
    // markup arrives via slots and is never serialised by this element.
    const desktopWrap = document.createElement('div');
    desktopWrap.className = 'desktop-refresh';
    const desktopSlot = document.createElement('slot');
    desktopSlot.setAttribute('name', 'refresh-button');
    desktopWrap.appendChild(desktopSlot);
    desktopSlot.addEventListener('slotchange', () => {
      const assigned = desktopSlot.assignedElements();
      desktopWrap.classList.toggle('has-content', assigned.length > 0);
      for (const el of assigned) {
        // Wire each slotted element so its click triggers refresh,
        // regardless of whether it's an atlas-button or a raw element.
        if ((el as HTMLElement & { _ptrBound?: boolean })._ptrBound) continue;
        (el as HTMLElement & { _ptrBound?: boolean })._ptrBound = true;
        el.addEventListener('click', () => {
          if (this.disabled || this.busy) return;
          this._dispatchRefresh();
        });
      }
    });

    const indicator = document.createElement('div');
    indicator.className = 'indicator';
    indicator.setAttribute('aria-hidden', 'true');
    const spinner = document.createElement('atlas-spinner');
    spinner.setAttribute('size', 'md');
    indicator.appendChild(spinner);

    const track = document.createElement('div');
    track.className = 'track';
    track.setAttribute('data-part', 'track');
    const defaultSlot = document.createElement('slot');
    track.appendChild(defaultSlot);

    root.append(indicator, track, desktopWrap);

    this._indicator = indicator;
    this._spinner = spinner;
    this._track = track;

    track.addEventListener('pointerdown', this._onPointerDown);
    track.addEventListener('pointermove', this._onPointerMove);
    track.addEventListener('pointerup', this._onPointerEnd);
    track.addEventListener('pointercancel', this._onPointerEnd);

    this._built = true;
  }

  private _sync(name: string): void {
    switch (name) {
      case 'busy':
        if (!this.busy) {
          this._pullDistance = 0;
          this._setIndicatorTranslate(0);
        }
        break;
      case 'disabled':
        if (this.disabled) {
          this._releasePointer();
          this._setIndicatorTranslate(0);
          this._setTrackTranslate(0);
        }
        break;
      // threshold has no visual side-effect.
    }
  }

  private _threshold(): number {
    const raw = this.getAttribute('threshold');
    const n = raw == null ? 64 : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 64;
  }

  private _onPointerDown = (ev: PointerEvent): void => {
    if (this.disabled || this.busy) return;
    if (ev.pointerType === 'mouse') return; // mouse uses the slotted button
    const track = this._track;
    if (!track) return;
    // Edge-pull only — must be at the very top of the scroll region.
    if (track.scrollTop !== 0) return;
    if (this._activePointerId !== null) return;
    this._activePointerId = ev.pointerId;
    this._startY = ev.clientY;
    this._pullDistance = 0;
  };

  private _onPointerMove = (ev: PointerEvent): void => {
    if (this._activePointerId !== ev.pointerId) return;
    if (this.disabled || this.busy) return;
    const track = this._track;
    if (!track) return;
    const dy = ev.clientY - this._startY;
    if (dy <= 0) {
      // Upward drag — release back to scroll behaviour.
      if (this.hasAttribute('data-pulling')) {
        this.removeAttribute('data-pulling');
        this._setTrackTranslate(0);
        this._setIndicatorTranslate(0);
      }
      return;
    }
    // First time we cross zero we capture the pointer to lock the gesture
    // to this element and tell the browser to stop scrolling.
    if (!this.hasAttribute('data-pulling')) {
      try {
        track.setPointerCapture(ev.pointerId);
      } catch {
        // Some browsers/test envs reject capture; the gesture still works.
      }
      this.setAttribute('data-pulling', '');
    }
    // Resistance curve — feels rubbery past the threshold.
    const resisted = this._resist(dy);
    this._pullDistance = resisted;
    this._setTrackTranslate(resisted);
    this._setIndicatorTranslate(resisted);
    ev.preventDefault();
  };

  private _onPointerEnd = (ev: PointerEvent): void => {
    if (this._activePointerId !== ev.pointerId) return;
    this._releasePointer();
    if (this.disabled) return;
    const triggered = this._pullDistance >= this._threshold();
    this._pullDistance = 0;
    if (triggered) {
      this._dispatchRefresh();
    } else {
      this._setTrackTranslate(0);
      this._setIndicatorTranslate(0);
    }
  };

  private _releasePointer(): void {
    const track = this._track;
    if (track && this._activePointerId !== null) {
      try {
        track.releasePointerCapture(this._activePointerId);
      } catch {
        // already released
      }
    }
    this._activePointerId = null;
    this.removeAttribute('data-pulling');
  }

  /** Soft resistance: drag harder past the threshold for less reward. */
  private _resist(dy: number): number {
    const t = this._threshold();
    if (dy <= t) return dy;
    const overflow = dy - t;
    return t + overflow * 0.4;
  }

  private _setTrackTranslate(px: number): void {
    if (!this._track) return;
    this._track.style.transform = px === 0
      ? 'translate3d(0, 0, 0)'
      : `translate3d(0, ${px.toFixed(1)}px, 0)`;
  }

  private _setIndicatorTranslate(px: number): void {
    if (!this._indicator) return;
    // Indicator slides in from -100% to 0 as we approach threshold.
    const t = this._threshold();
    const pct = px <= 0 ? -100 : Math.min(0, -100 + (px / t) * 100);
    this._indicator.style.transform = `translate3d(0, ${pct.toFixed(1)}%, 0)`;
  }

  private _dispatchRefresh(): void {
    this.dispatchEvent(
      new CustomEvent('refresh', { bubbles: true, composed: true }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-refreshed`, {});
    }
  }
}

AtlasElement.define('atlas-pull-to-refresh', AtlasPullToRefresh);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-pull-to-refresh': AtlasPullToRefresh;
  }
}
