/**
 * <widget-host> — the page-side surface that mounts widget instances
 * onto a validated layout. Owns exactly one mediator and one capability
 * bridge per mount; surrounds each widget mount with an error boundary
 * so a sibling failure never cascades (INV-WIDGET-07).
 *
 * This module self-registers the custom element on import so consumers
 * can simply `import '@atlas/widget-host'` to use <widget-host>.
 */

import { AtlasElement, html } from '@atlas/core';

import { validateLayout } from './layout.ts';
import { WidgetMediator } from './mediator.ts';
import { CapabilityBridge } from './capabilities.ts';
import { buildContext } from './context.ts';
import { moduleDefaultRegistry, WidgetRegistry } from './registry.ts';
import {
  WidgetManifestError,
  WidgetIsolationError,
} from './errors.ts';
import { mount as inlineMount } from './hosts/inline-host.ts';
import { mount as shadowMount } from './hosts/shadow-host.ts';
import { mount as iframeMount } from './hosts/iframe-host.ts';
import type {
  CapabilityHandler,
  CapabilityTraceEvent,
  HostMountFn,
  IsolationMode,
  LayoutEntry,
  MediatorTraceEvent,
  MutationInfo,
  PageLayout,
  ResolvedWidgetModule,
  ResolveWidgetModuleUrl,
  WidgetRegistration,
} from './types.ts';

interface TelemetryPayload {
  widgetId?: string;
  instanceId?: string;
  correlationId?: string;
  phase?: string;
  message?: string;
  isolation?: IsolationMode;
  elapsedMs?: number;
}

interface MountedRecord {
  instanceId: string;
  unmount: () => void;
}

interface MountEntryArgs {
  registry: WidgetRegistry;
  slotEl: HTMLElement;
  slotName: string;
  entry: LayoutEntry;
}

function selectHost(isolation: string): HostMountFn {
  switch (isolation) {
    case 'inline':
      return inlineMount;
    case 'shadow':
      return shadowMount;
    case 'iframe':
      return iframeMount;
    default:
      throw new WidgetIsolationError(`unknown isolation mode: ${isolation}`);
  }
}

function telemetry(event: string, payload: TelemetryPayload): void {
  // Errors go to console.error so they show up at default DevTools log
  // levels (console.debug is hidden by default). Non-error lifecycle
  // events stay on console.debug so they don't spam normal sessions.
  // eslint-disable-next-line no-console
  const fn =
    event === 'atlas.widget.error' ? console.error : console.debug;
  fn(event, payload);
}

export class WidgetHostElement extends AtlasElement {
  private _layout: PageLayout | null = null;
  private _registry: WidgetRegistry | null = null;

  principal: unknown = null;
  tenantId: string = '';
  locale: string = 'en';
  theme: string = 'default';
  correlationId: string = '';
  capabilities: Record<string, CapabilityHandler> = {};

  /**
   * Optional hook that returns the resolved module URL for a
   * widget. Required for iframe isolation because a sandboxed
   * frame cannot resolve bare specifiers. Host strategies that
   * don't need it (inline/shadow) ignore the value.
   */
  resolveWidgetModuleUrl: ResolveWidgetModuleUrl | null = null;

  /**
   * Optional trace hook that receives pub/sub lifecycle events from
   * the per-mount mediator. Set before mount (before layout assignment
   * or attaching to the DOM) — applied when the mediator is created.
   */
  onMediatorTrace: ((event: MediatorTraceEvent) => void) | null = null;

  /**
   * Optional trace hook for capability bridge invoke/resolve/reject/denied
   * events. Same timing rules as onMediatorTrace.
   */
  onCapabilityTrace: ((event: CapabilityTraceEvent) => void) | null = null;

  private _mediator: WidgetMediator | null = null;
  private _bridge: CapabilityBridge | null = null;
  private _mounted: MountedRecord[] = [];

  // ---- properties ----

  set layout(value: PageLayout | null) {
    this._layout = value;
    // If already connected, re-mount.
    if (this.isConnected) {
      this._teardown();
      this._mountAll();
    }
  }

  get layout(): PageLayout | null {
    return this._layout;
  }

  set registry(value: WidgetRegistry | null) {
    this._registry = value;
  }

  get registry(): WidgetRegistry {
    return this._registry ?? moduleDefaultRegistry;
  }

  /** The per-mount mediator, or null before mount / after teardown. */
  get mediator(): WidgetMediator | null {
    return this._mediator;
  }

