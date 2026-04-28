import { AtlasElement, AtlasSurface } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';
import { adoptAtlasWidgetStyles } from '@atlas/widgets/shared-styles';
import '@atlas/design';
import templatesCssText from '@atlas/bundle-standard/templates/templates.css?inline';

import './page-editor/index.ts';
import './page-editor/route.ts';
import './layout-editor/index.ts';
import './block-editor/index.ts';
import './page-gallery/index.ts';

interface RouteDef {
  id: string;
  label: string;
  tag: string;
}

const ROUTES: RouteDef[] = [
  { id: 'page-editor',    label: 'Page Editor',    tag: 'authoring-page-editor-route' },
  { id: 'layout-editor',  label: 'Layout Editor',  tag: 'authoring-layout-editor-route' },
  { id: 'block-editor',   label: 'Block Editor',   tag: 'authoring-block-editor-route' },
  { id: 'page-gallery',   label: 'Page Gallery',   tag: 'authoring-page-gallery-route' },
];

const DESKTOP_BREAKPOINT_PX = 900;

const styles = `
  :host {
    display: grid;
    grid-template-columns: 1fr;
    grid-template-rows: 48px 1fr;
    grid-template-areas:
      "topbar"
      "content";
    height: 100vh;
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
  }
  atlas-box[data-role="topbar"] {
    grid-area: topbar;
    display: flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    padding: 0 var(--atlas-space-md);
    background: var(--atlas-color-shell-bg);
    color: var(--atlas-color-shell-text);
    z-index: 4;
  }
  atlas-box[data-role="topbar"] atlas-heading {
    color: var(--atlas-color-shell-text);
    margin: 0;
  }
  atlas-button[data-role="nav-toggle"] {
    --atlas-button-color-fg: var(--atlas-color-shell-text);
  }
  atlas-button[data-role="nav-toggle"] atlas-icon {
    width: 22px;
    height: 22px;
  }

  /* Mobile: sidebar is an off-canvas drawer driven by [data-nav-open]
     on the host. Hamburger sits in the topbar. */
  atlas-box[data-role="sidebar"] {
    position: fixed;
    top: 48px;
    left: 0;
    bottom: 0;
    width: min(320px, 85vw);
    transform: translateX(-100%);
    transition: transform var(--atlas-transition-base);
    background: var(--atlas-color-surface);
    border-right: 1px solid var(--atlas-color-border);
    box-shadow: var(--atlas-shadow-lg, 0 8px 24px rgba(0,0,0,0.12));
    overflow-y: auto;
    z-index: 3;
  }
  :host([data-nav-open]) atlas-box[data-role="sidebar"] {
    transform: translateX(0);
  }
  atlas-box[data-role="scrim"] {
    position: fixed;
    inset: 48px 0 0 0;
    background: rgba(0, 0, 0, 0.32);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--atlas-transition-base);
    z-index: 2;
  }
  :host([data-nav-open]) atlas-box[data-role="scrim"] {
    opacity: 1;
    pointer-events: auto;
  }
  atlas-box[data-role="content"] {
    grid-area: content;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--atlas-color-bg);
  }
  atlas-nav-item.item[aria-selected="true"] {
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-primary);
    font-weight: var(--atlas-font-weight-medium);
  }

  /* Desktop: static sidebar + content grid. */
  @media (min-width: ${DESKTOP_BREAKPOINT_PX}px) {
    :host {
      grid-template-columns: 240px 1fr;
      grid-template-areas:
        "topbar  topbar"
        "sidebar content";
    }
    atlas-button[data-role="nav-toggle"] { display: none; }
    atlas-box[data-role="sidebar"] {
      grid-area: sidebar;
      position: static;
      transform: none;
      width: auto;
      box-shadow: none;
      transition: none;
    }
    atlas-box[data-role="scrim"] { display: none; }
  }
`;

