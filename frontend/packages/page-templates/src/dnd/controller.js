/**
 * dnd/controller.js — slim orchestrator.
 *
 * Wires PointerSensor → local per-drag state → overlay + projection →
 * commit boundary. Hit-testing is a plain pointer-in-rect walk over the
 * registered targets; there is no collision strategy, no measurement
 * cache, no autoscroll, no phase store.
 *
 * See ARCHITECTURE.md for why the extra layers were cut.
 */

import { PointerSensor } from './sensor.js';
import { Projection } from './projection.js';
import { DragOverlay, cloneSourcePreview } from './overlay.js';
import { CommitBoundary } from './commit.js';

/**
 * @typedef {object} DndControllerOptions
 * @property {HTMLElement | Document} [root]
 * @property {number} [activationDistance]
 * @property {(args: {
 *   payload: import('./types.js').DragPayload,
 *   target: import('./types.js').DropTarget,
 * }) => Promise<{ ok: boolean, reason?: string, [k: string]: any }>} onDrop
 * @property {HTMLElement} [overlayContainer]
 */

export class DndController {
  /** @param {DndControllerOptions} options */
  constructor(options) {
    this._opts = options ?? {};
    this.projection = new Projection();
    this.overlay = new DragOverlay({ container: options?.overlayContainer });
    this.commit = new CommitBoundary({ onDrop: options?.onDrop });

    /** @type {Map<HTMLElement, import('./types.js').DropTarget>} */
    this._targets = new Map();
    /** @type {Set<() => void>} */
    this._sourceUnregs = new Set();
    /** @type {Array<(ev: { phase: string, result?: any }) => void>} */
    this._listeners = [];

    // Per-drag transient state. Null when idle.
    this._active = null;

    this.sensor = new PointerSensor({
      root: options?.root,
      activationDistance: options?.activationDistance,
      callbacks: {
        onArm: (args) => this._onArm(args),
        onActivate: (args) => this._onActivate(args),
        onMove: (args) => this._onMove(args),
        onEnd: (args) => this._onEnd(args),
        onCancel: (args) => this._onCancel(args),
      },
    });
  }

  attach() {
    this.sensor.attach();
  }

  detach() {
    if (this._active) this._teardownVisuals();
    this._active = null;
    this.sensor.detach();
    for (const unreg of this._sourceUnregs) unreg();
    this._sourceUnregs.clear();
    this._targets.clear();
    this._listeners.length = 0;
  }

  /** @param {import('./types.js').DragSource} source */
  registerSource(source) {
    const unreg = this.sensor.register(source);
    this._sourceUnregs.add(unreg);
    return () => {
      unreg();
      this._sourceUnregs.delete(unreg);
    };
  }

  /** @param {import('./types.js').DropTarget} target */
  registerTarget(target) {
    if (!target || !target.element) return () => {};
    this._targets.set(target.element, target);
    return () => this._targets.delete(target.element);
  }

  /** Replace the current set of drop targets atomically. */
  setTargets(targets) {
    this._targets = new Map();
    for (const t of targets ?? []) {
      if (t && t.element) this._targets.set(t.element, t);
    }
  }

  on(fn) {
    this._listeners.push(fn);
    return () => {
      const i = this._listeners.indexOf(fn);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }

  _emit(phase, extra) {
    for (const fn of this._listeners) {
      try {
        fn({ phase, ...(extra ?? {}) });
      } catch {
        /* ignore */
      }
    }
  }

  // ---- sensor callbacks ----

  _onArm({ source, origin }) {
    const payload = source.getPayload();
    if (!payload) return false;
    const rect = source.element.getBoundingClientRect?.() ?? null;
    const pickupOffset = rect
      ? { x: origin.x - rect.left, y: origin.y - rect.top }
      : { x: 0, y: 0 };
    this._active = {
      source,
      payload,
      pickupOffset,
      sourceRect: rect,
      activeTarget: null,
    };
    return true;
  }

  _onActivate({ source, pointer }) {
    if (!this._active) return;
    const preview =
      typeof source.getOverlayPreview === 'function'
        ? source.getOverlayPreview()
        : cloneSourcePreview(
            source.element,
            this._active.sourceRect ?? source.element.getBoundingClientRect(),
          );
    this.overlay.mount(preview, pointer, this._active.pickupOffset);
    this.projection.setSourceGhost(source.element, 'ghost');
    const candidates = [...this._targets.values()].filter(
      (t) => !t.accepts || t.accepts(this._active.payload),
    );
    this.projection.markCandidates(candidates.map((t) => t.element));
    this._resolveTarget(pointer);
    this._emit('dragstart');
  }

  _onMove({ pointer }) {
    if (!this._active) return;
    this.overlay.move(pointer);
    this._resolveTarget(pointer);
    this._emit('dragmove');
  }

  async _onEnd({ pointer }) {
    if (!this._active) return;
    this._resolveTarget(pointer);
    const target = this._active.activeTarget;
    let result;
    if (target && (!target.accepts || target.accepts(this._active.payload))) {
      result = await this.commit.commit({
        payload: this._active.payload,
        target,
      });
    } else {
      result = { ok: false, reason: 'no-target' };
    }
    this._teardownVisuals();
    this._active = null;
    this._emit('dropend', { result });
  }

  _onCancel() {
    if (!this._active) return;
    this._teardownVisuals();
    this._active = null;
    this._emit('cancel');
  }

  // ---- helpers ----

  _resolveTarget(pointer) {
    if (!this._active) return;
    const { payload } = this._active;
    let match = null;
    for (const target of this._targets.values()) {
      if (target.accepts && !target.accepts(payload)) continue;
      const rect = target.element.getBoundingClientRect?.();
      if (!rect) continue;
      if (
        pointer.x >= rect.left &&
        pointer.x <= rect.right &&
        pointer.y >= rect.top &&
        pointer.y <= rect.bottom
      ) {
        match = target;
        break;
      }
    }
    if (match === this._active.activeTarget) return;
    this._active.activeTarget = match;
    this.projection.setActiveTarget(match?.element ?? null);
  }

  _teardownVisuals() {
    this.overlay.unmount();
    this.projection.clear();
  }
}

/** Convenience factory. Equivalent to `new DndController(options).attach()`. */
export function createDndController(options) {
  const ctrl = new DndController(options);
  ctrl.attach();
  return ctrl;
}
