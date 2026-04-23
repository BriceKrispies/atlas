import { AtlasElement, AtlasSurface } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';
import { adoptAtlasWidgetStyles } from '@atlas/widgets/shared-styles';
import '@atlas/design';
// Template layout chrome (grid rules keyed off `template-*` custom element
// tags). Because the sandbox shell uses Shadow DOM, document-level
// stylesheets do NOT pierce it — we must inline this CSS into the shadow
// root ourselves. Without this, every page template renders as a plain
// stacked block instead of its intended grid.
import templatesCssText from '@atlas/bundle-standard/templates/templates.css?inline';

/**
 * Sandbox shell, composed entirely from atlas primitives:
 *   <atlas-box>      — topbar / sidebar / preview containers
 *   <atlas-heading>  — topbar title, sidebar group labels, preview name,
 *                      variant labels
 *   <atlas-badge>    — specimen count chip
 *   <atlas-nav> + <atlas-nav-item> — sidebar specimen list
 *   <atlas-stack>    — preview header row, variant sections
 *   <atlas-text>     — mono tag beside the preview name, empty-log hint
 *   <atlas-tab-bar>  — state / variant switcher (already an atlas element)
 *
 * The outer grid still lives on `:host` because CSS Grid is a layout
 * concern, not a widget concern — but every node inside is an atlas-*.
 */
const styles = `
  :host {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: 48px 1fr;
    grid-template-areas:
      "topbar"
      "preview";
    height: 100vh;
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
  }

  atlas-box[data-role="topbar"] {
    grid-area: topbar;
    display: flex;
    align-items: center;
    gap: var(--atlas-space-md);
    padding: 0 var(--atlas-space-md);
    background: var(--atlas-color-shell-bg);
    color: var(--atlas-color-shell-text);
    z-index: 2;
  }
  atlas-box[data-role="topbar"] atlas-heading {
    color: var(--atlas-color-shell-text);
    flex: 1;
    margin: 0;
  }

  atlas-box[data-role="sidebar"] {
    grid-area: sidebar;
    background: var(--atlas-color-surface);
    border-right: 1px solid var(--atlas-color-border);
    overflow-y: auto;
    padding: var(--atlas-space-sm) 0;
  }
  atlas-box[data-role="sidebar"] atlas-heading[level="3"] {
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    margin-top: var(--atlas-space-sm);
  }
  atlas-box[data-role="sidebar"] atlas-heading[level="3"]:first-child {
    margin-top: 0;
  }

  /* Developer-tool list density: the default nav-item is sized for
     production touch targets (44×44). In the sandbox sidebar each item is
     a specimen link in a scrollable list, so we collapse to text height
     with just enough padding for a hit region. */
  atlas-nav-item.item {
    min-height: 0;
    padding: 2px var(--atlas-space-md) 2px var(--atlas-space-lg);
    border-radius: 0;
    font-size: var(--atlas-font-size-sm);
    line-height: var(--atlas-line-height-tight);
  }
  atlas-nav-item.item[aria-selected="true"] {
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-primary);
    font-weight: var(--atlas-font-weight-medium);
  }

  atlas-box[data-role="preview"] {
    grid-area: preview;
    overflow-y: auto;
    background: var(--atlas-color-bg);
    min-width: 0;
  }

  atlas-stack[data-role="preview-header"] {
    padding: var(--atlas-space-sm) var(--atlas-space-lg);
    border-bottom: 1px solid var(--atlas-color-border);
  }
  atlas-stack[data-role="preview-header"] atlas-heading {
    margin: 0;
  }

  atlas-box[data-role="preview-body"] {
    padding: var(--atlas-space-lg);
  }

  atlas-stack[data-role="variant"] {
    margin-bottom: var(--atlas-space-xl);
  }
  atlas-stack[data-role="variant"]:last-child {
    margin-bottom: 0;
  }

  atlas-box[data-role="variant-demo"] {
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
  }
  atlas-box[data-role="variant-demo"][data-dark] {
    background: var(--atlas-color-shell-bg);
  }

  atlas-tab-bar {
    margin-bottom: var(--atlas-space-sm);
  }

  atlas-box[data-role="mount-log"] {
    margin-top: var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-surface);
    font-family: var(--atlas-font-mono);
    font-size: var(--atlas-font-size-xs);
    max-height: 160px;
    overflow-y: auto;
    padding: var(--atlas-space-sm);
  }
  atlas-box[data-role="mount-log"] .line {
    padding: 2px 0;
    color: var(--atlas-color-text);
    border-bottom: 1px dashed var(--atlas-color-border);
  }
  atlas-box[data-role="mount-log"] .line:last-child {
    border-bottom: none;
  }
  atlas-box[data-role="mount-log"] .kind {
    display: inline-block;
    min-width: 90px;
    font-weight: var(--atlas-font-weight-semibold);
    color: var(--atlas-color-primary);
  }

  /* Mobile: sidebar becomes an off-canvas drawer driven by [data-nav-open]
     on the host. Hamburger sits in the topbar. */
  .nav-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--atlas-touch-target-min, 44px);
    min-height: var(--atlas-touch-target-min, 44px);
    padding: 0;
    border: 1px solid transparent;
    background: transparent;
    color: var(--atlas-color-shell-text);
    cursor: pointer;
    border-radius: var(--atlas-radius-md);
    -webkit-tap-highlight-color: transparent;
  }
  .nav-toggle:focus-visible {
    outline: 2px solid var(--atlas-color-shell-accent);
    outline-offset: 2px;
  }
  .nav-toggle svg { width: 22px; height: 22px; }

  atlas-box[data-role="sidebar"] {
    position: fixed;
    top: 48px;
    left: 0;
    bottom: 0;
    width: min(280px, 85vw);
    transform: translateX(-100%);
    transition: transform var(--atlas-transition-base);
    box-shadow: var(--atlas-shadow-lg, 0 8px 24px rgba(0,0,0,0.12));
    z-index: 3;
  }
  :host([data-nav-open]) atlas-box[data-role="sidebar"] {
    transform: translateX(0);
  }
  .scrim {
    position: fixed;
    inset: 48px 0 0 0;
    background: rgba(0, 0, 0, 0.32);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--atlas-transition-base);
    z-index: 2;
  }
  :host([data-nav-open]) .scrim {
    opacity: 1;
    pointer-events: auto;
  }

  /* Desktop: restore static sidebar + preview grid. Literal value mirrors
     BREAKPOINTS.md. */
  @media (min-width: 900px) {
    :host {
      grid-template-columns: 240px 1fr;
      grid-template-rows: 40px 1fr;
      grid-template-areas:
        "topbar  topbar"
        "sidebar preview";
    }
    .nav-toggle { display: none; }
    atlas-box[data-role="sidebar"] {
      position: static;
      transform: none;
      width: auto;
      box-shadow: none;
      transition: none;
    }
    .scrim { display: none; }
  }
`;

