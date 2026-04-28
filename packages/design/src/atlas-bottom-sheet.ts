import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, uid } from './util.ts';

/**
 * <atlas-bottom-sheet> — modal sheet anchored to the bottom edge of the
 * viewport on mobile. On wider viewports (≥640px) the sheet centers as a
 * normal bottom-aligned modal card.
 *
 * Modal mechanics piggyback on the native `<dialog>` element (focus trap,
 * Esc-to-close, inert-outside semantics). Adds:
 *   - a drag handle that supports drag-to-dismiss (pointer events,
 *     `touch-action: none`)
 *   - optional snap points: `snap-points="0.3,0.6,1"` (fractions of the
 *     viewport height). Without snap points the sheet uses a single full
 *     height and only supports drag-to-dismiss.
 *
 * Slots:
 *   heading — title row.
 *   default — body content. Scrolls if overflowed.
 *   actions — sticky footer buttons.
 *
 * Shadow DOM, encapsulated styles via adoptSheet().
 *
 * API:
 *   .open()
 *   .close(returnValue?)
 *   .snapTo(index)        — snap to point at index (0..n-1)
 *
 * Attributes:
 *   open         — (boolean, reflected) — current state.
 *   heading      — convenience shortcut for the heading slot.
 *   snap-points  — comma-separated fractions, e.g. "0.3,0.6,1".
 *   dismissible  — (boolean, default true) — × button + backdrop close.
 *
 * Events:
 *   open  — after opening.
 *   close — after closing. detail: { returnValue: string }.
 */
export interface AtlasBottomSheetCloseDetail {
  returnValue: string;
}

const sheet = createSheet(`
  :host {
    /* contents so the <dialog> uses the viewport, not this host's box. */
    display: contents;
  }
  dialog {
    /* Mobile-first: sheet pinned to the bottom edge full-width. */
    margin: 0;
    margin-top: auto;
    margin-bottom: 0;
    margin-inline: 0;
    width: 100vw;
    max-width: 100vw;
    max-height: 90vh;
    padding: 0;
    border: 0;
    border-top-left-radius: var(--atlas-radius-lg);
    border-top-right-radius: var(--atlas-radius-lg);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    box-shadow: var(--atlas-shadow-lg);
    overflow: hidden;
    /* Native <dialog> uses inset:0 + auto margins to centre. We override
       to anchor it to the bottom edge of the viewport. */
    position: fixed;
    inset: auto 0 0 0;
    transform: translateY(var(--atlas-bs-translate, 0));
    transition: transform var(--atlas-transition-base, 150ms ease);
  }
  dialog::backdrop {
    background: rgba(15, 18, 25, 0.45);
  }
  :host([dragging]) dialog {
    transition: none;
  }
  .grip {
    /* Drag handle — full-width touch target with the visible pill centred. */
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: var(--atlas-touch-target-min, 44px);
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  .grip:active { cursor: grabbing; }
  .grip > span {
    display: block;
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--atlas-color-border-strong);
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    padding: 0 var(--atlas-space-lg) var(--atlas-space-sm);
    border-bottom: 1px solid var(--atlas-color-border);
  }
  header ::slotted([slot="heading"]),
  header [part="heading"] {
    flex: 1 1 auto;
    margin: 0;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-lg);
    font-weight: var(--atlas-font-weight-medium, 500);
    color: var(--atlas-color-text);
  }
  header slot[name="heading"] {
    flex: 1 1 auto;
    display: block;
    min-width: 0;
  }
  .close {
    flex: 0 0 auto;
    min-width: var(--atlas-touch-target-min, 44px);
    min-height: var(--atlas-touch-target-min, 44px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--atlas-radius-md);
    background: transparent;
    color: var(--atlas-color-text-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .close:hover { background: var(--atlas-color-surface-hover); color: var(--atlas-color-text); }
  .close:focus-visible { outline: 2px solid var(--atlas-color-primary); outline-offset: 1px; }
  .close svg { width: 18px; height: 18px; display: block; }
  .body {
    padding: var(--atlas-space-md) var(--atlas-space-lg);
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    max-height: 60vh;
  }
  footer {
    padding: var(--atlas-space-md) var(--atlas-space-lg);
    border-top: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-bg);
  }
  footer ::slotted([slot="actions"]) {
    display: flex;
    gap: var(--atlas-space-sm);
    justify-content: flex-end;
  }
  /* Hide the footer when no actions are slotted in. */
  footer:not(.has-actions) { display: none; }

  /* Wider viewports: drop the edge-to-edge bottom sheet for a centred,
     bottom-aligned modal card. */
  @media (min-width: 640px) {
    dialog {
      width: min(560px, calc(100vw - 2 * var(--atlas-space-lg)));
      max-width: min(560px, calc(100vw - 2 * var(--atlas-space-lg)));
      max-height: min(80vh, 720px);
      inset: auto auto var(--atlas-space-xl) 50%;
      transform: translateX(-50%) translateY(var(--atlas-bs-translate, 0));
      border-radius: var(--atlas-radius-lg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    dialog { transition: none; }
  }
`);

