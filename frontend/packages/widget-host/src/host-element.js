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

import { validateLayout } from './layout.js';
import { WidgetMediator } from './mediator.js';
import { CapabilityBridge } from './capabilities.js';
import { buildContext } from './context.js';
import { moduleDefaultRegistry } from './registry.js';
import {
  WidgetManifestError,
  WidgetIsolationError,
} from './errors.js';
import { mount as inlineMount } from './hosts/inline-host.js';
import { mount as shadowMount } from './hosts/shadow-host.js';
import { mount as iframeMount } from './hosts/iframe-host.js';

/**
 * @param {string} isolation
 */
function selectHost(isolation) {
  switch (isolation) {
    case 'inline':
      return inlineMount;
    case 'shadow':
      return shadowMount;
    case 'iframe':
      return iframeMount;
    default:
      throw new WidgetIsolationError(
        `unknown isolation mode: ${isolation}`,
      );
  }
}

function telemetry(event, payload) {
  // Errors go to console.error so they show up at default DevTools log
  // levels (console.debug is hidden by default). Non-error lifecycle
  // events stay on console.debug so they don't spam normal sessions.
  // eslint-disable-next-line no-console
  const fn = event === 'atlas.widget.error' ? console.error : console.debug;
  fn(event, payload);
}

export class WidgetHostElement extends AtlasElement {
  constructor() {
    super();
    /** @type {object | null} */
    this._layout = null;
    /** @type {import('./registry.js').WidgetRegistry | null} */
    this._registry = null;
    /** @type {object | null} */
    this.principal = null;
    /** @type {string} */
    this.tenantId = '';
    /** @type {string} */
    this.locale = 'en';
    /** @type {string} */
    this.theme = 'default';
    /** @type {string} */
    this.correlationId = '';
    /** @type {Record<string, Function>} */
    this.capabilities = {};
    /**
     * Optional hook that returns the resolved module URL for a
     * widget. Required for iframe isolation because a sandboxed
     * frame cannot resolve bare specifiers. Host strategies that
     * don't need it (inline/shadow) ignore the value.
     * @type {((widgetId: string) => (string | null | undefined)) | null}
     */
    this.resolveWidgetModuleUrl = null;
    /**
     * Optional trace hook that receives pub/sub lifecycle events from
     * the per-mount mediator. Set before mount (before layout assignment
     * or attaching to the DOM) — applied when the mediator is created.
     * @type {((event: object) => void) | null}
     */
    this.onMediatorTrace = null;
    /**
     * Optional trace hook for capability bridge invoke/resolve/reject/denied
     * events. Same timing rules as onMediatorTrace.
     * @type {((event: object) => void) | null}
     */
    this.onCapabilityTrace = null;

    /** @type {WidgetMediator | null} */
    this._mediator = null;
    /** @type {CapabilityBridge | null} */
    this._bridge = null;
    /** @type {Array<{ instanceId: string, unmount: () => void }>} */
    this._mounted = [];
  }

  // ---- properties ----

  set layout(value) {
    this._layout = value;
    // If already connected, re-mount.
    if (this.isConnected) {
      this._teardown();
      this._mountAll();
    }
  }

  get layout() {
    return this._layout;
  }

  set registry(value) {
    this._registry = value;
  }

  get registry() {
    return this._registry ?? moduleDefaultRegistry;
  }

  /** The per-mount mediator, or null before mount / after teardown. */
  get mediator() {
    return this._mediator;
  }

  /** The per-mount capability bridge, or null before mount / after teardown. */
  get bridge() {
    return this._bridge;
  }

  // ---- lifecycle ----

  connectedCallback() {
    // Intentionally bypass AtlasElement's reactive effect() setup —
    // this host manages its own children imperatively across multiple
    // hostStrategy mount points. We still honor the test-id convention.
    this._applyTestId();
    this._mountAll();
    this.onMount();
  }

  disconnectedCallback() {
    this.onUnmount();
    this._teardown();
  }

  render() {
    // Not used — connectedCallback drives rendering via _mountAll so we
    // can place widgets into per-slot containers with stable identities.
  }

  // ---- internal ----

  _teardown() {
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
    this.textContent = '';
  }

  _renderLayoutError(message) {
    this.textContent = '';
    this.appendChild(
      html`
        <atlas-box padding="md">
          <atlas-text variant="error" name="layout-error">${message}</atlas-text>
        </atlas-box>
      `,
    );
  }

  _renderWidgetError(slotEl, message, instanceId) {
    const cell = html`
      <atlas-box padding="sm" data-widget-error data-widget-instance-id="${instanceId}">
        <atlas-text variant="error" name="widget-error">${message}</atlas-text>
      </atlas-box>
    `;
    slotEl.appendChild(cell);
  }

  _mountAll() {
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
    this._mediator = new WidgetMediator({ onTrace: this.onMediatorTrace });
    this._bridge = new CapabilityBridge({ onTrace: this.onCapabilityTrace });
    for (const [name, handler] of Object.entries(this.capabilities ?? {})) {
      this._bridge.register(name, handler);
    }

    this.textContent = '';
    const registry = this.registry;

    for (const [slotName, entries] of Object.entries(layout.slots)) {
      const slotEl = document.createElement('section');
      slotEl.setAttribute('data-slot', slotName);
      this.appendChild(slotEl);

      for (const entry of entries) {
        this._mountEntry({ registry, slotEl, slotName, entry });
      }
    }
  }

  _mountEntry({ registry, slotEl, slotName, entry }) {
    const { widgetId, instanceId, config = {}, isolationOverride } = entry;

    let registration;
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

    const isolation = isolationOverride ?? manifest.isolation;

    let hostStrategy;
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
      this._mediator.registerInstance(instanceId, manifest);
      this._bridge.registerInstance(instanceId, manifest);
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
      mediator: this._mediator,
      bridge: this._bridge,
      widgetInstanceId: instanceId,
      widgetManifest: manifest,
    });

    const started = Date.now();
    let unmount = () => {};
    let mountFailed = false;

    const onError = (err) => {
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
    const resolved =
      typeof this.resolveWidgetModuleUrl === 'function'
        ? this.resolveWidgetModuleUrl(widgetId)
        : null;
    const widgetModuleUrl =
      resolved && typeof resolved === 'object' ? resolved.url : resolved;
    const supportModuleUrls =
      resolved && typeof resolved === 'object' && Array.isArray(resolved.supportUrls)
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
      unmount: () => {
        // Ensure mount resolution finished before unmount attempts to
        // tear down. We detach by awaiting the chain, but fall back to
        // the most recent `unmount` closure.
        try {
          unmount();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[widget-host] unmount threw', { instanceId, err });
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