  /** The per-mount capability bridge, or null before mount / after teardown. */
  get bridge(): CapabilityBridge | null {
    return this._bridge;
  }

  // ---- lifecycle ----

  override connectedCallback(): void {
    // Intentionally bypass AtlasElement's reactive effect() setup —
    // this host manages its own children imperatively across multiple
    // hostStrategy mount points. We still honor the test-id convention.
    this._applyTestId();
    this._mountAll();
    this.onMount();
  }

  override disconnectedCallback(): void {
    this.onUnmount();
    this._teardown();
  }

  override render(): DocumentFragment | void {
    // Not used — connectedCallback drives rendering via _mountAll so we
    // can place widgets into per-slot containers with stable identities.
    return;
  }

  // ---- internal ----

  private _teardown(): void {
    for (const { instanceId, unmount } of this._mounted) {
      try {
        unmount();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[widget-host] unmount threw', { instanceId, err });
      }
      telemetry('atlas.widget.unmount', {
        instanceId,
        correlationId: this.correlationId,
      });
      try {
        this._mediator?.revokeInstance(instanceId);
        this._bridge?.revokeInstance(instanceId);
      } catch {
        /* best effort */
      }
    }
    this._mounted = [];
    this._mediator = null;
    this._bridge = null;
    // Preserve existing <section data-slot> elements — their positioning /
    // styling is owned by whichever parent (e.g. <atlas-layout>, a static
    // template, or the editor's chrome) put them there. Just clear the
    // widget contents inside each.
    for (const sec of this.querySelectorAll(
      ':scope > section[data-slot]',
    )) {
      sec.textContent = '';
    }
  }

  private _renderLayoutError(message: string): void {
    this.textContent = '';
    this.appendChild(
      html`
        <atlas-box padding="md">
          <atlas-text variant="error" name="layout-error"
            >${message}</atlas-text
          >
        </atlas-box>
      `,
    );
  }

  private _renderWidgetError(
    slotEl: HTMLElement,
    message: string,
    instanceId: string,
  ): void {
    const cell = html`
      <atlas-box
        padding="sm"
        data-widget-error
        data-widget-instance-id="${instanceId}"
      >
        <atlas-text variant="error" name="widget-error">${message}</atlas-text>
      </atlas-box>
    `;
    slotEl.appendChild(cell);
  }

  private _mountAll(): void {
    const layout = this._layout;
    if (layout == null) {
      this._renderLayoutError('Layout is missing.');
      return;
    }
    const { ok, errors } = validateLayout(layout);
    if (!ok) {
      const msg =
        'Invalid layout: ' +
        errors.map((e) => `${e.path} ${e.message}`).join('; ');
      this._renderLayoutError(msg);
      telemetry('atlas.widget.error', {
        phase: 'layout-validate',
        correlationId: this.correlationId,
        message: msg,
      });
      return;
    }

    // Fresh mediator + bridge per mount.
    this._mediator = new WidgetMediator(
      this.onMediatorTrace ? { onTrace: this.onMediatorTrace } : {},
    );
    this._bridge = new CapabilityBridge(
      this.onCapabilityTrace ? { onTrace: this.onCapabilityTrace } : {},
    );
    for (const [name, handler] of Object.entries(this.capabilities ?? {})) {
      this._bridge.register(name, handler);
    }

    const registry = this.registry;

    // Reuse any <section data-slot> the parent already placed (e.g. from
    // <atlas-layout>) so its inline grid positioning survives. Create a
    // section on the fly for any slot name that doesn't have one yet.
    const existing = new Map<string, HTMLElement>();
    for (const sec of this.querySelectorAll(
      ':scope > section[data-slot]',
    )) {
      const name = sec.getAttribute('data-slot');
      if (name) existing.set(name, sec as HTMLElement);
      sec.textContent = '';
    }

    for (const [slotName, entries] of Object.entries(layout.slots)) {
      let slotEl = existing.get(slotName);
      if (slotEl) {
        existing.delete(slotName);
      } else {
        slotEl = document.createElement('section');
        slotEl.setAttribute('data-slot', slotName);
        this.appendChild(slotEl);
      }
      for (const entry of entries) {
        this._mountEntry({ registry, slotEl, slotName, entry });
      }
    }

    // Any pre-existing section not named by the current layout is an
    // orphan — remove it so the DOM reflects the new layout exactly.
    for (const sec of existing.values()) {
      sec.remove();
    }
  }

