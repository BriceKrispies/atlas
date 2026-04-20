/**
 * <widget-harness> — sandbox-only development rig for widgets.
 *
 * Given a fixture spec and a widgetId, it:
 *   1. Looks up the widget's manifest in the module-default registry to
 *      learn its declared capabilities and topics.
 *   2. Builds mock capabilities from `spec.capabilities` (fixture / delay
 *      / reject / hang behaviors).
 *   3. Mounts the widget into a real <widget-host>, using the same
 *      isolation mode the widget normally runs in (or an override).
 *   4. Attaches trace hooks on the per-mount mediator + bridge so every
 *      publish, deliver, subscribe, capability.invoke/resolve/reject is
 *      surfaced into the event log.
 *   5. Exposes a synthetic publisher: any topic the widget consumes can
 *      be published by the harness on demand, to drive inbound events.
 *
 * Lives in the sandbox app today. If it earns its keep, it can be moved
 * to a `@atlas/widget-harness` package without code changes — it only
 * depends on public widget-host exports.
 */

import { AtlasElement } from '@atlas/core';
import { moduleDefaultRegistry } from '@atlas/widget-host';
import { buildMockCapabilities } from './mock-capabilities.js';

const HARNESS_SYNTHETIC_ID = 'harness:synthetic';

const styles = `
  :host {
    display: block;
    font-family: var(--atlas-font-family);
  }
  .layout {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: var(--atlas-space-md);
  }
  .col { min-width: 0; }
  .variant-bar {
    display: flex;
    gap: 1px;
    margin-bottom: var(--atlas-space-sm);
    background: var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
    overflow: hidden;
    flex-wrap: wrap;
  }
  .variant-btn {
    flex: 1 0 auto;
    padding: 4px 10px;
    border: none;
    background: var(--atlas-color-surface);
    font: inherit;
    font-size: var(--atlas-font-size-xs);
    color: var(--atlas-color-text-muted);
    cursor: pointer;
  }
  .variant-btn[aria-pressed="true"] {
    background: var(--atlas-color-primary);
    color: var(--atlas-color-text-inverse);
  }
  .panel {
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
    background: var(--atlas-color-surface);
    margin-bottom: var(--atlas-space-sm);
  }
  .panel-title {
    padding: 6px 10px;
    font-size: var(--atlas-font-size-xs);
    font-weight: var(--atlas-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--atlas-color-text-muted);
    border-bottom: 1px solid var(--atlas-color-border);
  }
  .panel-body {
    padding: 8px 10px;
    font-family: var(--atlas-font-mono);
    font-size: var(--atlas-font-size-xs);
    max-height: 220px;
    overflow-y: auto;
  }
  .log-line {
    padding: 2px 0;
    border-bottom: 1px dashed var(--atlas-color-border);
    word-break: break-all;
    white-space: pre-wrap;
  }
  .log-line:last-child { border-bottom: none; }
  .log-kind {
    display: inline-block;
    min-width: 96px;
    font-weight: var(--atlas-font-weight-semibold);
    color: var(--atlas-color-primary);
  }
  .log-empty { color: var(--atlas-color-text-muted); }
  .mount-area {
    padding: var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    min-height: 120px;
  }
  .meta {
    font-size: var(--atlas-font-size-xs);
    color: var(--atlas-color-text-muted);
    margin-bottom: var(--atlas-space-sm);
  }
  .publish-row {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 4px 0;
    border-bottom: 1px dashed var(--atlas-color-border);
  }
  .publish-row:last-child { border-bottom: none; }
  .publish-row button {
    padding: 2px 8px;
    font: inherit;
    font-size: var(--atlas-font-size-xs);
    cursor: pointer;
    background: var(--atlas-color-surface-hover);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
  }
  .publish-row code {
    font-size: var(--atlas-font-size-xs);
    color: var(--atlas-color-text);
  }
  .no-topics { color: var(--atlas-color-text-muted); font-style: italic; }
`;

