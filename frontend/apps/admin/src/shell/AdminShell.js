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

/**
 * Mobile-first layout: single column with a top header that contains a
 * hamburger toggle and an off-canvas drawer for the nav. At ≥900px
 * (BREAKPOINTS.md) the grid reverts to the desktop two-column form and
 * the toggle hides.
 */
const styles = `
  :host {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: 48px 1fr;
    grid-template-areas:
      "header"
      "content";
    height: 100vh;
    font-family: var(--atlas-font-family);
    position: relative;
  }
  .header {
    grid-area: header;
    display: flex;
    align-items: center;
    gap: var(--atlas-space-md);
    padding: 0 var(--atlas-space-md);
    background: var(--atlas-color-shell-bg);
    color: var(--atlas-color-shell-text);
    z-index: 2;
  }
  .header atlas-heading {
    color: var(--atlas-color-shell-text);
    font-size: var(--atlas-font-size-md);
    letter-spacing: 0.04em;
    flex: 1;
    margin: 0;
  }
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
  .sidebar {
    grid-area: sidebar;
    background: var(--atlas-color-surface);
    border-right: 1px solid var(--atlas-color-border);
    padding: var(--atlas-space-md);
    overflow-y: auto;
  }
  .content {
    grid-area: content;
    padding: var(--atlas-space-md);
    overflow-y: auto;
    background: var(--atlas-color-bg);
  }

  /* Mobile: sidebar becomes an off-canvas drawer. Hidden by default; slides
     in when [data-nav-open] is set on the host. */
  .sidebar {
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
  :host([data-nav-open]) .sidebar {
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

  /* Desktop: revert to static two-column grid, hide the hamburger and the
     scrim. Literal value mirrors BREAKPOINTS.md. */
  @media (min-width: 900px) {
    :host {
      grid-template-columns: 220px 1fr;
      grid-template-rows: 40px 1fr;
      grid-template-areas:
        "header  header"
        "sidebar content";
    }
    .header { padding: 0 var(--atlas-space-lg); }
    .nav-toggle { display: none; }
    .sidebar {
      position: static;
      transform: none;
      width: auto;
      box-shadow: none;
      transition: none;
    }
    .scrim { display: none; }
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
        <button
          class="nav-toggle"
          type="button"
          aria-label="Open navigation"
          aria-expanded="false"
          aria-controls="admin-shell-sidebar"
          data-testid="admin.shell.nav-toggle"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
        <atlas-heading level="3">Atlas</atlas-heading>
      </atlas-box>
      <atlas-box class="sidebar" id="admin-shell-sidebar">
        <atlas-nav label="Admin navigation">
          <atlas-heading level="3">Modules</atlas-heading>
          ${MODULES.map((m) => `<atlas-nav-item href="#/${m.id}">${m.label}</atlas-nav-item>`).join('\n          ')}
        </atlas-nav>
      </atlas-box>
      <div class="scrim" data-testid="admin.shell.nav-scrim"></div>
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

    this._onHashChange = () => this._route();
    window.addEventListener('hashchange', this._onHashChange);
    this._route();
  }

  disconnectedCallback() {
    window.removeEventListener('hashchange', this._onHashChange);
    document.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback?.();
  }

  _openNav() {
    this.setAttribute('data-nav-open', '');
    const toggle = this.shadowRoot.querySelector('.nav-toggle');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close navigation');
    const firstItem = this.shadowRoot.querySelector('atlas-nav-item');
    if (firstItem) firstItem.focus();
  }

  _closeNav() {
    if (!this.hasAttribute('data-nav-open')) return;
    this.removeAttribute('data-nav-open');
    const toggle = this.shadowRoot.querySelector('.nav-toggle');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation');
  }

  _route() {
    const hash = window.location.hash.replace('#/', '') || 'content';

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
