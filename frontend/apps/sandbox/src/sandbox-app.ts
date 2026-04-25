import { AtlasElement, AtlasSurface } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';
import { adoptAtlasWidgetStyles } from '@atlas/widgets/shared-styles';
import '@atlas/design';
import {
  resolveTaxonomy,
  CATEGORIES,
  type Category,
  type Status,
} from './registry/index.ts';
import './sidebar.ts';
import type { AtlasSandboxSidebar } from './sidebar.ts';
// AtlasTabBar's class is registered side-effect via '@atlas/design'; the
// `HTMLElementTagNameMap` augmentation in atlas-tab-bar.ts makes
// `document.createElement('atlas-tab-bar')` return an AtlasTabBar with no
// structural cast. We import the type alone so we can annotate locals.
import type { AtlasTabBar } from '@atlas/design/atlas-tab-bar.ts';
// Template layout chrome (grid rules keyed off `template-*` custom element
// tags). Because the sandbox shell uses Shadow DOM, document-level
// stylesheets do NOT pierce it — we must inline this CSS into the shadow
// root ourselves. Without this, every page template renders as a plain
// stacked block instead of its intended grid.
import templatesCssText from '@atlas/bundle-standard/templates/templates.css?inline';

export interface SpecimenVariant {
  name: string;
  html: string;
  dark?: boolean;
}

export interface SpecimenConfigVariant {
  name: string;
  config: Record<string, unknown>;
  isolation?: string;
}

export type SpecimenMountFn = (
  demoEl: HTMLElement,
  ctx: {
    config: Record<string, unknown>;
    isolation?: string;
    onLog: (kind: string, payload: unknown) => void;
  },
) => (() => void) | void;

export interface Specimen {
  id: string;
  name: string;
  tag: string;
  category?: Category;
  subcategory?: string;
  status?: Status;
  tags?: readonly string[];
  variants?: SpecimenVariant[];
  states?: Record<string, string>;
  mount?: SpecimenMountFn;
  configVariants?: SpecimenConfigVariant[];
}

export interface ResolvedSpecimen extends Specimen {
  category: Category;
  subcategory?: string;
  status: Status;
  tags: readonly string[];
}

type PreviewTab = 'preview' | 'props' | 'source' | 'notes';

const PREVIEW_TABS: ReadonlyArray<{ value: PreviewTab; label: string }> = [
  { value: 'preview', label: 'Preview' },
  { value: 'props',   label: 'Props' },
  { value: 'source',  label: 'Source' },
  { value: 'notes',   label: 'Notes' },
];

const BADGE_STATUS_MAP: Record<Status, string> = {
  stable: 'published',
  wip: 'draft',
  review: 'archived',
};

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function matchesSearch(spec: ResolvedSpecimen, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (spec.name.toLowerCase().includes(needle)) return true;
  if (spec.id.toLowerCase().includes(needle)) return true;
  if (spec.tag.toLowerCase().includes(needle)) return true;
  for (const tag of spec.tags) if (tag.toLowerCase().includes(needle)) return true;
  return false;
}

