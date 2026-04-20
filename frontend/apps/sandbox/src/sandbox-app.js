import { AtlasElement } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';

const styles = `
  :host {
    display: grid;
    grid-template-columns: 240px 1fr;
    grid-template-rows: 40px 1fr;
    height: 100vh;
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
  }

  .topbar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: var(--atlas-space-md);
    padding: 0 var(--atlas-space-md);
    background: var(--atlas-color-shell-bg);
  }
  .topbar-title {
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-semibold);
    color: var(--atlas-color-shell-text);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .topbar-badge {
    font-size: var(--atlas-font-size-xs);
    color: var(--atlas-color-text-muted);
  }

  .sidebar {
    background: var(--atlas-color-surface);
    border-right: 1px solid var(--atlas-color-border);
    overflow-y: auto;
    padding: var(--atlas-space-sm) 0;
  }

  .group-label {
    font-size: var(--atlas-font-size-xs);
    font-weight: var(--atlas-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--atlas-color-text-muted);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    margin-top: var(--atlas-space-sm);
  }
  .group-label:first-child { margin-top: 0; }

  .item {
    display: block;
    width: 100%;
    padding: 4px var(--atlas-space-md) 4px var(--atlas-space-lg);
    border: none;
    background: none;
    text-align: left;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    color: var(--atlas-color-text);
    cursor: pointer;
    border-radius: 0;
    transition: background var(--atlas-transition-fast);
  }
  .item:hover {
    background: var(--atlas-color-surface-hover);
  }
  .item[aria-selected="true"] {
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-primary);
    font-weight: var(--atlas-font-weight-medium);
  }

  .preview {
    overflow-y: auto;
    background: var(--atlas-color-bg);
  }

  .preview-header {
    padding: var(--atlas-space-sm) var(--atlas-space-lg);
    border-bottom: 1px solid var(--atlas-color-border);
    display: flex;
    align-items: baseline;
    gap: var(--atlas-space-sm);
  }
  .preview-name {
    font-size: var(--atlas-font-size-lg);
    font-weight: var(--atlas-font-weight-semibold);
  }
  .preview-tag {
    font-size: var(--atlas-font-size-xs);
    color: var(--atlas-color-text-muted);
    font-family: var(--atlas-font-mono);
  }

  .preview-body {
    padding: var(--atlas-space-lg);
  }

  .variant {
    margin-bottom: var(--atlas-space-xl);
  }
  .variant:last-child { margin-bottom: 0; }
  .variant-label {
    font-size: var(--atlas-font-size-xs);
    font-weight: var(--atlas-font-weight-semibold);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--atlas-color-text-muted);
    margin-bottom: var(--atlas-space-sm);
  }
  .variant-demo {
    padding: var(--atlas-space-lg);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
  }
  .variant-demo.dark {
    background: var(--atlas-color-shell-bg);
  }

  /* ── State switcher ── */
  .state-bar {
    display: flex;
    gap: 1px;
    margin-bottom: var(--atlas-space-sm);
    background: var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
    overflow: hidden;
  }
  .state-btn {
    flex: 1;
    padding: 4px 0;
    border: none;
    background: var(--atlas-color-surface);
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-xs);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text-muted);
    cursor: pointer;
    transition: background var(--atlas-transition-fast), color var(--atlas-transition-fast);
    text-transform: capitalize;
  }
  .state-btn:hover {
    background: var(--atlas-color-surface-hover);
  }
  .state-btn[aria-pressed="true"] {
    background: var(--atlas-color-primary);
    color: var(--atlas-color-text-inverse);
  }

  /* Widget mount log strip */
  .mount-log {
    margin-top: var(--atlas-space-md);
    padding: var(--atlas-space-sm);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
    background: var(--atlas-color-surface);
    font-family: var(--atlas-font-mono);
    font-size: var(--atlas-font-size-xs);
    max-height: 160px;
    overflow-y: auto;
  }
  .mount-log-empty {
    color: var(--atlas-color-text-muted);
  }
  .mount-log-line {
    padding: 2px 0;
    color: var(--atlas-color-text);
    border-bottom: 1px dashed var(--atlas-color-border);
  }
  .mount-log-line:last-child { border-bottom: none; }
  .mount-log-kind {
    display: inline-block;
    min-width: 90px;
    font-weight: var(--atlas-font-weight-semibold);
    color: var(--atlas-color-primary);
  }
`;

