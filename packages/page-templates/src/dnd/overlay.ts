/**
 * dnd/overlay.ts — floating visual for the actively dragged item.
 *
 * The overlay is a single DOM node mounted under a controller-owned
 * container (typically document.body). It moves via CSS transforms at
 * pointermove frequency — never through layout-triggering top/left writes
 * and never through app-state round-trips.
 */

import type { Point, Rect } from './types.ts';

export interface DragOverlayOptions {
  /** defaults to document.body */
  container?: HTMLElement;
  /** applied to the wrapper */
  className?: string;
}

export class DragOverlay {
  private _containerOverride: HTMLElement | null;
  private _className: string;
  private _wrapper: HTMLElement | null = null;
  private _pickupOffset: Point = { x: 0, y: 0 };

  constructor({ container, className }: DragOverlayOptions = {}) {
    this._containerOverride = container ?? null;
    this._className = className ?? 'atlas-dnd-overlay';
  }

  private _container(): HTMLElement | null {
    if (this._containerOverride) return this._containerOverride;
    if (typeof document === 'undefined') return null;
    return document.body;
  }

  mount(previewNode: HTMLElement, pointer: Point, pickupOffset: Point): void {
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

  move(pointer: Point): void {
    if (!this._wrapper) return;
    const x = pointer.x - this._pickupOffset.x;
    const y = pointer.y - this._pickupOffset.y;
    // Single transform write per move. Compositor-friendly.
    this._wrapper.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  unmount(): void {
    if (!this._wrapper) return;
    if (this._wrapper.parentNode) {
      this._wrapper.parentNode.removeChild(this._wrapper);
    }
    this._wrapper = null;
  }

  /** Expose the root for tests / debug. */
  get element(): HTMLElement | null {
    return this._wrapper;
  }
}

/**
 * Default preview factory — deep-clones the source element. The overlay
 * makes the clone visually match the source footprint.
 */
export function cloneSourcePreview(sourceEl: HTMLElement, sourceRect: Rect): HTMLElement {
  const clone = sourceEl.cloneNode(true) as HTMLElement;
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