export class AtlasBottomSheet extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['open', 'heading', 'snap-points', 'dismissible'];
  }

  declare dismissible: boolean;

  static {
    Object.defineProperty(
      this.prototype,
      'dismissible',
      AtlasElement.boolAttr('dismissible'),
    );
  }

  private readonly _headingId = uid('atlas-bs-h');
  private _built = false;
  private _dialog: HTMLDialogElement | null = null;
  private _heading: HTMLElement | null = null;
  private _grip: HTMLElement | null = null;
  private _dragStartY = 0;
  private _dragCurrentY = 0;
  private _dragging = false;
  private _pointerId: number | null = null;
  // Resolved snap-point heights, expressed as viewport-height fractions
  // sorted ascending (smallest peek → full).
  private _snapPoints: number[] = [];
  private _activeSnap = -1;

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
      // Snap to the smallest snap point if any defined; otherwise full.
      this._activeSnap = this._snapPoints.length > 0 ? 0 : -1;
      this._applySnapHeight();
      this.dispatchEvent(
        new CustomEvent('open', { bubbles: true, composed: true }),
      );
    }
  }

  close(returnValue: string = ''): void {
    if (this._dialog?.open) this._dialog.close(returnValue);
  }

  snapTo(index: number): void {
    if (this._snapPoints.length === 0) return;
    const clamped = Math.max(0, Math.min(this._snapPoints.length - 1, index));
    this._activeSnap = clamped;
    this._applySnapHeight();
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;

    const d = document.createElement('dialog');
    d.setAttribute('data-part', 'sheet');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-labelledby', this._headingId);

    // Drag grip
    const grip = document.createElement('div');
    grip.className = 'grip';
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'horizontal');
    grip.setAttribute('aria-label', 'Drag handle');
    grip.setAttribute('tabindex', '0');
    const gripPill = document.createElement('span');
    gripPill.setAttribute('aria-hidden', 'true');
    grip.appendChild(gripPill);

    // Header. Heading uses a named slot whose fallback content is an
    // <h2> we update from the `heading` attribute. A consumer-supplied
    // [slot="heading"] light-DOM node overrides the fallback.
    const header = document.createElement('header');
    const headingSlot = document.createElement('slot');
    headingSlot.setAttribute('name', 'heading');

    const headingFallback = document.createElement('h2');
    headingFallback.id = this._headingId;
    headingFallback.setAttribute('part', 'heading');
    headingSlot.appendChild(headingFallback);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    closeBtn.addEventListener('click', () => this.close());

    header.appendChild(headingSlot);
    header.appendChild(closeBtn);

    // Body
    const body = document.createElement('div');
    body.className = 'body';
    const bodySlot = document.createElement('slot');
    body.appendChild(bodySlot);

    // Footer (only shown when actions slot has nodes)
    const footer = document.createElement('footer');
    const actionsSlot = document.createElement('slot');
    actionsSlot.setAttribute('name', 'actions');
    footer.appendChild(actionsSlot);
    actionsSlot.addEventListener('slotchange', () => {
      const assigned = actionsSlot.assignedNodes({ flatten: true });
      footer.classList.toggle('has-actions', assigned.length > 0);
    });

    d.appendChild(grip);
    d.appendChild(header);
    d.appendChild(body);
    d.appendChild(footer);
    root.appendChild(d);

    d.addEventListener('close', () => {
      if (this.hasAttribute('open')) this.removeAttribute('open');
      // Reset transient drag state
      this.removeAttribute('dragging');
      this.style.removeProperty('--atlas-bs-translate');
      this.dispatchEvent(
        new CustomEvent<AtlasBottomSheetCloseDetail>('close', {
          detail: { returnValue: d.returnValue ?? '' },
          bubbles: true,
          composed: true,
        }),
      );
    });
    d.addEventListener('click', (ev) => {
      if (!this._isDismissible()) return;
      // Native <dialog> click target is the dialog itself when the user
      // clicks the backdrop (the dialog box sits above the backdrop).
      if (ev.target === d) d.close();
    });

    grip.addEventListener('pointerdown', (ev) => this._onGripDown(ev));
    grip.addEventListener('pointermove', (ev) => this._onGripMove(ev));
    grip.addEventListener('pointerup', (ev) => this._onGripUp(ev));
    grip.addEventListener('pointercancel', (ev) => this._onGripUp(ev));

    this._dialog = d;
    this._heading = headingFallback;
    this._grip = grip;
    void footer; // referenced via slotchange handler above
    this._built = true;
  }

  private _syncAll(): void {
    this._syncHeading();
    this._syncSnapPoints();
    this._syncOpenAttr();
  }

  private _sync(name: string): void {
    if (name === 'open') this._syncOpenAttr();
    else if (name === 'heading') this._syncHeading();
    else if (name === 'snap-points') this._syncSnapPoints();
  }

  private _syncOpenAttr(): void {
    if (!this._dialog) return;
    const want = this.hasAttribute('open');
    if (want && !this._dialog.open) this.open();
    else if (!want && this._dialog.open) this.close();
  }

  private _syncHeading(): void {
    if (!this._heading) return;
    const text = this.getAttribute('heading');
    if (text != null) this._heading.textContent = text;
  }

  private _syncSnapPoints(): void {
    const raw = this.getAttribute('snap-points');
    if (!raw) {
      this._snapPoints = [];
      this._activeSnap = -1;
      this._applySnapHeight();
      return;
    }
    const parsed: number[] = [];
    for (const part of raw.split(',')) {
      const n = Number(part.trim());
      if (Number.isFinite(n) && n > 0 && n <= 1) parsed.push(n);
    }
    parsed.sort((a, b) => a - b);
    this._snapPoints = parsed;
    if (this._activeSnap >= parsed.length) {
      this._activeSnap = parsed.length - 1;
    }
    this._applySnapHeight();
  }

  private _applySnapHeight(): void {
    if (!this._dialog) return;
    if (this._snapPoints.length === 0 || this._activeSnap < 0) {
      this._dialog.style.removeProperty('height');
      return;
    }
    const fraction = this._snapPoints[this._activeSnap] ?? 1;
    this._dialog.style.height = `${Math.round(fraction * 100)}vh`;
  }

  private _isDismissible(): boolean {
    return this.getAttribute('dismissible') !== 'false';
  }

  private _onGripDown(ev: PointerEvent): void {
    if (!this._dialog) return;
    this._pointerId = ev.pointerId;
    this._dragStartY = ev.clientY;
    this._dragCurrentY = ev.clientY;
    this._dragging = true;
    this.setAttribute('dragging', '');
    this._grip?.setPointerCapture(ev.pointerId);
  }

  private _onGripMove(ev: PointerEvent): void {
    if (!this._dragging || ev.pointerId !== this._pointerId) return;
    this._dragCurrentY = ev.clientY;
    const delta = Math.max(0, this._dragCurrentY - this._dragStartY);
    // Live-update translate so the sheet follows the finger downward.
    this.style.setProperty('--atlas-bs-translate', `${delta}px`);
  }

  private _onGripUp(ev: PointerEvent): void {
    if (!this._dragging) return;
    if (ev.pointerId !== this._pointerId && ev.type !== 'pointercancel') return;
    const delta = this._dragCurrentY - this._dragStartY;
    this._dragging = false;
    this._pointerId = null;
    this.removeAttribute('dragging');
    this.style.removeProperty('--atlas-bs-translate');
    if (this._grip?.hasPointerCapture(ev.pointerId)) {
      this._grip.releasePointerCapture(ev.pointerId);
    }

    // Drag-to-dismiss threshold: 96px or 1/4 of the dialog height,
    // whichever is smaller. Only when dismissible.
    if (this._isDismissible() && this._dialog) {
      const rect = this._dialog.getBoundingClientRect();
      const threshold = Math.min(96, rect.height / 4);
      if (delta > threshold) {
        // If we have multiple snap points and we're not on the smallest,
        // snap down one notch instead of dismissing.
        if (this._snapPoints.length > 0 && this._activeSnap > 0) {
          this.snapTo(this._activeSnap - 1);
          return;
        }
        this.close();
        return;
      }
    }

    // Otherwise: snap up if the upward swipe exceeded a threshold.
    if (this._snapPoints.length > 0 && delta < -48 && this._activeSnap < this._snapPoints.length - 1) {
      this.snapTo(this._activeSnap + 1);
    }
  }
}

AtlasElement.define('atlas-bottom-sheet', AtlasBottomSheet);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-bottom-sheet': AtlasBottomSheet;
  }
}