export class WidgetHarnessElement extends AtlasElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    /** @type {object | null} */
    this.spec = null;
    /** @type {string} */
    this.widgetId = '';
    /** @type {((widgetId: string) => (string | {url: string, supportUrls?: string[]} | null)) | null} */
    this.resolveWidgetModuleUrl = null;

    /** @type {HTMLElement | null} */
    this._host = null;
    /** @type {Array<() => void>} */
    this._cleanups = [];
    this._mediatorLogEl = null;
    this._capabilityLogEl = null;
    this._activeVariant = null;
  }

  connectedCallback() {
    super.connectedCallback();
    queueMicrotask(() => this._render());
  }

  disconnectedCallback() {
    this._teardown();
  }

  _teardown() {
    for (const fn of this._cleanups) {
      try { fn(); } catch { /* ignore */ }
    }
    this._cleanups = [];
    if (this._host) {
      try { this._host.remove(); } catch { /* ignore */ }
      this._host = null;
    }
  }

  _render() {
    const spec = this.spec ?? { configVariants: [], capabilities: {}, synthetic: { publishes: [] } };
    const widgetId = this.widgetId || spec.widgetId;
    const registration = widgetId ? moduleDefaultRegistry.get(widgetId) : null;
    const manifest = registration?.manifest ?? null;

    const variants = Array.isArray(spec.configVariants) && spec.configVariants.length > 0
      ? spec.configVariants
      : [{ name: 'default', config: {} }];
    const active = this._activeVariant
      ? (variants.find((v) => v.name === this._activeVariant) ?? variants[0])
      : variants[0];
    this._activeVariant = active.name;

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="meta">
        <strong>${spec.displayName ?? widgetId ?? '(no widget)'}</strong>
        &nbsp;·&nbsp;
        widgetId: <code>${widgetId ?? '?'}</code>
        &nbsp;·&nbsp;
        isolation: <code>${active.isolation ?? manifest?.isolation ?? '?'}</code>
      </div>
      <div class="variant-bar" data-role="variants"></div>
      <div class="layout">
        <div class="col">
          <div class="mount-area" data-role="mount"></div>
        </div>
        <div class="col">
          <div class="panel">
            <div class="panel-title">Synthetic publish (widget consumes)</div>
            <div class="panel-body" data-role="publishes"></div>
          </div>
          <div class="panel">
            <div class="panel-title">Mediator events</div>
            <div class="panel-body" data-role="mediator-log"><div class="log-empty">(no events yet)</div></div>
          </div>
          <div class="panel">
            <div class="panel-title">Capability calls</div>
            <div class="panel-body" data-role="capability-log"><div class="log-empty">(no calls yet)</div></div>
          </div>
        </div>
      </div>
    `;

    const variantBar = this.shadowRoot.querySelector('[data-role="variants"]');
    for (const v of variants) {
      const btn = document.createElement('button');
      btn.className = 'variant-btn';
      btn.textContent = v.name;
      btn.setAttribute('aria-pressed', v.name === active.name ? 'true' : 'false');
      btn.addEventListener('click', () => {
        this._activeVariant = v.name;
        this._render();
      });
      variantBar.appendChild(btn);
    }

    const publishesEl = this.shadowRoot.querySelector('[data-role="publishes"]');
    const widgetConsumes = manifest?.consumes?.topics ?? [];
    const syntheticPublishes = Array.isArray(spec.synthetic?.publishes) ? spec.synthetic.publishes : [];
    const rows = syntheticPublishes.length > 0
      ? syntheticPublishes
      : widgetConsumes.map((t) => ({ name: t, topic: t, payload: {} }));
    if (rows.length === 0) {
      publishesEl.innerHTML = `<div class="no-topics">Widget declares no consumed topics.</div>`;
    } else {
      publishesEl.innerHTML = '';
      for (const row of rows) {
        const line = document.createElement('div');
        line.className = 'publish-row';
        line.innerHTML = `
          <button type="button">publish</button>
          <code>${row.topic}</code>
        `;
        line.querySelector('button').addEventListener('click', () => {
          this._publishSynthetic(row.topic, row.payload ?? {});
        });
        publishesEl.appendChild(line);
      }
    }

    this._mediatorLogEl = this.shadowRoot.querySelector('[data-role="mediator-log"]');
    this._capabilityLogEl = this.shadowRoot.querySelector('[data-role="capability-log"]');

    const mountEl = this.shadowRoot.querySelector('[data-role="mount"]');
    this._mountWidget(mountEl, widgetId, active, manifest);
  }

  _mountWidget(container, widgetId, variant, manifest) {
    this._teardown();

    const host = document.createElement('widget-host');
    host.correlationId = `harness-${Math.random().toString(36).slice(2, 10)}`;
    host.principal = { id: 'harness-user', roles: ['tenant-admin'], permissions: [] };
    host.tenantId = 'harness';
    host.locale = 'en';
    host.theme = 'default';

    if (typeof this.resolveWidgetModuleUrl === 'function') {
      host.resolveWidgetModuleUrl = this.resolveWidgetModuleUrl;
    }

    host.onMediatorTrace = (ev) => this._appendLog(this._mediatorLogEl, ev.kind, ev);
    host.onCapabilityTrace = (ev) => this._appendLog(this._capabilityLogEl, ev.kind, ev);

    host.capabilities = buildMockCapabilities(this.spec?.capabilities ?? {});

    // instanceId must match the layout schema pattern ^[a-zA-Z0-9_-]+$,
    // so dots in the widgetId (e.g. "content.announcements") can't pass
    // through — substitute a safe separator.
    const safeWidgetId = String(widgetId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const instanceId = `harness-${safeWidgetId}-1`;
    host.layout = {
      version: 1,
      slots: {
        main: [
          {
            widgetId,
            instanceId,
            config: variant.config ?? {},
            ...(variant.isolation ? { isolationOverride: variant.isolation } : {}),
          },
        ],
      },
    };

    container.appendChild(host);
    this._host = host;

    // Register a synthetic harness instance so the rig can publish inbound
    // events into the real mediator. The synthetic instance's "provides"
    // mirrors the widget's "consumes", and vice-versa for symmetry.
    // Must happen AFTER host is in the DOM because mediator is created
    // during _mountAll, triggered by layout assignment + connection.
    queueMicrotask(() => {
      const mediator = host.mediator;
      if (!mediator) return;
      const provides = manifest?.consumes?.topics ?? [];
      const consumes = manifest?.provides?.topics ?? [];
      try {
        mediator.registerInstance(HARNESS_SYNTHETIC_ID, {
          provides: { topics: provides },
          consumes: { topics: consumes },
        });
      } catch (err) {
        this._appendLog(this._mediatorLogEl, 'harness-register-failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    this._cleanups.push(() => {
      try { host.mediator?.revokeInstance(HARNESS_SYNTHETIC_ID); } catch { /* ignore */ }
    });
  }

  _publishSynthetic(topic, payload) {
    const mediator = this._host?.mediator;
    if (!mediator) {
      this._appendLog(this._mediatorLogEl, 'harness-publish-failed', {
        topic,
        error: 'no mediator (widget not mounted yet)',
      });
      return;
    }
    try {
      mediator.publish(HARNESS_SYNTHETIC_ID, topic, payload);
    } catch (err) {
      this._appendLog(this._mediatorLogEl, 'harness-publish-failed', {
        topic,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  _appendLog(logEl, kind, payload) {
    if (!logEl) return;
    const empty = logEl.querySelector('.log-empty');
    if (empty) empty.remove();
    const line = document.createElement('div');
    line.className = 'log-line';
    const k = document.createElement('span');
    k.className = 'log-kind';
    k.textContent = kind;
    line.appendChild(k);
    let text;
    try {
      text = JSON.stringify(payload, replaceErrors);
    } catch {
      text = String(payload);
    }
    line.appendChild(document.createTextNode(' ' + text));
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function replaceErrors(_key, value) {
  if (value instanceof Error) return { error: value.message };
  return value;
}

AtlasElement.define('widget-harness', WidgetHarnessElement);
