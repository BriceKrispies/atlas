/**
 * dnd/types.ts — shared types for the drag-and-drop subsystem.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Draggable payload metadata surfaced by a source descriptor.
 *
 * `type` is the kind of drag (e.g. 'cell' for an existing widget instance,
 * 'chip' for a palette add). `id` is the stable identifier inside that type.
 * `data` may carry arbitrary application context used at commit time.
 */
export interface DragPayload {
  type: string;
  id: string;
  data?: Record<string, unknown>;
}

/**
 * Source descriptor — contributed by the part of the app that owns
 * draggable elements. The DnD subsystem only reads from this shape.
 */
export interface DragSource {
  /** the real DOM node */
  element: HTMLElement;
  /** element whose pointerdown arms the drag */
  activator?: HTMLElement;
  /** resolved at pointerdown */
  getPayload: () => DragPayload;
  /** source container (e.g. region name) */
  containerId?: string;
  /** factory for the overlay preview node */
  getOverlayPreview?: () => HTMLElement;
}

/**
 * Droppable descriptor — contributed by the app.
 */
export interface DropTarget {
  element: HTMLElement;
  /** stable id for this target */
  id: string;
  /** grouping (e.g. region / slot name) */
  containerId: string;
  /** predicate */
  accepts?: (payload: DragPayload) => boolean;
  /** passthrough to commit */
  data?: Record<string, unknown>;
}

export type DragPhase = 'dragstart' | 'dragmove' | 'dropend' | 'cancel';

export interface CommitResult {
  ok: boolean;
  reason?: string;
  [k: string]: unknown;
}
