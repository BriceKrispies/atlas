/**
 * Shared widget host types — manifests, layouts, contexts, transport
 * envelopes. Kept in one file so every module can import from a single
 * canonical source.
 */

export type IsolationMode = 'inline' | 'shadow' | 'iframe';

export interface WidgetTopics {
  topics?: string[];
}

/**
 * The declarative manifest a widget module exports alongside its element
 * class. Validated at registration time against widget_manifest.schema.json.
 */
export interface WidgetManifest {
  widgetId: string;
  version: string;
  displayName: string;
  description?: string;
  configSchema: string;
  isolation: IsolationMode;
  capabilities?: string[];
  provides?: WidgetTopics;
  consumes?: WidgetTopics;
  [key: string]: unknown;
}

export interface LayoutEntry {
  widgetId: string;
  instanceId: string;
  config?: Record<string, unknown>;
  isolationOverride?: IsolationMode;
}

export interface PageLayout {
  version: number;
  slots: Record<string, LayoutEntry[]>;
}

export interface PageLayoutDoc {
  regions: Record<string, LayoutEntry[]>;
}

/**
 * Logger triad passed through to widgets. Compatible with `console`.
 */
export interface WidgetLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface WidgetChannel {
  publish: (topic: string, payload: unknown) => void;
  subscribe: (
    topic: string,
    handler: (payload: unknown) => unknown,
  ) => () => void;
  request: (
    topic: string,
    payload: unknown,
    opts?: { timeoutMs?: number },
  ) => Promise<unknown>;
}

/**
 * The `context` object injected into a widget instance before mount.
 */
export interface WidgetContext {
  correlationId: string;
  principal: unknown;
  tenantId: string;
  locale: string;
  theme: string;
  channel: WidgetChannel;
  request: (capability: string, args: unknown) => Promise<unknown>;
  log: WidgetLogger;
}

/**
 * Trace event shapes emitted by the capability bridge.
 */
export type CapabilityTraceEvent =
  | {
      kind: 'denied';
      instanceId: string;
      capability: string;
      reason: 'unknown-instance' | 'undeclared' | 'no-handler';
    }
  | {
      kind: 'invoke';
      instanceId: string;
      capability: string;
      args: unknown;
    }
  | {
      kind: 'resolve';
      instanceId: string;
      capability: string;
      value: unknown;
    }
  | {
      kind: 'reject';
      instanceId: string;
      capability: string;
      error: unknown;
    };

/**
 * Trace event shapes emitted by the mediator.
 */
export type MediatorTraceEvent =
  | {
      kind: 'publish';
      from: string;
      topic: string;
      payload: unknown;
      subscriberCount: number;
    }
  | {
      kind: 'deliver';
      from: string;
      to: string;
      topic: string;
      payload: unknown;
    }
  | { kind: 'subscribe'; instanceId: string; topic: string }
  | { kind: 'unsubscribe'; instanceId: string; topic: string };

/**
 * A capability handler registered with the bridge.
 */
export type CapabilityHandler = (
  args: unknown,
  ctx: {
    instanceId: string;
    manifest: WidgetManifest;
    correlationId: string | undefined;
  },
) => Promise<unknown> | unknown;

/**
 * Widget element class contract — what the host assumes about widget
 * implementations. We only require construction and optional lifecycle
 * hooks; anything beyond that is widget-specific.
 */
export interface WidgetElementInstance extends HTMLElement {
  config?: unknown;
  context?: WidgetContext | undefined;
  instanceId?: string | undefined;
  onUnmount?: (() => void) | undefined;
}

export type WidgetElementClass = new () => WidgetElementInstance;

export interface WidgetRegistration {
  manifest: WidgetManifest;
  element: WidgetElementClass;
  schema: Record<string, unknown> | null;
}

/** Shape returned by <widget-host>.resolveWidgetModuleUrl. */
export type ResolvedWidgetModule =
  | string
  | null
  | undefined
  | { url: string; supportUrls?: string[] };

export type ResolveWidgetModuleUrl = (
  widgetId: string,
) => ResolvedWidgetModule;

/**
 * Arguments passed to a host strategy's mount function.
 */
export interface HostMountArgs {
  manifest: WidgetManifest;
  config: Record<string, unknown>;
  context: WidgetContext;
  instanceId: string;
  hostContainer: HTMLElement;
  ElementClass?: WidgetElementClass;
  onError: (err: unknown) => void;
  widgetModuleUrl?: string | null;
  supportModuleUrls?: string[];
}

export type HostMountFn = (args: HostMountArgs) => Promise<() => void>;

/**
 * Incremental mutation info passed to <widget-host>.applyMutation.
 */
export interface MutationInfo {
  action: 'add' | 'remove' | 'move' | 'update';
  instanceId: string;
  from?: { region: string; index?: number };
  to?: { region: string; index?: number };
  nextDoc: PageLayoutDoc;
}

// ---- postMessage transport envelopes --------------------------------

export interface ReadyEnvelope {
  kind: 'widget-ready';
}

export interface PublishEnvelope {
  kind: 'publish';
  topic: string;
  payload: unknown;
}

export interface CapabilityInvokeEnvelope {
  kind: 'capability.invoke';
  id: string;
  capability: string;
  payload: unknown;
}

export interface CapabilityAckEnvelope {
  kind: 'capability.ack';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message: string; name?: string };
}

export interface InitEnvelope {
  kind: 'init';
  config: Record<string, unknown>;
  context: {
    correlationId: string;
    principal: unknown;
    tenantId: string;
    locale: string;
    theme: string;
  };
  manifest: {
    widgetId: string;
    version: string;
    capabilities: string[];
  };
  instanceId: string;
  widgetModuleUrl: string;
  supportModuleUrls: string[];
}

/** Messages the iframe sends to the host. */
export type WidgetToHostMessage =
  | ReadyEnvelope
  | PublishEnvelope
  | CapabilityInvokeEnvelope;

/** Messages the host sends to the iframe. */
export type HostToWidgetMessage = InitEnvelope | CapabilityAckEnvelope;