export class AtlasSandbox extends AtlasSurface {
  static surfaceId = 'sandbox';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this.shadowRoot);
    adoptAtlasWidgetStyles(this.shadowRoot);
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

    let navHtml = '';
    for (const [group, items] of Object.entries(groups)) {
      navHtml += `<atlas-heading level="3">${group}</atlas-heading>`;
      for (const item of items) {
        navHtml += `<atlas-nav-item class="item" data-id="${item.id}" role="option">${item.name}</atlas-nav-item>`;
      }
    }

    this.shadowRoot.innerHTML = `
      <style>${styles}\n${templatesCssText}</style>
      <atlas-box data-role="topbar">
        <button
          class="nav-toggle"
          type="button"
          aria-label="Open specimen list"
          aria-expanded="false"
          aria-controls="sandbox-sidebar"
          data-testid="sandbox.nav-toggle"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <line x1="4" y1="7"  x2="20" y2="7"  />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
        <atlas-heading level="3">Atlas Sandbox</atlas-heading>
        <atlas-badge>${count} specimens</atlas-badge>
      </atlas-box>
      <atlas-box data-role="sidebar" id="sandbox-sidebar">
        <atlas-nav label="Specimens">
          ${navHtml}
        </atlas-nav>
      </atlas-box>
      <div class="scrim" data-testid="sandbox.nav-scrim"></div>
      <atlas-box data-role="preview">
        <atlas-stack data-role="preview-header" direction="row" align="baseline" gap="sm">
          <atlas-heading level="2">Select a specimen</atlas-heading>
          <atlas-text variant="mono"></atlas-text>
        </atlas-stack>
        <atlas-box data-role="preview-body"></atlas-box>
      </atlas-box>
    `;

    this.shadowRoot.querySelector('atlas-box[data-role="sidebar"]').addEventListener('click', (e) => {
      const item = e.target.closest('atlas-nav-item.item');
      if (!item) return;
      this._select(item.dataset.id);
      this._closeNav();
    });

    const toggle = this.shadowRoot.querySelector('.nav-toggle');
    toggle.addEventListener('click', () => {
      if (this.hasAttribute('data-nav-open')) this._closeNav();
      else this._openNav();
    });
    this.shadowRoot.querySelector('.scrim').addEventListener('click', () => this._closeNav());

    this._onKey = (e) => {
      if (e.key === 'Escape' && this.hasAttribute('data-nav-open')) {
        this._closeNav();
        toggle.focus();
      }
    };
    document.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback?.();
  }

  _openNav() {
    this.setAttribute('data-nav-open', '');
    const toggle = this.shadowRoot.querySelector('.nav-toggle');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close specimen list');
  }

  _closeNav() {
    if (!this.hasAttribute('data-nav-open')) return;
    this.removeAttribute('data-nav-open');
    const toggle = this.shadowRoot.querySelector('.nav-toggle');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open specimen list');
  }

  _select(id) {
    const spec = AtlasSandbox.specimens.find(s => s.id === id);
    if (!spec) return;

    this._activeSpec = spec;

    const url = new URL(location.href);
    url.searchParams.set('specimen', id);
    history.replaceState(null, '', url);

    for (const item of this.shadowRoot.querySelectorAll('atlas-nav-item.item')) {
      const isActive = item.dataset.id === id;
      // Preserve the test-friendly aria-selected signal (sidebar is an
      // options-list, not page navigation — aria-current would be wrong)
      // alongside the atlas-nav-item [active] affordance.
      item.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) item.setAttribute('active', '');
      else item.removeAttribute('active');
    }

    const header = this.shadowRoot.querySelector('atlas-stack[data-role="preview-header"]');
    header.innerHTML = `
      <atlas-heading level="2">${spec.name}</atlas-heading>
      <atlas-text variant="mono">&lt;${spec.tag}&gt;</atlas-text>
    `;

    const body = this.shadowRoot.querySelector('atlas-box[data-role="preview-body"]');
    // Any previously mounted live widgets must be unmounted before the
    // DOM is replaced — their cleanup functions handle teardown side
    // effects (mediator unsubscribes, iframe disposal, etc.).
    this._runActiveCleanups();
    body.innerHTML = '';

    if (typeof spec.mount === 'function') {
      const variants = Array.isArray(spec.configVariants) && spec.configVariants.length > 0
        ? spec.configVariants
        : [{ name: 'default', config: {} }];
      this._renderMountStateful(body, spec, variants, variants[0].name);
    } else if (spec.states) {
      const stateKeys = Object.keys(spec.states);
      const initial = stateKeys.includes('success') ? 'success' : stateKeys[0];
      this._renderStateful(body, spec, initial);
    } else {
      for (const variant of spec.variants) {
        this._renderVariant(body, variant);
      }
    }
  }

  _renderMountStateful(container, spec, variants, activeName) {
    this._runActiveCleanups();
    container.innerHTML = '';

    if (variants.length > 1) {
      const bar = document.createElement('atlas-tab-bar');
      bar.setAttribute('name', 'variant-switcher');
      bar.setAttribute('size', 'sm');
      bar.setAttribute('aria-label', 'Config variants');
      bar.tabs = variants.map((v) => ({ value: variantSlug(v.name), label: v.name }));
      bar.value = variantSlug(activeName);
      bar.addEventListener('change', (ev) => {
        const picked = variants.find((v) => variantSlug(v.name) === ev.detail.value);
        if (picked) this._renderMountStateful(container, spec, variants, picked.name);
      });
      container.appendChild(bar);
    }

    const active = variants.find(v => v.name === activeName) ?? variants[0];

    const demo = document.createElement('atlas-box');
    demo.setAttribute('data-role', 'variant-demo');
    demo.setAttribute('padding', 'lg');
    container.appendChild(demo);

    const log = document.createElement('atlas-box');
    log.setAttribute('data-role', 'mount-log');
    const placeholder = document.createElement('atlas-text');
    placeholder.setAttribute('variant', 'small');
    placeholder.className = 'empty';
    placeholder.textContent = '(no activity yet)';
    log.appendChild(placeholder);
    container.appendChild(log);

    const onLog = (kind, payload) => {
      const empty = log.querySelector('.empty');
      if (empty) empty.remove();
      const line = document.createElement('div');
      line.className = 'line';
      const k = document.createElement('span');
      k.className = 'kind';
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

    const bar = document.createElement('atlas-tab-bar');
    bar.setAttribute('name', 'state-switcher');
    bar.setAttribute('size', 'sm');
    bar.setAttribute('aria-label', 'States');
    bar.tabs = stateKeys.map((k) => ({ value: variantSlug(k), label: k }));
    bar.value = variantSlug(activeState);
    bar.addEventListener('change', (ev) => {
      const key = stateKeys.find((k) => variantSlug(k) === ev.detail.value);
      if (key) this._renderStateful(container, spec, key);
    });
    container.appendChild(bar);

    const demo = document.createElement('atlas-box');
    demo.setAttribute('data-role', 'variant-demo');
    demo.setAttribute('padding', 'lg');
    demo.innerHTML = spec.states[activeState];
    container.appendChild(demo);

    if (spec.variants) {
      for (const variant of spec.variants) {
        this._renderVariant(container, variant);
      }
    }
  }

  _renderVariant(container, variant) {
    const section = document.createElement('atlas-stack');
    section.setAttribute('data-role', 'variant');
    section.setAttribute('gap', 'sm');

    const label = document.createElement('atlas-heading');
    label.setAttribute('level', '3');
    label.textContent = variant.name;
    section.appendChild(label);

    const demo = document.createElement('atlas-box');
    demo.setAttribute('data-role', 'variant-demo');
    demo.setAttribute('padding', 'lg');
    if (variant.dark) demo.setAttribute('data-dark', '');
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

function variantSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
