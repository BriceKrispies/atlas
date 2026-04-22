/**
 * dnd/types.js — shared JSDoc typedefs for the drag-and-drop subsystem.
 *
 * Import-free on purpose. Other modules reference these shapes through
 * `@typedef` lookups; they are not runtime values.
 */

/**
 * Screen-space coordinate pair.
 * @typedef {{ x: number, y: number }} Point
 */

/**
 * Axis-aligned bounding box in client coordinates.
 * @typedef {{ top: number, right: number, bottom: number, left: number, width: number, height: number }} Rect
 */

/**
 * Draggable payload metadata surfaced by a source descriptor.
 *
 * `type` is the kind of drag (e.g. 'cell' for an existing widget instance,
 * 'chip' for a palette add). `id` is the stable identifier inside that type.
 * `data` may carry arbitrary application context used at commit time.
 *
 * @typedef {{ type: string, id: string, data?: object }} DragPayload
 */

/**
 * Source descriptor — contributed by the part of the app that owns
 * draggable elements. The DnD subsystem only reads from this shape.
 *
 * @typedef {object} DragSource
 * @property {HTMLElement} element                — the real DOM node
 * @property {HTMLElement} [activator]            — element whose pointerdown arms the drag
 * @property {() => DragPayload} getPayload       — resolved at pointerdown
 * @property {string} [containerId]               — source container (e.g. region name)
 * @property {() => HTMLElement} [getOverlayPreview] — factory for the overlay preview node
 */

/**
 * Droppable descriptor — contributed by the app.
 *
 * @typedef {object} DropTarget
 * @property {HTMLElement} element
 * @property {string} id                           — stable id for this target
 * @property {string} containerId                  — grouping (e.g. region / slot name)
 * @property {(payload: DragPayload) => boolean} [accepts] — predicate
 * @property {object} [data]                       — passthrough to commit
 */

export {};
