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

const styles = `
  :host {
    display: grid;
    grid-template-columns: 240px 1fr;
    grid-template-rows: 48px 1fr;
    grid-template-areas:
      "topbar  topbar"
      "sidebar content";
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
  }
  atlas-box[data-role="topbar"] atlas-heading {
    color: var(--atlas-color-shell-text);
    margin: 0;
  }
  atlas-box[data-role="sidebar"] {
    grid-area: sidebar;
    border-right: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-surface);
    overflow-y: auto;
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
`;

function readRouteFromHash(): string {
  const hash = location.hash.replace(/^#\/?/, '');
  const id = hash.split('?')[0];
  if (id && ROUTES.some((r) => r.id === id)) return id;
  return ROUTES[0]!.id;
}

export class AtlasAuthoring extends AtlasSurface {
  static override surfaceId = 'authoring';

  private readonly _root: ShadowRoot;
  private _activeRouteId: string = ROUTES[0]!.id;
  private _onHashChange: () => void;

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
    queueMicrotask(() => this._render());
  }

  override disconnectedCallback(): void {
    window.removeEventListener('hashchange', this._onHashChange);
    super.disconnectedCallback?.();
  }

  private _render(): void {
    this._root.innerHTML = `
      <style>${styles}\n${templatesCssText}</style>
      <atlas-box data-role="topbar">
        <atlas-heading level="3">Atlas Authoring</atlas-heading>
      </atlas-box>
      <atlas-box data-role="sidebar">
        <atlas-nav data-role="route-nav"></atlas-nav>
      </atlas-box>
      <atlas-box data-role="content"></atlas-box>
    `;

    const nav = this._root.querySelector('atlas-nav[data-role="route-nav"]');
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

    this._renderContent();
  }

  private _navigate(routeId: string): void {
    if (routeId === this._activeRouteId) return;
    this._activeRouteId = routeId;
    const url = new URL(location.href);
    url.hash = `#/${routeId}`;
    history.pushState(null, '', url);
    this._renderContent();
    this._syncSidebarSelection();
  }

  private _syncSidebarSelection(): void {
    const items = this._root.querySelectorAll('atlas-nav-item.item');
    items.forEach((el) => {
      const id = el.getAttribute('data-id');
      el.setAttribute('aria-selected', String(id === this._activeRouteId));
    });
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
