/**
 * dnd/overlay.js — floating visual for the actively dragged item.
 *
 * The overlay is a single DOM node mounted under a controller-owned
 * container (typically document.body). It moves via CSS transforms at
 * pointermove frequency — never through layout-triggering top/left writes
 * and never through app-state round-trips.
 *
 * Contract:
 *   mount(preview, initialPointer, pickupOffset)
 *       — Take ownership of a preview node and place it so the pointer
 *         lines up with the same point of the preview as it did on the
 *         source element.
 *   move(pointer)
 *       — Update transform. Cheap, idempotent.
 *   unmount()
 *       — Remove the overlay and restore the DOM.
 */

export class DragOverlay {
  /**
   * @param {object} options
   * @param {HTMLElement} [options.container] — defaults to document.body
   * @param {string} [options.className]      — applied to the wrapper
   */
  constructor({ container, className } = {}) {
    this._containerOverride = container ?? null;
    this._className = className ?? 'atlas-dnd-overlay';
    /** @type {HTMLElement | null} */
    this._wrapper = null;
    /** @type {import('./types.js').Point} */
    this._pickupOffset = { x: 0, y: 0 };
  }

  _container() {
    if (this._containerOverride) return this._containerOverride;
    if (typeof document === 'undefined') return null;
    return document.body;
  }

  /**
   * @param {HTMLElement} previewNode
   * @param {import('./types.js').Point} pointer
   * @param {import('./types.js').Point} pickupOffset
   */
  mount(previewNode, pointer, pickupOffset) {
    const container = this._container();
    if (!container || !previewNode) return;
    this._pickupOffset = { ...pickupOffset };
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-dnd-overlay', '');
    wrapper.className = this._className;
    // Inline base positioning so we don't depend on style injection timing.
    wrapper.style.position = 'fixed';
    wrapper.style.top = '0';
    wrapper.style.left = '0';
    wrapper.style.pointerEvents = 'none';
    wrapper.style.zIndex = '10000';
    wrapper.style.willChange = 'transform';
    wrapper.appendChild(previewNode);
    container.appendChild(wrapper);
    this._wrapper = wrapper;
    this.move(pointer);
  }

  /** @param {import('./types.js').Point} pointer */
  move(pointer) {
    if (!this._wrapper) return;
    const x = pointer.x - this._pickupOffset.x;
    const y = pointer.y - this._pickupOffset.y;
    // Single transform write per move. Compositor-friendly.
    this._wrapper.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  unmount() {
    if (!this._wrapper) return;
    if (this._wrapper.parentNode) {
      this._wrapper.parentNode.removeChild(this._wrapper);
    }
    this._wrapper = null;
  }

  /** Expose the root for tests / debug. */
  get element() {
    return this._wrapper;
  }
}

/**
 * Default preview factory — deep-clones the source element. The overlay
 * makes the clone visually match the source footprint.
 *
 * @param {HTMLElement} sourceEl
 * @param {import('./types.js').Rect} sourceRect
 */
export function cloneSourcePreview(sourceEl, sourceRect) {
  const clone = sourceEl.cloneNode(true);
  clone.setAttribute('data-dnd-overlay-preview', '');
  // The clone is a visual echo, not an identity-bearing element. Strip
  // anything that would let selectors / test-id generators mistake it for
  // the real source.
  clone.removeAttribute('id');
  clone.removeAttribute('name');
  clone.removeAttribute('data-instance-id');
  clone.removeAttribute('data-widget-instance-id');
  clone.removeAttribute('data-testid');
  clone.style.boxSizing = 'border-box';
  clone.style.width = `${sourceRect.width}px`;
  clone.style.height = `${sourceRect.height}px`;
  clone.style.margin = '0';
  clone.style.transform = 'none';
  clone.style.pointerEvents = 'none';
  return clone;
}
