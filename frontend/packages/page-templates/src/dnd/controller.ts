/**
 * dnd/controller.ts — slim orchestrator.
 *
 * Wires PointerSensor → local per-drag state → overlay + projection →
 * commit boundary. Hit-testing is a plain pointer-in-rect walk over the
 * registered targets; there is no collision strategy, no measurement
 * cache, no autoscroll, no phase store.
 */

import { PointerSensor } from './sensor.ts';
import { Projection } from './projection.ts';
import { DragOverlay, cloneSourcePreview } from './overlay.ts';
import { CommitBoundary, type CommitArgs } from './commit.ts';
import type {
  CommitResult,
  DragPayload,
  DragSource,
  DropTarget,
  Point,
} from './types.ts';

export interface DndControllerOptions {
  root?: HTMLElement | Document;
  activationDistance?: number;
  onDrop?: (args: CommitArgs) => Promise<CommitResult> | CommitResult;
  overlayContainer?: HTMLElement;
}

interface ActiveDrag {
  source: DragSource;
  payload: DragPayload;
  pickupOffset: Point;
  sourceRect: DOMRect | null;
  activeTarget: DropTarget | null;
  target?: DropTarget | null;
}

export interface DndPhaseEvent {
  phase: 'dragstart' | 'dragmove' | 'dropend' | 'cancel';
  result?: CommitResult;
}

export class DndController {
  private _opts: DndControllerOptions;
  readonly projection: Projection;
  readonly overlay: DragOverlay;
  readonly commit: CommitBoundary;
  readonly sensor: PointerSensor;

  private _targets: Map<HTMLElement, DropTarget> = new Map();
  private _sourceUnregs: Set<() => void> = new Set();
  private _listeners: Array<(ev: DndPhaseEvent) => void> = [];

  // Per-drag transient state. Null when idle.
  _active: ActiveDrag | null = null;

  constructor(options?: DndControllerOptions) {
    this._opts = options ?? {};
    this.projection = new Projection();
    this.overlay = new DragOverlay(
      options?.overlayContainer ? { container: options.overlayContainer } : {},
    );
    this.commit = new CommitBoundary(options?.onDrop ? { onDrop: options.onDrop } : {});

    this.sensor = new PointerSensor({
      ...(options?.root ? { root: options.root } : {}),
      ...(options?.activationDistance !== undefined
        ? { activationDistance: options.activationDistance }
        : {}),
      callbacks: {
        onArm: (args) => this._onArm(args),
        onActivate: (args) => this._onActivate(args),
        onMove: (args) => this._onMove(args),
        onEnd: (args) => void this._onEnd(args),
        onCancel: () => this._onCancel(),
      },
    });
  }

  attach(): void {
    this.sensor.attach();
  }

  detach(): void {
    if (this._active) this._teardownVisuals();
    this._active = null;
    this.sensor.detach();
    for (const unreg of this._sourceUnregs) unreg();
    this._sourceUnregs.clear();
    this._targets.clear();
    this._listeners.length = 0;
  }

  registerSource(source: DragSource): () => void {
    const unreg = this.sensor.register(source);
    this._sourceUnregs.add(unreg);
    return () => {
      unreg();
      this._sourceUnregs.delete(unreg);
    };
  }

  registerTarget(target: DropTarget): () => void {
    if (!target || !target.element) return () => {};
    this._targets.set(target.element, target);
    return () => {
      this._targets.delete(target.element);
    };
  }

  /** Replace the current set of drop targets atomically. */
  setTargets(targets: Iterable<DropTarget> | null | undefined): void {
    this._targets = new Map();
    for (const t of targets ?? []) {
      if (t && t.element) this._targets.set(t.element, t);
    }
  }

  on(fn: (ev: DndPhaseEvent) => void): () => void {
    this._listeners.push(fn);
    return () => {
      const i = this._listeners.indexOf(fn);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }

  private _emit(phase: DndPhaseEvent['phase'], extra?: Partial<DndPhaseEvent>): void {
    for (const fn of this._listeners) {
      try {
        fn({ phase, ...(extra ?? {}) });
      } catch {
        /* ignore */
      }
    }
  }

  // ---- sensor callbacks ----

  private _onArm({ source, origin }: { source: DragSource; origin: Point }): boolean {
    const payload = source.getPayload();
    if (!payload) return false;
    const rect = source.element.getBoundingClientRect?.() ?? null;
    const pickupOffset: Point = rect
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

  private _onActivate({ source, pointer }: { source: DragSource; pointer: Point }): void {
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
      (t) => !t.accepts || t.accepts(this._active!.payload),
    );
    this.projection.markCandidates(candidates.map((t) => t.element));
    this._resolveTarget(pointer);
    this._emit('dragstart');
  }

  private _onMove({ pointer }: { pointer: Point }): void {
    if (!this._active) return;
    this.overlay.move(pointer);
    this._resolveTarget(pointer);
    this._emit('dragmove');
  }

  private async _onEnd({ pointer }: { pointer: Point }): Promise<void> {
    if (!this._active) return;
    this._resolveTarget(pointer);
    const target = this._active.activeTarget;
    let result: CommitResult;
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

  private _onCancel(): void {
    if (!this._active) return;
    this._teardownVisuals();
    this._active = null;
    this._emit('cancel');
  }

  // ---- helpers ----

  private _resolveTarget(pointer: Point): void {
    if (!this._active) return;
    const { payload } = this._active;
    let match: DropTarget | null = null;
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

  private _teardownVisuals(): void {
    this.overlay.unmount();
    this.projection.clear();
  }
}

/** Convenience factory. Equivalent to `new DndController(options).attach()`. */
export function createDndController(options?: DndControllerOptions): DndController {
  const ctrl = new DndController(options);
  ctrl.attach();
  return ctrl;
}