  /**
   * Apply a single incremental mutation without tearing down unrelated
   * widgets. Keeps sections and every untouched widget in place so the
   * surrounding layout never reflows on an edit commit.
   *
   * @returns true if applied incrementally; false if caller should fall
   *   back to a full remount.
   */
  applyMutation(info: MutationInfo): boolean {
    const currentLayout = this._layout;
    if (!currentLayout || !this._mediator) return false;
    const { action, instanceId, to, nextDoc } = info ?? {};
    if (!action || !nextDoc || !nextDoc.regions) return false;

    switch (action) {
      case 'add': {
        const slotName = to?.region;
        if (!slotName) return false;
        const slotEl = this._slotEl(slotName);
        if (!slotEl) return false;
        const entry = (nextDoc.regions[slotName] ?? []).find(
          (e) => e.instanceId === instanceId,
        );
        if (!entry) return false;
        this._mountEntry({
          registry: this.registry,
          slotEl,
          slotName,
          entry,
        });
        this._layout = { ...currentLayout, slots: nextDoc.regions };
        return true;
      }
      case 'remove': {
        if (!this._unmountInstance(instanceId)) return false;
        this._layout = { ...currentLayout, slots: nextDoc.regions };
        return true;
      }
      case 'move': {
        const targetSlot = to?.region;
        if (!targetSlot) return false;
        const targetSlotEl = this._slotEl(targetSlot);
        if (!targetSlotEl) return false;
        const entry = (nextDoc.regions[targetSlot] ?? []).find(
          (e) => e.instanceId === instanceId,
        );
        if (!entry) return false;
        // Same-slot move is a no-op at the DOM level (slot model is 1 widget
        // per slot; an in-place move just keeps the existing cell).
        if (info.from?.region === targetSlot) {
          this._layout = { ...currentLayout, slots: nextDoc.regions };
          return true;
        }
        this._unmountInstance(instanceId);
        this._mountEntry({
          registry: this.registry,
          slotEl: targetSlotEl,
          slotName: targetSlot,
          entry,
        });
        this._layout = { ...currentLayout, slots: nextDoc.regions };
        return true;
      }
      case 'update': {
        // Find which region holds the widget in the new doc.
        let region: string | null = null;
        for (const r of Object.keys(nextDoc.regions)) {
          const entries = nextDoc.regions[r] ?? [];
          if (entries.some((e) => e.instanceId === instanceId)) {
            region = r;
            break;
          }
        }
        if (!region) return false;
        const slotEl = this._slotEl(region);
        if (!slotEl) return false;
        const entry = (nextDoc.regions[region] ?? []).find(
          (e) => e.instanceId === instanceId,
        );
        if (!entry) return false;
        this._unmountInstance(instanceId);
        this._mountEntry({
          registry: this.registry,
          slotEl,
          slotName: region,
          entry,
        });
        this._layout = { ...currentLayout, slots: nextDoc.regions };
        return true;
      }
      default:
        return false;
    }
  }

  private _slotEl(slotName: string): HTMLElement | null {
    return this.querySelector<HTMLElement>(
      `:scope > section[data-slot="${slotName}"]`,
    );
  }

