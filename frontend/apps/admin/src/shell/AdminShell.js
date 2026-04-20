import { AtlasSurface, html } from '@atlas/core';
import '@atlas/design';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';

const MODULES = [
  { id: 'content', label: 'Content' },
  { id: 'badges', label: 'Badges' },
  { id: 'points', label: 'Points' },
  { id: 'org', label: 'Org' },
  { id: 'comms', label: 'Comms' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'import', label: 'Import' },
  { id: 'audit', label: 'Audit' },
];

const styles = `
  :host {
    display: grid;
    grid-template-columns: 220px 1fr;
    grid-template-rows: 40px 1fr;
    height: 100vh;
    font-family: var(--atlas-font-family);
  }
  .header {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    padding: 0 var(--atlas-space-lg);
    background: var(--atlas-color-shell-bg);
  }
  .header atlas-heading {
    color: var(--atlas-color-shell-text);
    font-size: var(--atlas-font-size-md);
    letter-spacing: 0.04em;
  }
  .sidebar {
    background: var(--atlas-color-surface);
    border-right: 1px solid var(--atlas-color-border);
    padding: var(--atlas-space-md);
    overflow-y: auto;
  }
  .content {
    padding: var(--atlas-space-lg) var(--atlas-space-xl);
    overflow-y: auto;
    background: var(--atlas-color-bg);
  }
`;

class AdminShell extends AtlasSurface {
  static surfaceId = 'admin.shell';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this.shadowRoot);
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <atlas-box class="header">
        <atlas-heading level="3">Atlas</atlas-heading>
      </atlas-box>
      <atlas-box class="sidebar">
        <atlas-nav label="Admin navigation">
          <atlas-heading level="3">Modules</atlas-heading>
          ${MODULES.map((m) => `<atlas-nav-item href="#/${m.id}">${m.label}</atlas-nav-item>`).join('\n          ')}
        </atlas-nav>
      </atlas-box>
      <atlas-box class="content">
        <slot></slot>
      </atlas-box>
    `;
  }

  connectedCallback() {
    super.connectedCallback();

    this.shadowRoot.querySelector('atlas-nav').addEventListener('click', (e) => {
      const item = e.target.closest('atlas-nav-item');
      if (!item) return;
      const href = item.getAttribute('href');
      if (href) {
        window.location.hash = href.substring(1);
      }
    });

    this._onHashChange = () => this._route();
    window.addEventListener('hashchange', this._onHashChange);
    this._route();
  }

  disconnectedCallback() {
    window.removeEventListener('hashchange', this._onHashChange);
    super.disconnectedCallback?.();
  }

  _route() {
    const hash = window.location.hash.replace('#/', '') || 'content';

    // Update active nav item
    for (const item of this.shadowRoot.querySelectorAll('atlas-nav-item')) {
      const href = item.getAttribute('href') || '';
      const itemRoute = href.replace('#/', '');
      if (itemRoute === hash) {
        item.setAttribute('active', '');
        item.setAttribute('aria-current', 'page');
      } else {
        item.removeAttribute('active');
        item.removeAttribute('aria-current');
      }
    }

    // Show/hide slotted children based on route
    for (const child of this.children) {
      const route = child.getAttribute('data-route');
      if (!route || route === hash) {
        child.style.display = '';
      } else {
        child.style.display = 'none';
      }
    }
  }

  onMount() {
    this.emit('admin.shell.page-viewed');
  }
}

AtlasSurface.define('admin-shell', AdminShell);
