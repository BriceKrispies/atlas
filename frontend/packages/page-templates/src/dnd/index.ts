/**
 * @atlas/page-templates/dnd — internal drag-and-drop subsystem.
 *
 * Pointer Events only. Single-slot drop targets. No reorder projection,
 * no collision strategies, no autoscroll. See ARCHITECTURE.md.
 */

export { DndController, createDndController } from './controller.ts';
export type { DndControllerOptions, DndPhaseEvent } from './controller.ts';
export { PointerSensor } from './sensor.ts';
export type {
  SensorCallbacks,
  PointerSensorOptions,
  SensorArmArgs,
  SensorActivateArgs,
  SensorMoveArgs,
  SensorEndArgs,
  SensorCancelArgs,
} from './sensor.ts';
export { Projection } from './projection.ts';
export type { ProjectionSourceMode } from './projection.ts';
export { DragOverlay, cloneSourcePreview } from './overlay.ts';
export type { DragOverlayOptions } from './overlay.ts';
export { CommitBoundary } from './commit.ts';
export type { CommitHandlers, CommitArgs } from './commit.ts';
export { ensureDndStyles } from './styles.ts';
export type {
  Point,
  Rect,
  DragPayload,
  DragSource,
  DropTarget,
  DragPhase,
  CommitResult,
} from './types.ts';
