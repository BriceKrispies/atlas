/**
 * @atlas/widget-host — public entry point.
 *
 * Importing this module registers the <widget-host> custom element as
 * a side effect (see host-element.ts).
 */

export { WidgetRegistry, moduleDefaultRegistry } from './registry.ts';
export { WidgetMediator } from './mediator.ts';
export { CapabilityBridge } from './capabilities.ts';
export { validateManifest } from './manifest.ts';
export { validateLayout } from './layout.ts';
export { buildContext } from './context.ts';
export { WidgetHostElement } from './host-element.ts';
export * from './errors.ts';
export type {
  CapabilityHandler,
  CapabilityTraceEvent,
  HostMountArgs,
  HostMountFn,
  HostToWidgetMessage,
  InitEnvelope,
  IsolationMode,
  LayoutEntry,
  MediatorTraceEvent,
  MutationInfo,
  PageLayout,
  PageLayoutDoc,
  ResolvedWidgetModule,
  ResolveWidgetModuleUrl,
  WidgetChannel,
  WidgetContext,
  WidgetElementClass,
  WidgetElementInstance,
  WidgetLogger,
  WidgetManifest,
  WidgetRegistration,
  WidgetToHostMessage,
} from './types.ts';