export class AtlasSandbox extends AtlasElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this.shadowRoot);
  }

  connectedCallback() {
    super.connectedCallback();
    /** @type {Array<() => void>} cleanup functions for currently mounted widgets */
    this._activeCleanups = [];
    queueMicrotask(() => {
      this._render();
      const params = new URLSearchParams(location.search);
      const initial = params.get('specimen') || AtlasSandbox.specimens[0]?.id;
      if (initial) this._select(initial);
    });
  }

  _runActiveCleanups() {
    for (const fn of this._activeCleanups) {
      try { fn(); } catch (err) { console.error('[sandbox] cleanup threw', err); }
    }
    this._activeCleanups = [];
  }

  _render() {
    const groups = {};
    for (const spec of AtlasSandbox.specimens) {
      const g = spec.group || 'Other';
      (groups[g] ??= []).push(spec);
    }

    const count = AtlasSandbox.specimens.length;

    let sidebarHtml = '';
    for (const [group, items] of Object.entries(groups)) {
      sidebarHtml += `<div class="group-label">${group}</div>`;
      for (const item of items) {
        sidebarHtml += `<button class="item" data-id="${item.id}">${item.name}</button>`;
      }
    }

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <div class="topbar">
        <span class="topbar-title">Atlas Sandbox</span>
        <span class="topbar-badge">${count} specimens</span>
      </div>
      <div class="sidebar">${sidebarHtml}</div>
      <div class="preview">
        <div class="preview-header">
          <span class="preview-name">Select a specimen</span>
        </div>
        <div class="preview-body"></div>
      </div>
    `;

    this.shadowRoot.querySelector('.sidebar').addEventListener('click', (e) => {
      const btn = e.target.closest('.item');
      if (!btn) return;
      this._select(btn.dataset.id);
    });
  }

  _select(id) {
    const spec = AtlasSandbox.specimens.find(s => s.id === id);
    if (!spec) return;

    this._activeSpec = spec;

    const url = new URL(location.href);
    url.searchParams.set('specimen', id);
    history.replaceState(null, '', url);

    for (const btn of this.shadowRoot.querySelectorAll('.item')) {
      btn.setAttribute('aria-selected', btn.dataset.id === id ? 'true' : 'false');
    }

    const header = this.shadowRoot.querySelector('.preview-header');
    header.innerHTML = `
      <span class="preview-name">${spec.name}</span>
      <span class="preview-tag">&lt;${spec.tag}&gt;</span>
    `;

    const body = this.shadowRoot.querySelector('.preview-body');
    // Any previously mounted live widgets must be unmounted before the
    // DOM is replaced — their cleanup functions handle teardown side
    // effects (mediator unsubscribes, iframe disposal, etc.).
    this._runActiveCleanups();
    body.innerHTML = '';

    // If specimen has a mount function, it's a live widget specimen
    if (typeof spec.mount === 'function') {
      const variants = Array.isArray(spec.configVariants) && spec.configVariants.length > 0
        ? spec.configVariants
        : [{ name: 'default', config: {} }];
      this._renderMountStateful(body, spec, variants, variants[0].name);
    } else if (spec.states) {
      // If specimen has states, render state switcher + initial state
      const stateKeys = Object.keys(spec.states);
      const initial = stateKeys.includes('success') ? 'success' : stateKeys[0];
      this._renderStateful(body, spec, initial);
    } else {
      // Plain variants
      for (const variant of spec.variants) {
        this._renderVariant(body, variant);
      }
    }
  }

  _renderMountStateful(container, spec, variants, activeName) {
    this._runActiveCleanups();
    container.innerHTML = '';

    // Switcher bar across configVariants
    if (variants.length > 1) {
      const bar = document.createElement('div');
      bar.className = 'state-bar';
      for (const v of variants) {
        const btn = document.createElement('button');
        btn.className = 'state-btn';
        btn.textContent = v.name;
        btn.setAttribute('aria-pressed', v.name === activeName ? 'true' : 'false');
        btn.addEventListener('click', () => this._renderMountStateful(container, spec, variants, v.name));
        bar.appendChild(btn);
      }
      container.appendChild(bar);
    }

    const active = variants.find(v => v.name === activeName) ?? variants[0];

    const demo = document.createElement('div');
    demo.className = 'variant-demo';
    container.appendChild(demo);

    const log = document.createElement('div');
    log.className = 'mount-log';
    const placeholder = document.createElement('div');
    placeholder.className = 'mount-log-empty';
    placeholder.textContent = '(no activity yet)';
    log.appendChild(placeholder);
    container.appendChild(log);

    const onLog = (kind, payload) => {
      // Remove the placeholder on first entry.
      const empty = log.querySelector('.mount-log-empty');
      if (empty) empty.remove();
      const line = document.createElement('div');
      line.className = 'mount-log-line';
      const k = document.createElement('span');
      k.className = 'mount-log-kind';
      k.textContent = kind;
      line.appendChild(k);
      const body = document.createTextNode(
        typeof payload === 'string' ? payload : JSON.stringify(payload),
      );
      line.appendChild(body);
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    };

    let cleanup;
    try {
      cleanup = spec.mount(demo, {
        config: active.config ?? {},
        isolation: active.isolation,
        onLog,
      });
    } catch (err) {
      onLog('mount-error', err?.message ?? String(err));
      cleanup = () => {};
    }
    if (typeof cleanup !== 'function') cleanup = () => {};
    this._activeCleanups.push(cleanup);
  }

  _renderStateful(container, spec, activeState) {
    container.innerHTML = '';

    const stateKeys = Object.keys(spec.states);

    // State switcher bar
    const bar = document.createElement('div');
    bar.className = 'state-bar';
    for (const key of stateKeys) {
      const btn = document.createElement('button');
      btn.className = 'state-btn';
      btn.textContent = key;
      btn.setAttribute('aria-pressed', key === activeState ? 'true' : 'false');
      btn.addEventListener('click', () => this._renderStateful(container, spec, key));
      bar.appendChild(btn);
    }
    container.appendChild(bar);

    // Demo area for the active state
    const demo = document.createElement('div');
    demo.className = 'variant-demo';
    demo.innerHTML = spec.states[activeState];
    container.appendChild(demo);

    // Also render plain variants below if any
    if (spec.variants) {
      for (const variant of spec.variants) {
        this._renderVariant(container, variant);
      }
    }
  }

  _renderVariant(container, variant) {
    const section = document.createElement('div');
    section.className = 'variant';

    const label = document.createElement('div');
    label.className = 'variant-label';
    label.textContent = variant.name;
    section.appendChild(label);

    const demo = document.createElement('div');
    demo.className = `variant-demo${variant.dark ? ' dark' : ''}`;
    demo.innerHTML = variant.html;
    section.appendChild(demo);

    container.appendChild(section);
  }

  static specimens = [];

  static register(spec) {
    AtlasSandbox.specimens.push(spec);
  }
}

AtlasElement.define('atlas-sandbox', AtlasSandbox);
