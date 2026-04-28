/**
 * dnd/sensor.ts — Pointer Events sensor.
 *
 * Responsibilities:
 *   - Listen for pointerdown on the root (delegated).
 *   - Decide whether the pointerdown target is armed by any registered
 *     source descriptor.
 *   - Once armed, listen globally for pointermove / pointerup /
 *     pointercancel and only promote the drag to `dragging` when the
 *     pixel distance from the origin crosses the activation threshold.
 *   - Use setPointerCapture on the source so Safari / iOS and nested
 *     scroll containers do not steal events.
 *   - Suppress default text selection, image drag, and contextmenu noise
 *     while a drag is live.
 *   - Invoke the lifecycle callbacks (`onStart`, `onMove`, `onEnd`,
 *     `onCancel`) so the controller can delegate to session / overlay /
 *     collision layers. The sensor itself does not call into them.
 *
 * The sensor knows nothing about regions, widgets, or commits. It is a
 * pure pointer-to-lifecycle adapter. Keep it that way.
 */

import type { DragSource, Point } from './types.ts';

const DEFAULT_ACTIVATION_DISTANCE = 4; // px

export interface SensorArmArgs {
  source: DragSource;
  origin: Point;
  event: PointerEvent;
}
export interface SensorActivateArgs {
  source: DragSource;
  pointer: Point;
}
export interface SensorMoveArgs {
  pointer: Point;
  event: PointerEvent;
}
export interface SensorEndArgs {
  pointer: Point;
  event: PointerEvent;
}
export interface SensorCancelArgs {
  reason: 'cancel' | 'below-threshold';
  wasActive?: boolean;
}

export interface SensorCallbacks {
  onArm?: (args: SensorArmArgs) => boolean | void;
  onActivate?: (args: SensorActivateArgs) => void;
  onMove?: (args: SensorMoveArgs) => void;
  onEnd?: (args: SensorEndArgs) => void;
  onCancel?: (args: SensorCancelArgs) => void;
}

export interface PointerSensorOptions {
  /** delegation root. Defaults to document. */
  root?: HTMLElement | Document | null;
  activationDistance?: number;
  callbacks: SensorCallbacks;
}

export class PointerSensor {
  private _root: HTMLElement | Document | null;
  private _threshold: number;
  private _cb: SensorCallbacks;
  private _sources: Map<HTMLElement, DragSource> = new Map();
  private _armed: DragSource | null = null;
  private _activated = false;
  private _origin: Point | null = null;
  private _capturedPointerId: number | null = null;
  private _captureEl: HTMLElement | null = null;
  private _pointerId: number | null = null;
  private _attached = false;

  private _onPointerDown: (ev: PointerEvent) => void;
  private _onPointerMove: (ev: PointerEvent) => void;
  private _onPointerUp: (ev: PointerEvent) => void;
  private _onPointerCancel: (ev: PointerEvent) => void;
  private _onKeyDown: (ev: KeyboardEvent) => void;
  private _onContextMenu: (ev: Event) => void;
  private _onSelectStart: (ev: Event) => void;
  private _onDragStart: (ev: DragEvent) => void;

  constructor({ root, activationDistance, callbacks }: PointerSensorOptions) {
    this._root = root ?? (typeof document !== 'undefined' ? document : null);
    this._threshold = Number.isFinite(activationDistance)
      ? (activationDistance as number)
      : DEFAULT_ACTIVATION_DISTANCE;
    this._cb = callbacks;
    this._onPointerDown = this.__onPointerDown.bind(this);
    this._onPointerMove = this.__onPointerMove.bind(this);
    this._onPointerUp = this.__onPointerUp.bind(this);
    this._onPointerCancel = this.__onPointerCancel.bind(this);
    this._onKeyDown = this.__onKeyDown.bind(this);
    this._onContextMenu = this.__onContextMenu.bind(this);
    this._onSelectStart = this.__onSelectStart.bind(this);
    this._onDragStart = this.__onDragStart.bind(this);
  }

  /** Register a draggable source element. Returns an unregister function. */
  register(source: DragSource | null | undefined): () => void {
    if (!source || !source.element) return () => {};
    this._sources.set(source.element, source);
    return () => {
      this._sources.delete(source.element);
    };
  }

  attach(): void {
    if (this._attached || !this._root) return;
    this._attached = true;
    const root = this._root;
    root.addEventListener('pointerdown', this._onPointerDown as EventListener, { passive: false });
    // Swallow native HTML5 dragstart ONLY on registered source elements, in
    // case one of them renders a nested node that browsers think is
    // draggable by default (e.g. <img>).
    root.addEventListener('dragstart', this._onDragStart as EventListener, true);
  }

  detach(): void {
    if (!this._attached || !this._root) return;
    this._attached = false;
    const root = this._root;
    root.removeEventListener('pointerdown', this._onPointerDown as EventListener);
    root.removeEventListener('dragstart', this._onDragStart as EventListener, true);
    this._teardownGlobal();
  }

  /** Hard-cancel an in-flight drag (e.g. programmatic abort, view change). */
  cancel(reason: 'cancel' | 'below-threshold' = 'cancel'): DragSource | undefined {
    if (!this._armed) return undefined;
    const wasActive = this._activated;
    this._teardownGlobal();
    const armed = this._armed;
    this._armed = null;
    this._activated = false;
    this._origin = null;
    this._cb.onCancel?.({ reason, wasActive });
    return armed;
  }

  // ---- internals ----

