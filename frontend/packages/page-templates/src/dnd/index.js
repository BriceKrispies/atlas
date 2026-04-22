/**
 * @atlas/page-templates/dnd — internal drag-and-drop subsystem.
 *
 * Pointer Events only. Single-slot drop targets. No reorder projection,
 * no collision strategies, no autoscroll. See ARCHITECTURE.md.
 */

export { DndController, createDndController } from './controller.js';
export { PointerSensor } from './sensor.js';
export { Projection } from './projection.js';
export { DragOverlay, cloneSourcePreview } from './overlay.js';
export { CommitBoundary } from './commit.js';
export { ensureDndStyles } from './styles.js';