  private _unmountInstance(instanceId: string): boolean {
    const mounted = this._mounted.find((m) => m.instanceId === instanceId);
    if (!mounted) return false;
    try {
      mounted.unmount();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[widget-host] incremental unmount threw', {
        instanceId,
        err,
      });
    }
    try {
      this._mediator?.revokeInstance(instanceId);
      this._bridge?.revokeInstance(instanceId);
    } catch {
      /* best effort */
    }
    this._mounted = this._mounted.filter(
      (m) => m.instanceId !== instanceId,
    );
    const cell = this.querySelector(
      `:scope > section > [data-widget-cell][data-widget-instance-id="${instanceId}"]`,
    );
    if (cell && cell.parentNode) cell.parentNode.removeChild(cell);
    telemetry('atlas.widget.unmount', {
      instanceId,
      correlationId: this.correlationId,
    });
    return true;
  }

  private _mountEntry({
    registry,
    slotEl,
    entry,
  }: MountEntryArgs): void {
    const {
      widgetId,
      instanceId,
      config = {},
      isolationOverride,
    } = entry;

    let registration: WidgetRegistration;
    try {
      registration = registry.get(widgetId);
    } catch (err) {
      const msg =
        err instanceof WidgetManifestError
          ? err.message
          : `unknown widget '${widgetId}'`;
      this._renderWidgetError(slotEl, msg, instanceId);
      telemetry('atlas.widget.error', {
        widgetId,
        instanceId,
        correlationId: this.correlationId,
        phase: 'resolve',
        message: msg,
      });
      return;
    }

    const { manifest, element: ElementClass } = registration;

    // TODO(schema-registry): once the widget config schema registry
    // exists, resolve manifest.configSchema and validate `config` here
    // (INV-WIDGET-06). For now we accept the config as-is.

    const isolation: IsolationMode = isolationOverride ?? manifest.isolation;

    let hostStrategy: HostMountFn;
    try {
      hostStrategy = selectHost(isolation);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._renderWidgetError(slotEl, msg, instanceId);
      telemetry('atlas.widget.error', {
        widgetId,
        instanceId,
        correlationId: this.correlationId,
        phase: 'host-select',
        message: msg,
      });
      return;
    }

    const cellContainer = document.createElement('div');
    cellContainer.setAttribute('data-widget-cell', '');
    cellContainer.setAttribute('data-widget-instance-id', instanceId);
    slotEl.appendChild(cellContainer);

    try {
      this._mediator!.registerInstance(instanceId, manifest);
      this._bridge!.registerInstance(instanceId, manifest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._renderWidgetError(cellContainer, msg, instanceId);
      telemetry('atlas.widget.error', {
        widgetId,
        instanceId,
        correlationId: this.correlationId,
        phase: 'permission-register',
        message: msg,
      });
      return;
    }

    const context = buildContext({
      principal: this.principal,
      tenantId: this.tenantId,
      correlationId: this.correlationId,
      locale: this.locale,
      theme: this.theme,
      mediator: this._mediator!,
      bridge: this._bridge!,
      widgetInstanceId: instanceId,
      widgetManifest: manifest,
    });

    const started = Date.now();
    let unmount: () => void = () => {};
    let mountFailed = false;

    const onError = (err: unknown): void => {
      mountFailed = true;
      const msg = err instanceof Error ? err.message : String(err);
      this._renderWidgetError(cellContainer, msg, instanceId);
      telemetry('atlas.widget.error', {
        widgetId,
        instanceId,
        correlationId: this.correlationId,
        phase: 'mount',
        message: msg,
      });
    };

    // hostStrategy.mount returns a Promise; await it synchronously via
    // .then — we still register the unmount tracker once it resolves so
    // teardown works correctly even if mount is still pending.
    // resolveWidgetModuleUrl may return a string URL (shorthand) or
    // { url, supportUrls } — the latter lets the host declare extra
    // module URLs the iframe must import before the widget (e.g.
    // @atlas/design to register custom elements in the iframe realm).
    const resolved: ResolvedWidgetModule =
      typeof this.resolveWidgetModuleUrl === 'function'
        ? this.resolveWidgetModuleUrl(widgetId)
        : null;
    const widgetModuleUrl: string | null =
      resolved && typeof resolved === 'object'
        ? resolved.url
        : (resolved ?? null);
    const supportModuleUrls: string[] =
      resolved &&
      typeof resolved === 'object' &&
      Array.isArray(resolved.supportUrls)
        ? resolved.supportUrls
        : [];

    const pending = Promise.resolve()
      .then(() =>
        hostStrategy({
          manifest,
          config,
          context,
          instanceId,
          hostContainer: cellContainer,
          ElementClass,
          onError,
          widgetModuleUrl,
          supportModuleUrls,
        }),
      )
      .then((fn) => {
        unmount = typeof fn === 'function' ? fn : () => {};
        if (!mountFailed) {
          telemetry('atlas.widget.mount', {
            widgetId,
            instanceId,
            correlationId: this.correlationId,
            isolation,
            elapsedMs: Date.now() - started,
          });
        }
      })
      .catch((err) => onError(err));

    this._mounted.push({
      instanceId,
      unmount: (): void => {
        // Ensure mount resolution finished before unmount attempts to
        // tear down. We detach by awaiting the chain, but fall back to
        // the most recent `unmount` closure.
        try {
          unmount();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[widget-host] unmount threw', {
            instanceId,
            err,
          });
        }
      },
    });

    // Swallow the pending chain — errors are already surfaced via onError.
    void pending;
  }
}

if (typeof customElements !== 'undefined') {
  AtlasElement.define('widget-host', WidgetHostElement);
}