  private _findSourceForEvent(ev: Event): DragSource | null {
    // Prefer composedPath so shadow-hosted sources resolve correctly
    // (a document-level listener sees ev.target retargeted to the shadow
    // host, but composedPath exposes the real event origin chain).
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : null;
    if (path && path.length) {
      for (const node of path) {
        if (node && (node as Node).nodeType === 1) {
          const src = this._sources.get(node as HTMLElement);
          if (src) return src;
        }
      }
      return null;
    }
    // Fallback: light-DOM ancestor walk.
    let node: Node | null = ev.target as Node | null;
    while (node && node.nodeType === 1) {
      const src = this._sources.get(node as HTMLElement);
      if (src) return src;
      node = (node as Node).parentNode;
    }
    return null;
  }

  private __onPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    if (this._armed) return;
    const source = this._findSourceForEvent(ev);
    if (!source) return;
    if (source.activator && !source.activator.contains(ev.target as Node)) return;
    const origin: Point = { x: ev.clientX, y: ev.clientY };
    const ok = this._cb.onArm?.({ source, origin, event: ev });
    if (ok === false) return;
    this._armed = source;
    this._activated = false;
    this._origin = origin;
    this._pointerId = ev.pointerId;
    // NB: we intentionally do NOT setPointerCapture here. Capture redirects
    // pointerup (and therefore the generated click) to the captured element,
    // which breaks clicks on nested interactive controls (e.g. a delete
    // button rendered inside a draggable cell). Capture is deferred to
    // activation; a mere click never crosses the threshold and the browser
    // fires its click event on the real target.
    this._setupGlobal();
    // Don't preventDefault here; we don't know yet if a drag will start.
    // Let click / focus work normally if threshold is never crossed.
  }

  private __onPointerMove(ev: PointerEvent): void {
    if (!this._armed) return;
    const pointer: Point = { x: ev.clientX, y: ev.clientY };
    if (!this._activated) {
      const dx = pointer.x - (this._origin?.x ?? pointer.x);
      const dy = pointer.y - (this._origin?.y ?? pointer.y);
      if (Math.hypot(dx, dy) >= this._threshold) {
        this._activated = true;
        // Promote to a real drag: capture the pointer now so subsequent
        // events still reach us even if the pointer leaves the source
        // (Safari / iOS / nested scroll containers). We did not capture at
        // arm time because that would redirect the click of a non-drag
        // interaction onto the source element.
        const capTarget = this._armed?.element ?? null;
        if (capTarget && this._pointerId != null) {
          try {
            capTarget.setPointerCapture?.(this._pointerId);
            this._capturedPointerId = this._pointerId;
            this._captureEl = capTarget;
          } catch {
            /* non-capturing environments — fine */
          }
        }
        // Prevent text selection now that we know it's a drag.
        if (typeof document !== 'undefined') {
          document.addEventListener('selectstart', this._onSelectStart, { capture: true });
        }
        this._cb.onActivate?.({ source: this._armed, pointer });
      } else {
        return;
      }
    }
    // While dragging, block default text-selection / scroll-on-touch.
    if (ev.cancelable) ev.preventDefault();
    this._cb.onMove?.({ pointer, event: ev });
  }

  private __onPointerUp(ev: PointerEvent): void {
    if (!this._armed) return;
    const pointer: Point = { x: ev.clientX, y: ev.clientY };
    const wasActive = this._activated;
    this._teardownGlobal();
    this._armed = null;
    this._activated = false;
    this._origin = null;
    if (wasActive) {
      this._cb.onEnd?.({ pointer, event: ev });
    } else {
      this._cb.onCancel?.({ reason: 'below-threshold' });
    }
  }

  private __onPointerCancel(_ev: PointerEvent): void {
    if (!this._armed) return;
    this._teardownGlobal();
    this._armed = null;
    this._activated = false;
    this._origin = null;
    this._cb.onCancel?.({ reason: 'cancel' });
  }

  private __onKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && this._armed) {
      ev.preventDefault();
      this.cancel('cancel');
    }
  }

  private __onContextMenu(ev: Event): void {
    if (this._armed) ev.preventDefault();
  }

  private __onSelectStart(ev: Event): void {
    if (this._armed && this._activated) ev.preventDefault();
  }

  private __onDragStart(ev: DragEvent): void {
    // Only block native dragstart when it originates inside (or on) a
    // registered source. Text / image drags outside the DnD surface are
    // left alone so the rest of the page behaves normally.
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : null;
    if (path && path.length) {
      for (const node of path) {
        if (node && (node as Node).nodeType === 1 && this._sources.has(node as HTMLElement)) {
          ev.preventDefault();
          return;
        }
      }
      return;
    }
    let node: Node | null = ev.target as Node | null;
    while (node && node.nodeType === 1) {
      if (this._sources.has(node as HTMLElement)) {
        ev.preventDefault();
        return;
      }
      node = node.parentNode;
    }
  }

  private _setupGlobal(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('pointermove', this._onPointerMove, { passive: false });
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerCancel);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('contextmenu', this._onContextMenu);
  }

  private _teardownGlobal(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerCancel);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('contextmenu', this._onContextMenu);
    if (typeof document !== 'undefined') {
      document.removeEventListener('selectstart', this._onSelectStart, { capture: true });
    }
    if (this._captureEl && this._capturedPointerId != null) {
      try {
        this._captureEl.releasePointerCapture?.(this._capturedPointerId);
      } catch {
        /* ignore */
      }
    }
    this._captureEl = null;
    this._capturedPointerId = null;
    this._pointerId = null;
  }
}