function readRouteFromHash(): string {
  const hash = location.hash.replace(/^#\/?/, '');
  const id = hash.split('?')[0];
  if (id && ROUTES.some((r) => r.id === id)) return id;
  return ROUTES[0]!.id;
}

export class AtlasAuthoring extends AtlasSurface {
  static override surfaceId = 'authoring.shell';

  private readonly _root: ShadowRoot;
  private _activeRouteId: string = ROUTES[0]!.id;
  private _onHashChange: () => void;
  private _onKey: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this._root);
    adoptAtlasWidgetStyles(this._root);
    this._onHashChange = () => {
      const next = readRouteFromHash();
      if (next === this._activeRouteId) return;
      this._activeRouteId = next;
      this._renderContent();
      this._syncSidebarSelection();
    };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._activeRouteId = readRouteFromHash();
    window.addEventListener('hashchange', this._onHashChange);
    this._onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.hasAttribute('data-nav-open')) {
        this._closeNav();
        const toggle = this._root.querySelector('atlas-button[data-role="nav-toggle"]') as HTMLElement | null;
        toggle?.focus();
      }
    };
    document.addEventListener('keydown', this._onKey);
    queueMicrotask(() => this._render());
  }

  override disconnectedCallback(): void {
    window.removeEventListener('hashchange', this._onHashChange);
    if (this._onKey) document.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback?.();
  }

  private _render(): void {
    this._root.innerHTML = `
      <style>${styles}\n${templatesCssText}</style>
      <atlas-box data-role="topbar">
        <atlas-button
          data-role="nav-toggle"
          variant="ghost"
          size="sm"
          aria-label="Open navigation"
          aria-expanded="false"
          aria-controls="authoring-sidebar"
        >
          <atlas-icon name="menu"></atlas-icon>
        </atlas-button>
        <atlas-heading level="3">Atlas Authoring</atlas-heading>
      </atlas-box>
      <atlas-box data-role="sidebar" id="authoring-sidebar">
        <atlas-nav name="route-nav" label="Authoring navigation"></atlas-nav>
      </atlas-box>
      <atlas-box data-role="scrim"></atlas-box>
      <atlas-box data-role="content"></atlas-box>
    `;

    const nav = this._root.querySelector('atlas-nav[name="route-nav"]');
    if (nav) {
      for (const route of ROUTES) {
        const item = document.createElement('atlas-nav-item');
        item.classList.add('item');
        item.setAttribute('data-id', route.id);
        item.setAttribute('aria-selected', String(route.id === this._activeRouteId));
        item.textContent = route.label;
        item.addEventListener('click', (e: Event) => {
          e.preventDefault();
          this._navigate(route.id);
        });
        nav.appendChild(item);
      }
    }

    const toggle = this._root.querySelector('atlas-button[data-role="nav-toggle"]') as HTMLElement | null;
    toggle?.addEventListener('click', () => {
      if (this.hasAttribute('data-nav-open')) this._closeNav();
      else this._openNav();
    });
    this._root.querySelector('atlas-box[data-role="scrim"]')?.addEventListener('click', () => this._closeNav());

    this._renderContent();
  }

  private _navigate(routeId: string): void {
    if (routeId === this._activeRouteId) {
      this._closeNav();
      return;
    }
    this._activeRouteId = routeId;
    const url = new URL(location.href);
    url.hash = `#/${routeId}`;
    history.pushState(null, '', url);
    this._renderContent();
    this._syncSidebarSelection();
    this._closeNav();
  }

  private _syncSidebarSelection(): void {
    const items = this._root.querySelectorAll('atlas-nav-item.item');
    items.forEach((el) => {
      const id = el.getAttribute('data-id');
      el.setAttribute('aria-selected', String(id === this._activeRouteId));
    });
  }

  private _openNav(): void {
    this.setAttribute('data-nav-open', '');
    const toggle = this._root.querySelector('atlas-button[data-role="nav-toggle"]') as HTMLElement | null;
    toggle?.setAttribute('aria-expanded', 'true');
    toggle?.setAttribute('aria-label', 'Close navigation');
  }

  private _closeNav(): void {
    if (!this.hasAttribute('data-nav-open')) return;
    this.removeAttribute('data-nav-open');
    const toggle = this._root.querySelector('atlas-button[data-role="nav-toggle"]') as HTMLElement | null;
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.setAttribute('aria-label', 'Open navigation');
  }

  private _renderContent(): void {
    const host = this._root.querySelector('atlas-box[data-role="content"]') as HTMLElement | null;
    if (!host) return;
    host.textContent = '';
    const route = ROUTES.find((r) => r.id === this._activeRouteId) ?? ROUTES[0]!;
    const el = document.createElement(route.tag);
    el.style.display = 'block';
    el.style.height = '100%';
    host.appendChild(el);
  }
}

AtlasElement.define('atlas-authoring', AtlasAuthoring);
