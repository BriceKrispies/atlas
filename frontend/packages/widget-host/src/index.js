/**
 * @atlas/widget-host — public entry point.
 *
 * Importing this module registers the <widget-host> custom element as
 * a side effect (see host-element.js).
 */

export { WidgetRegistry, moduleDefaultRegistry } from './registry.js';
export { WidgetMediator } from './mediator.js';
export { CapabilityBridge } from './capabilities.js';
export { validateManifest } from './manifest.js';
export { validateLayout } from './layout.js';
export { buildContext } from './context.js';
export { WidgetHostElement } from './host-element.js';
export * from './errors.js';