function resolve(spec: Specimen): ResolvedSpecimen {
  const tax = resolveTaxonomy(spec.id);
  const subcategory = spec.subcategory ?? tax.subcategory;
  return {
    ...spec,
    category: spec.category ?? tax.category,
    ...(subcategory !== undefined ? { subcategory } : {}),
    status: spec.status ?? tax.status ?? 'stable',
    tags: spec.tags ?? tax.tags ?? [],
  };
}

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

  atlas-sandbox-sidebar {
    grid-area: sidebar;
    min-height: 0;
    border-right: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-surface);
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
    background: var(--atlas-color-bg);
  }
  atlas-stack[data-role="preview-header"] atlas-heading {
    margin: 0;
  }
  atlas-stack[data-role="preview-title-row"] atlas-badge {
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  atlas-tab-bar[data-role="preview-tabs"] {
    align-self: flex-start;
  }
  atlas-box[data-role="preview-body"][data-tab="props"] pre,
  atlas-box[data-role="preview-body"][data-tab="source"] pre,
  atlas-box[data-role="preview-body"][data-tab="notes"] pre {
    margin: 0;
    padding: var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-surface);
    font-family: var(--atlas-font-mono);
    font-size: var(--atlas-font-size-xs);
    line-height: 1.55;
    color: var(--atlas-color-text);
    white-space: pre-wrap;
    overflow-x: auto;
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
  .nav-toggle atlas-icon { width: 22px; height: 22px; }

  atlas-sandbox-sidebar {
    position: fixed;
    top: 48px;
    left: 0;
    bottom: 0;
    width: min(460px, 95vw);
    transform: translateX(-100%);
    transition: transform var(--atlas-transition-base);
    box-shadow: var(--atlas-shadow-lg, 0 8px 24px rgba(0,0,0,0.12));
    z-index: 3;
  }
  :host([data-nav-open]) atlas-sandbox-sidebar {
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
      grid-template-columns: 460px 1fr;
      grid-template-rows: 40px 1fr;
      grid-template-areas:
        "topbar  topbar"
        "sidebar preview";
    }
    .nav-toggle { display: none; }
    atlas-sandbox-sidebar {
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
  static override surfaceId = 'sandbox';

  private _activeCleanups: Array<() => void> = [];
  private _activeSpec: ResolvedSpecimen | null = null;
  private _activeCategory: Category = 'foundations';
  private _activeSearch = '';
  private _activeTab: PreviewTab = 'preview';
  private _onKey: ((e: KeyboardEvent) => void) | null = null;
  /** Non-null view of the shadow root, captured right after
   *  attachShadow(). Avoids repeated null checks and avoids
   *  `as unknown as ShadowRoot` casts elsewhere. */
  private readonly _root: ShadowRoot;

  constructor() {
    super();
    // attachShadow({mode:'open'}) both sets this.shadowRoot and returns
    // it; capture the return value so we have a typed, non-null handle.
    this._root = this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this._root);
    adoptAtlasWidgetStyles(this._root);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._activeCleanups = [];
    queueMicrotask(() => {
      const params = new URLSearchParams(location.search);
      const requestedId = params.get('specimen');
      const requestedCat = params.get('category') as Category | null;
      const resolvedSpec =
        (requestedId && AtlasSandbox.specimens.find((s) => s.id === requestedId)) || null;

      // Seed the active category BEFORE the shell renders so the sidebar
      // and category switcher mount already showing the right bucket.
      if (resolvedSpec) {
        this._activeCategory = resolvedSpec.category;
      } else if (requestedCat && CATEGORIES.some((c) => c.id === requestedCat)) {
        this._activeCategory = requestedCat;
      } else {
        this._activeCategory = AtlasSandbox.specimens[0]?.category ?? 'foundations';
      }

      this._render();

      const initial =
        resolvedSpec?.id ??
        AtlasSandbox.specimens.find((s) => s.category === this._activeCategory)?.id ??
        AtlasSandbox.specimens[0]?.id;
      if (initial) this._select(initial);
    });
  }

  private _runActiveCleanups(): void {
    for (const fn of this._activeCleanups) {
      try {
        fn();
      } catch (err) {
        console.error('[sandbox] cleanup threw', err);
      }
    }
    this._activeCleanups = [];
  }

  private _render(): void {
    const count = AtlasSandbox.specimens.length;
    const root = this._root;

    root.innerHTML = `
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
          <atlas-icon name="menu"></atlas-icon>
        </button>
        <atlas-heading level="3">Atlas Sandbox</atlas-heading>
        <atlas-badge>${count} specimens</atlas-badge>
      </atlas-box>
      <atlas-sandbox-sidebar id="sandbox-sidebar"></atlas-sandbox-sidebar>
      <div class="scrim" data-testid="sandbox.nav-scrim"></div>
      <atlas-box data-role="preview">
        <atlas-stack data-role="preview-header" gap="sm">
          <atlas-stack data-role="preview-title-row" direction="row" align="baseline" gap="sm">
            <atlas-heading level="2">Select a specimen</atlas-heading>
            <atlas-text variant="mono"></atlas-text>
            <atlas-badge></atlas-badge>
          </atlas-stack>
          <atlas-tab-bar
            data-role="preview-tabs"
            name="preview-tabs"
            size="sm"
            aria-label="Specimen view"
          ></atlas-tab-bar>
        </atlas-stack>
        <atlas-box data-role="preview-body"></atlas-box>
      </atlas-box>
    `;

    // Sidebar — driven by properties, events out.
    const sidebar = root.querySelector(
      'atlas-sandbox-sidebar',
    ) as AtlasSandboxSidebar;
    sidebar.specimens = AtlasSandbox.specimens;
    sidebar.activeCategory = this._activeCategory;
    sidebar.searchValue = this._activeSearch;
    sidebar.activeSpecimenId = this._activeSpec?.id ?? null;
    sidebar.addEventListener('category-change', (ev: Event) => {
      const detail = (ev as CustomEvent<{ category: Category }>).detail;
      if (detail.category === this._activeCategory) return;
      this._activeCategory = detail.category;
      const first = AtlasSandbox.specimens.find(
        (s) => s.category === detail.category && matchesSearch(s, this._activeSearch),
      );
      if (first) this._select(first.id);
      else {
        this._activeSpec = null;
        sidebar.activeSpecimenId = null;
        this._writeUrlState(null);
      }
    });
    sidebar.addEventListener('search-change', (ev: Event) => {
      const detail = (ev as CustomEvent<{ value: string }>).detail;
      this._activeSearch = detail.value;
    });
    sidebar.addEventListener('specimen-select', (ev: Event) => {
      const detail = (ev as CustomEvent<{ id: string }>).detail;
      this._select(detail.id);
      this._closeNav();
    });

    // Preview tabs. `atlas-tab-bar`'s class is augmented onto
    // HTMLElementTagNameMap so querySelector returns AtlasTabBar without
    // a structural cast.
    const prevBar = root.querySelector<AtlasTabBar>(
      'atlas-tab-bar[data-role="preview-tabs"]',
    );
    if (prevBar) {
      prevBar.tabs = PREVIEW_TABS.map((t) => ({ value: t.value, label: t.label }));
      prevBar.value = this._activeTab;
      prevBar.addEventListener('change', (ev: Event) => {
        const detail = (ev as CustomEvent<{ value: string }>).detail;
        const next = PREVIEW_TABS.find((t) => t.value === detail.value)?.value;
        if (!next || next === this._activeTab) return;
        this._activeTab = next;
        this._renderPreviewBody();
      });
    }

    const toggle = root.querySelector('.nav-toggle') as HTMLElement | null;
    toggle?.addEventListener('click', () => {
      if (this.hasAttribute('data-nav-open')) this._closeNav();
      else this._openNav();
    });
    root.querySelector('.scrim')?.addEventListener('click', () => this._closeNav());

    this._onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.hasAttribute('data-nav-open')) {
        this._closeNav();
        toggle?.focus();
      }
    };
    document.addEventListener('keydown', this._onKey);
  }

  private get _sidebar(): AtlasSandboxSidebar | null {
    return (this.shadowRoot?.querySelector('atlas-sandbox-sidebar') ?? null) as
      | AtlasSandboxSidebar
      | null;
  }

  private _writeUrlState(id: string | null): void {
    const url = new URL(location.href);
    if (id) url.searchParams.set('specimen', id);
    else url.searchParams.delete('specimen');
    url.searchParams.set('category', this._activeCategory);
    history.replaceState(null, '', url);
  }

  override disconnectedCallback(): void {
    if (this._onKey) document.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback?.();
  }

  private _openNav(): void {
    this.setAttribute('data-nav-open', '');
    const toggle = this.shadowRoot?.querySelector('.nav-toggle') as HTMLElement | null;
    toggle?.setAttribute('aria-expanded', 'true');
    toggle?.setAttribute('aria-label', 'Close specimen list');
  }

  private _closeNav(): void {
    if (!this.hasAttribute('data-nav-open')) return;
    this.removeAttribute('data-nav-open');
    const toggle = this.shadowRoot?.querySelector('.nav-toggle') as HTMLElement | null;
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.setAttribute('aria-label', 'Open specimen list');
  }

  private _select(id: string): void {
    const spec = AtlasSandbox.specimens.find((s) => s.id === id);
    if (!spec) return;

    this._activeSpec = spec;
    // Changing selection resets the preview tab so switching specimens
    // doesn't strand the user on, say, Source view.
    this._activeTab = 'preview';

    this._activeCategory = spec.category;
    this._writeUrlState(id);

    const root = this._root;

    // Keep the sidebar in sync with the new selection + category. The
    // sidebar element handles internal re-rendering + tab-bar value
    // updates when its properties change.
    const sidebar = this._sidebar;
    if (sidebar) {
      sidebar.activeCategory = spec.category;
      sidebar.activeSpecimenId = id;
    }

    const titleRow = root.querySelector(
      'atlas-stack[data-role="preview-title-row"]',
    ) as HTMLElement | null;
    if (titleRow) {
      const badgeStatus = BADGE_STATUS_MAP[spec.status];
      titleRow.innerHTML = `
        <atlas-heading level="2">${escapeHtml(spec.name)}</atlas-heading>
        <atlas-text variant="mono">&lt;${escapeHtml(spec.tag)}&gt;</atlas-text>
        <atlas-badge status="${badgeStatus}" title="${spec.status}" data-testid="sandbox.specimen-status">${spec.status}</atlas-badge>
      `;
    }

    const prevBar = root.querySelector<AtlasTabBar>(
      'atlas-tab-bar[data-role="preview-tabs"]',
    );
    if (prevBar) prevBar.value = this._activeTab;

    this._renderPreviewBody();
  }

  private _renderPreviewBody(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const body = root.querySelector(
      'atlas-box[data-role="preview-body"]',
    ) as HTMLElement | null;
    if (!body) return;

    // Any previously mounted live widgets must be unmounted before the
    // DOM is replaced — their cleanup functions handle teardown side
    // effects (mediator unsubscribes, iframe disposal, etc.).
    this._runActiveCleanups();
    body.innerHTML = '';
    body.setAttribute('data-tab', this._activeTab);

    const spec = this._activeSpec;
    if (!spec) return;

    switch (this._activeTab) {
      case 'preview':
        this._renderPreviewTab(body, spec);
        return;
      case 'source':
        this._renderSourceTab(body, spec);
        return;
      case 'props':
        this._renderPlaceholderTab(
          body,
          'Props introspection is not yet available for this specimen.',
        );
        return;
      case 'notes':
        this._renderPlaceholderTab(body, 'No notes authored for this specimen yet.');
        return;
    }
  }

  private _renderPreviewTab(body: HTMLElement, spec: ResolvedSpecimen): void {
    if (typeof spec.mount === 'function') {
      const variants =
        Array.isArray(spec.configVariants) && spec.configVariants.length > 0
          ? spec.configVariants
          : [{ name: 'default', config: {} } as SpecimenConfigVariant];
      const first = variants[0];
      if (!first) return;
      this._renderMountStateful(body, spec, variants, first.name);
    } else if (spec.states) {
      const stateKeys = Object.keys(spec.states);
      const initial = stateKeys.includes('success') ? 'success' : stateKeys[0];
      if (initial) this._renderStateful(body, spec, initial);
    } else if (spec.variants) {
      for (const variant of spec.variants) {
        this._renderVariant(body, variant);
      }
    }
  }

  private _renderSourceTab(body: HTMLElement, spec: ResolvedSpecimen): void {
    const blocks: string[] = [];
    if (spec.variants) {
      for (const v of spec.variants) {
        blocks.push(`/* ${v.name} */\n${v.html.trim()}`);
      }
    }
    if (spec.states) {
      for (const [k, html] of Object.entries(spec.states)) {
        blocks.push(`/* state: ${k} */\n${html.trim()}`);
      }
    }
    if (spec.configVariants) {
      for (const cv of spec.configVariants) {
        blocks.push(
          `/* config: ${cv.name} */\n${JSON.stringify(cv.config, null, 2)}`,
        );
      }
    }
    if (blocks.length === 0) {
      blocks.push(`<${spec.tag}></${spec.tag}>`);
    }
    const section = document.createElement('atlas-stack');
    section.setAttribute('gap', 'md');
    section.innerHTML = blocks
      .map((b) => `<pre data-testid="sandbox.source-block">${escapeHtml(b)}</pre>`)
      .join('');
    body.appendChild(section);
  }

  private _renderPlaceholderTab(body: HTMLElement, message: string): void {
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('padding', 'lg');
    wrap.innerHTML = `<atlas-text variant="muted">${escapeHtml(message)}</atlas-text>`;
    body.appendChild(wrap);
  }

  private _renderMountStateful(
    container: HTMLElement,
    spec: Specimen,
    variants: SpecimenConfigVariant[],
    activeName: string,
  ): void {
    // Bind spec.mount to a local so TS keeps the narrowing across the
    // closure in the try/catch below. Without this the type inside
    // `spec.mount!(...)` relies on the non-null assertion.
    const mount = spec.mount;
    if (typeof mount !== 'function') return;

    this._runActiveCleanups();
    container.innerHTML = '';

    if (variants.length > 1) {
      const bar = document.createElement('atlas-tab-bar');
      bar.setAttribute('name', 'variant-switcher');
      bar.setAttribute('size', 'sm');
      bar.setAttribute('aria-label', 'Config variants');
      bar.tabs = variants.map((v) => ({ value: variantSlug(v.name), label: v.name }));
      bar.value = variantSlug(activeName);
      bar.addEventListener('change', (ev: Event) => {
        const detail = (ev as CustomEvent<{ value: string }>).detail;
        const picked = variants.find((v) => variantSlug(v.name) === detail.value);
        if (picked) this._renderMountStateful(container, spec, variants, picked.name);
      });
      container.appendChild(bar);
    }

    const active = variants.find((v) => v.name === activeName) ?? variants[0];
    if (!active) return;

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

    const onLog = (kind: string, payload: unknown): void => {
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

    let cleanup: (() => void) | void;
    try {
      cleanup = mount(demo, {
        config: active.config ?? {},
        ...(active.isolation !== undefined ? { isolation: active.isolation } : {}),
        onLog,
      });
    } catch (err) {
      onLog('mount-error', err instanceof Error ? err.message : String(err));
      cleanup = () => {};
    }
    const finalCleanup: () => void = typeof cleanup === 'function' ? cleanup : () => {};
    this._activeCleanups.push(finalCleanup);
  }

  private _renderStateful(container: HTMLElement, spec: Specimen, activeState: string): void {
    container.innerHTML = '';

    const states = spec.states ?? {};
    const stateKeys = Object.keys(states);

    const bar = document.createElement('atlas-tab-bar');
    bar.setAttribute('name', 'state-switcher');
    bar.setAttribute('size', 'sm');
    bar.setAttribute('aria-label', 'States');
    bar.tabs = stateKeys.map((k) => ({ value: variantSlug(k), label: k }));
    bar.value = variantSlug(activeState);
    bar.addEventListener('change', (ev: Event) => {
      const detail = (ev as CustomEvent<{ value: string }>).detail;
      const key = stateKeys.find((k) => variantSlug(k) === detail.value);
      if (key) this._renderStateful(container, spec, key);
    });
    container.appendChild(bar);

    const demo = document.createElement('atlas-box');
    demo.setAttribute('data-role', 'variant-demo');
    demo.setAttribute('padding', 'lg');
    demo.innerHTML = states[activeState] ?? '';
    container.appendChild(demo);

    if (spec.variants) {
      for (const variant of spec.variants) {
        this._renderVariant(container, variant);
      }
    }
  }

  private _renderVariant(container: HTMLElement, variant: SpecimenVariant): void {
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

  static specimens: ResolvedSpecimen[] = [];

  static register(spec: Specimen): void {
    // Dev hot-reload can cause the same file to execute twice; warn
    // instead of throwing so the second registration is ignored but
    // doesn't break the page.
    if (AtlasSandbox.specimens.some((s) => s.id === spec.id)) {
      console.warn(
        '[sandbox] specimen "%s" already registered, ignoring duplicate',
        spec.id,
      );
      return;
    }
    AtlasSandbox.specimens.push(resolve(spec));
  }
}

AtlasElement.define('atlas-sandbox', AtlasSandbox);

function variantSlug(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
