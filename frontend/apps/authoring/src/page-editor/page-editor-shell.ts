/**
 * <authoring-page-editor-shell> — host for the page editor.
 *
 * The shell is a thin renderer over `PageEditorController` (see state.ts).
 * The controller owns the page document, derived regions / widget instances,
 * selection, mode, drawer state, save status, and history. The shell
 * subscribes and re-renders the parts whose snapshot changed.
 *
 * Layout:
 *
 *   +------------------------------------------+
 *   | topbar  (mode tabs, undo, redo, save)    |
 *   +-----+-------------------------+----------+
 *   | nav | canvas (content-page)   | drawer   |
 *   |     |                         |          |
 *   +-----+-------------------------+----------+
 *
 * Modes:
 *   structure — template/slot manipulation; drawer holds template settings.
 *   content   — widget operations; drawer holds palette OR widget settings.
 *   preview   — page renders without editor chrome; only an exit button.
 */

import { AtlasElement, AtlasSurface } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';
import { adoptAtlasWidgetStyles } from '@atlas/widgets/shared-styles';
import templatesCssText from '@atlas/bundle-standard/templates/templates.css?inline';
import './property-panel.ts';
import { editorWidgetSchemas } from './editor-widgets/index.ts';
import { moduleDefaultTemplateRegistry } from '@atlas/page-templates';
import type {
  EditorAPI,
  PageDocument,
  PageStore,
  WidgetInstance,
} from '@atlas/page-templates';
import type { WrappedPageStore } from './history.ts';
import type { PageEditorPropertyPanel } from './property-panel.ts';
import {
  PageEditorController,
  type DrawerState,
  type EditorMode,
  type PageEditorStateSnapshot,
} from './state.ts';

type OnLogFn = (kind: string, payload: unknown) => void;

interface ContentPageElement extends HTMLElement {
  pageId?: string;
  pageStore?: PageStore | WrappedPageStore | null;
  layoutRegistry?: unknown;
  templateRegistry?: unknown;
  principal?: unknown;
  tenantId?: string;
  correlationId?: string;
  capabilities?: Record<string, (args: unknown) => Promise<unknown>>;
  edit?: boolean;
  onMediatorTrace?: (evt: unknown) => void;
  onCapabilityTrace?: (evt: unknown) => void;
  editor?: EditorAPI | null;
  reload?: () => Promise<void>;
  _currentDoc?: PageDocument | null;
}

interface TemplateManifest {
  templateId?: string;
  version?: string;
  displayName?: string;
  regions: Array<{ name: string }>;
}

interface TemplateRegistry {
  list?: () => Array<{ templateId: string; displayName?: string }>;
  get: (id: string) => { manifest: TemplateManifest };
  has?: (id: string) => boolean;
}

const styles = `
  :host {
    display: grid;
    grid-template-columns: 56px 1fr auto;
    grid-template-rows: 48px 1fr;
    grid-template-areas:
      "topbar  topbar  topbar"
      "nav     canvas  drawer";
    width: 100%;
    height: min(720px, 80vh);
    min-height: 480px;
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    font-family: var(--atlas-font-family);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    overflow: hidden;
  }

  :host([data-mode="preview"]) {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "topbar"
      "canvas";
  }
  :host([data-mode="preview"]) atlas-box[data-role="nav"],
  :host([data-mode="preview"]) atlas-box[data-role="drawer"] {
    display: none;
  }

  atlas-box[data-role="topbar"] {
    grid-area: topbar;
    display: flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    padding: 0 var(--atlas-space-md);
    background: var(--atlas-color-surface);
    border-bottom: 1px solid var(--atlas-color-border);
    min-height: 48px;
  }
  atlas-box[data-role="topbar"] atlas-box[data-role="spacer"] {
    flex: 1;
  }

  atlas-box[data-role="nav"] {
    grid-area: nav;
    display: flex;
    flex-direction: column;
    gap: var(--atlas-space-sm);
    padding: var(--atlas-space-sm) var(--atlas-space-xs);
    background: var(--atlas-color-surface);
    border-right: 1px solid var(--atlas-color-border);
    align-items: center;
  }

  atlas-box[data-role="canvas"] {
    grid-area: canvas;
    overflow: auto;
    padding: var(--atlas-space-md);
    min-width: 0;
    background: var(--atlas-color-bg);
  }
  :host([data-mode="preview"]) atlas-box[data-role="canvas"] {
    padding: 0;
  }

  atlas-box[data-role="drawer"] {
    grid-area: drawer;
    width: 320px;
    overflow: auto;
    padding: var(--atlas-space-md);
    border-left: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-surface);
  }
  atlas-box[data-role="drawer"][data-drawer-kind="closed"] {
    display: none;
  }

  /* Multi-select visual outline (dashed) so it co-exists with edit-mount's
     single-selection ring without colliding visually. */
  atlas-box[data-role="canvas"] [data-widget-cell][data-multi-selected="true"] {
    outline: 2px dashed var(--atlas-color-primary);
    outline-offset: 4px;
  }

  /* In content mode, hide widget chrome unless the widget is hovered or
     selected. edit-mount's CSS already shows the chrome when
     :hover / :focus-within / [data-selected="true"] match; we suppress the
     baseline opacity:0.4 that would otherwise leak through. */
  :host([data-mode="content"]) atlas-box[data-role="canvas"]
    content-page[edit] [data-widget-cell] [data-cell-chrome] {
    opacity: 0;
  }
  :host([data-mode="content"]) atlas-box[data-role="canvas"]
    content-page[edit] [data-widget-cell]:hover [data-cell-chrome],
  :host([data-mode="content"]) atlas-box[data-role="canvas"]
    content-page[edit] [data-widget-cell]:focus-within [data-cell-chrome],
  :host([data-mode="content"]) atlas-box[data-role="canvas"]
    content-page[edit] [data-widget-cell][data-selected="true"] [data-cell-chrome],
  :host([data-mode="content"]) atlas-box[data-role="canvas"]
    content-page[edit] [data-widget-cell][data-multi-selected="true"] [data-cell-chrome] {
    opacity: 1;
  }

  /* In structure mode, the slot drop targets become the visual emphasis. */
  :host([data-mode="structure"]) atlas-box[data-role="canvas"]
    section[data-editor-slot] {
    outline: 1px dashed var(--atlas-color-border-strong, #94a3b8);
    outline-offset: 2px;
  }

  atlas-segmented-control[name="mode"] {
    margin-right: var(--atlas-space-sm);
  }

  atlas-text[name="save-status"] {
    margin-right: var(--atlas-space-sm);
  }

  atlas-button[disabled] { opacity: 0.5; pointer-events: none; }
`;

const MODE_OPTIONS: Array<{ value: EditorMode; label: string; testValue: string }> = [
  { value: 'structure', label: 'Structure', testValue: 'mode-structure' },
  { value: 'content', label: 'Content', testValue: 'mode-content' },
  { value: 'preview', label: 'Preview', testValue: 'mode-preview' },
];

export class AuthoringPageEditorShellElement extends AtlasSurface {
  static override surfaceId = 'authoring.page-editor.shell';

  pageId = '';
  pageStore: PageStore | null = null;
  layoutRegistry: unknown = null;
  templateRegistry: TemplateRegistry | null = null;
  principal: unknown = null;
  tenantId = '';
  correlationId = '';
  capabilities: Record<string, (args: unknown) => Promise<unknown>> = {};
  onLog: OnLogFn = () => {};

  private _controller: PageEditorController | null = null;
  private _canvasPage: ContentPageElement | null = null;
  private _canvasHost: HTMLElement | null = null;
  private _drawerEl: HTMLElement | null = null;
  private _propertyPanel: (PageEditorPropertyPanel & HTMLElement) | null = null;
  private _onCanvasClick: (e: Event) => void;
  private _onKeyDown: (e: KeyboardEvent) => void;
  private _unsubscribe: (() => void) | null = null;
  private _lastSnapshot: PageEditorStateSnapshot | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this.shadowRoot as unknown as ShadowRoot);
    adoptAtlasWidgetStyles(this.shadowRoot as unknown as ShadowRoot);

    this._onCanvasClick = (e: Event) => this._handleCanvasClick(e);
    this._onKeyDown = (e: KeyboardEvent) => this._handleKeyDown(e);
  }

  override connectedCallback(): void {
    super.connectedCallback?.();
    this._applyTestId?.();
    queueMicrotask(() => void this._init());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback?.();
    this._canvasHost?.removeEventListener('click', this._onCanvasClick, true);
    document.removeEventListener('keydown', this._onKeyDown);
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._controller?.dispose();
    this._controller = null;
    this._canvasPage = null;
    this._canvasHost = null;
    this._drawerEl = null;
    this._propertyPanel = null;
    this._lastSnapshot = null;
  }

  /** Imperative handle for tests / caller code that needs the controller. */
  get editorState(): PageEditorController | null {
    return this._controller;
  }

  /** Snapshot accessor for tests. */
  getEditorSnapshot(): PageEditorStateSnapshot | null {
    return this._controller?.getSnapshot() ?? null;
  }

  /** Direct mutator API exposed for tests that need to bypass the DOM. */
  get editor(): EditorAPI | null {
    return this._canvasPage?.editor ?? null;
  }

  // ---- init ----

  private async _init(): Promise<void> {
    if (!this.pageStore) return;
    const initialDoc = await this.pageStore.get(this.pageId);
    this._controller = new PageEditorController({
      pageId: this.pageId,
      pageStore: this.pageStore,
      initialDoc,
      initialMode: 'content',
    });
    this._unsubscribe = this._controller.subscribe((snap) => this._onSnapshot(snap));

    this._renderShell();
    await this._mountCanvas();
    // Sync the initial snapshot now that the canvas has an editor handle.
    this._onSnapshot(this._controller.getSnapshot());
    this.onLog?.('editor-mount', { pageId: this.pageId });
  }

  private _renderShell(): void {
    const root = this.shadowRoot as ShadowRoot;
    root.innerHTML = `
      <style>${styles}\n${templatesCssText}</style>
      <atlas-box data-role="topbar" name="topbar">
        <atlas-segmented-control name="mode" aria-label="Editor mode" size="sm"></atlas-segmented-control>
        <atlas-button name="undo" variant="ghost" size="sm" aria-label="Undo">Undo</atlas-button>
        <atlas-button name="redo" variant="ghost" size="sm" aria-label="Redo">Redo</atlas-button>
        <atlas-button name="save" variant="ghost" size="sm" aria-label="Save">Save</atlas-button>
        <atlas-text variant="muted" name="save-status">saved</atlas-text>
        <atlas-box data-role="spacer"></atlas-box>
        <atlas-text variant="small" name="page-title"></atlas-text>
        <atlas-button name="preview-toggle" variant="ghost" size="sm" aria-label="Preview">Preview</atlas-button>
        <atlas-button name="exit-preview" variant="ghost" size="sm" aria-label="Exit preview">Exit preview</atlas-button>
      </atlas-box>
      <atlas-box data-role="nav" name="nav">
        <atlas-button name="nav-templates" variant="ghost" size="sm" aria-label="Templates">T</atlas-button>
      </atlas-box>
      <atlas-box data-role="canvas" name="canvas" tabindex="-1"></atlas-box>
      <atlas-box data-role="drawer" name="drawer" data-drawer-kind="closed"></atlas-box>
    `;

    const segmented = root.querySelector('atlas-segmented-control[name="mode"]') as
      (HTMLElement & { options: unknown; value: string | null }) | null;
    if (segmented) {
      segmented.options = MODE_OPTIONS.map((m) => ({ value: m.testValue, label: m.label }));
      segmented.value = 'mode-content';
      segmented.addEventListener('change', (ev) => {
        const value = (ev as CustomEvent<{ value: string }>).detail?.value;
        const mode = MODE_OPTIONS.find((m) => m.testValue === value)?.value;
        if (mode) this._controller?.setMode(mode);
      });
    }

    const undoBtn = root.querySelector('atlas-button[name="undo"]');
    const redoBtn = root.querySelector('atlas-button[name="redo"]');
    const saveBtn = root.querySelector('atlas-button[name="save"]');
    const previewBtn = root.querySelector('atlas-button[name="preview-toggle"]');
    const exitPreviewBtn = root.querySelector('atlas-button[name="exit-preview"]');
    const navTemplatesBtn = root.querySelector('atlas-button[name="nav-templates"]');

    undoBtn?.addEventListener('click', () => void this._undo());
    redoBtn?.addEventListener('click', () => void this._redo());
    saveBtn?.addEventListener('click', () => void this._controller?.save());
    previewBtn?.addEventListener('click', () => this._controller?.setMode('preview'));
    exitPreviewBtn?.addEventListener('click', () => this._controller?.setMode('content'));
    navTemplatesBtn?.addEventListener('click', () => {
      this._controller?.setMode('structure');
    });

    document.addEventListener('keydown', this._onKeyDown);

    this._canvasHost = root.querySelector('atlas-box[data-role="canvas"]') as HTMLElement | null;
    this._canvasHost?.addEventListener('click', this._onCanvasClick, true);

    this._drawerEl = root.querySelector('atlas-box[data-role="drawer"]') as HTMLElement | null;
  }

  private async _mountCanvas(): Promise<void> {
    if (!this._canvasHost || !this._controller) return;
    this._canvasHost.textContent = '';
    const page = document.createElement('content-page') as ContentPageElement;
    page.pageId = this.pageId;
    page.pageStore = this._controller.wrappedStore;
    if (this.layoutRegistry) page.layoutRegistry = this.layoutRegistry;
    if (this.templateRegistry) page.templateRegistry = this.templateRegistry;
    page.principal = this.principal;
    page.tenantId = this.tenantId;
    page.correlationId = this.correlationId;
    page.capabilities = this.capabilities ?? {};
    page.edit = this._controller.getSnapshot().mode !== 'preview';
    page.onMediatorTrace = (evt) => this.onLog?.('mediator', evt);
    page.onCapabilityTrace = (evt) => this.onLog?.('capability', evt);
    this._canvasHost.appendChild(page);
    this._canvasPage = page;
    // The content-page mounts asynchronously; poll a few microtasks for its
    // editor handle to appear, then hand it to the controller.
    await this._waitForEditor();
    this._controller.setEditor(this._canvasPage?.editor ?? null);
  }

  private async _waitForEditor(): Promise<void> {
    for (let i = 0; i < 30; i++) {
      if (this._canvasPage?.editor) return;
      await new Promise<void>((r) => queueMicrotask(() => r()));
    }
  }

  // ---- snapshot rendering ----

  private _onSnapshot(snap: PageEditorStateSnapshot): void {
    const prev = this._lastSnapshot;
    this._lastSnapshot = snap;
    const root = this.shadowRoot as ShadowRoot | null;
    if (!root) return;

    if (!prev || prev.mode !== snap.mode) {
      this.setAttribute('data-mode', snap.mode);
      const seg = root.querySelector('atlas-segmented-control[name="mode"]') as
        (HTMLElement & { value: string | null }) | null;
      if (seg) seg.value = `mode-${snap.mode}`;
      const exit = root.querySelector('atlas-button[name="exit-preview"]') as HTMLElement | null;
      const previewBtn = root.querySelector('atlas-button[name="preview-toggle"]') as HTMLElement | null;
      if (exit) exit.style.display = snap.mode === 'preview' ? '' : 'none';
      if (previewBtn) previewBtn.style.display = snap.mode === 'preview' ? 'none' : '';
      void this._reflectModeOnCanvas(snap.mode);
    }

    if (!prev || prev.status !== snap.status) {
      const el = root.querySelector('atlas-text[name="save-status"]');
      if (el) el.textContent = snap.status;
    }

    if (
      !prev ||
      prev.history.canUndo !== snap.history.canUndo ||
      prev.history.canRedo !== snap.history.canRedo
    ) {
      const undoBtn = root.querySelector('atlas-button[name="undo"]') as HTMLElement | null;
      const redoBtn = root.querySelector('atlas-button[name="redo"]') as HTMLElement | null;
      if (undoBtn) toggleDisabled(undoBtn, !snap.history.canUndo);
      if (redoBtn) toggleDisabled(redoBtn, !snap.history.canRedo);
    }

    if (
      !prev ||
      prev.pageDocument !== snap.pageDocument ||
      (prev.pageDocument?.['meta'] as { title?: string } | undefined)?.title !==
        (snap.pageDocument?.['meta'] as { title?: string } | undefined)?.title
    ) {
      const titleEl = root.querySelector('atlas-text[name="page-title"]');
      if (titleEl) {
        const t = (snap.pageDocument?.['meta'] as { title?: string } | undefined)?.title ?? snap.pageId;
        titleEl.textContent = t;
      }
    }

    if (!prev || prev.selectedWidgetInstanceIds.join(',') !== snap.selectedWidgetInstanceIds.join(',')) {
      this._reflectMultiSelect(snap.selectedWidgetInstanceIds);
    }

    if (!prev || prev.mode !== snap.mode || drawerChanged(prev.drawer, snap.drawer)) {
      this._renderDrawer(snap);
    }
  }

  private async _reflectModeOnCanvas(mode: EditorMode): Promise<void> {
    if (!this._canvasPage) return;
    const wantsEdit = mode !== 'preview';
    if (this._canvasPage.edit === wantsEdit) return;
    this._canvasPage.edit = wantsEdit;
    try {
      await this._canvasPage.reload?.();
    } finally {
      this._controller?.setEditor(this._canvasPage.editor ?? null);
    }
  }

  private _reflectMultiSelect(ids: ReadonlyArray<string>): void {
    if (!this._canvasHost) return;
    const all = this._canvasHost.querySelectorAll('[data-widget-cell][data-multi-selected="true"]');
    for (const el of all) el.removeAttribute('data-multi-selected');
    if (ids.length > 1) {
      for (const id of ids) {
        const cell = this._canvasHost.querySelector(
          `[data-widget-cell][data-instance-id="${CSS.escape(id)}"]`,
        );
        cell?.setAttribute('data-multi-selected', 'true');
      }
    }
  }

  private _renderDrawer(snap: PageEditorStateSnapshot): void {
    const drawer = this._drawerEl;
    if (!drawer) return;
    drawer.setAttribute('data-drawer-kind', snap.drawer.kind);
    drawer.textContent = '';

    if (snap.mode === 'preview' || snap.drawer.kind === 'closed') {
      this._propertyPanel = null;
      return;
    }

    if (snap.mode === 'structure') {
      drawer.appendChild(this._buildTemplateDrawer(snap));
      return;
    }

    // content mode
    if (snap.drawer.kind === 'palette') {
      drawer.appendChild(this._buildAddWidgetDrawer(snap));
    } else if (snap.drawer.kind === 'settings') {
      drawer.appendChild(this._buildSettingsDrawer(snap.drawer.widgetInstanceId));
    }
  }

  private _buildTemplateDrawer(snap: PageEditorStateSnapshot): HTMLElement {
    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'sm');
    wrap.setAttribute('name', 'template-drawer-content');

    const heading = document.createElement('atlas-heading');
    heading.setAttribute('level', '4');
    heading.textContent = 'Template';
    wrap.appendChild(heading);

    const sub = document.createElement('atlas-text');
    sub.setAttribute('variant', 'muted');
    sub.textContent = 'Select a template for this page. Widgets in regions that no longer exist will be removed.';
    wrap.appendChild(sub);

    const select = document.createElement('atlas-select') as HTMLElement & {
      options: unknown;
      value: string;
    };
    select.setAttribute('name', 'template-select');
    select.setAttribute('aria-label', 'Template');

    const registry: TemplateRegistry =
      this.templateRegistry ?? (moduleDefaultTemplateRegistry as unknown as TemplateRegistry);
    const list = registry.list?.() ?? [];
    select.options = list.map((t) => ({ value: t.templateId, label: t.displayName ?? t.templateId }));
    select.value = snap.layoutTemplateId;
    select.addEventListener('change', (ev) => {
      const next = (ev as CustomEvent<{ value: string }>).detail?.value ?? select.value;
      if (next && next !== snap.layoutTemplateId) {
        void this._switchTemplate(next);
      }
    });
    wrap.appendChild(select);

    return wrap;
  }

  private _buildAddWidgetDrawer(snap: PageEditorStateSnapshot): HTMLElement {
    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'sm');
    wrap.setAttribute('name', 'add-widget-drawer-content');

    const heading = document.createElement('atlas-heading');
    heading.setAttribute('level', '4');
    heading.textContent = 'Add widget';
    wrap.appendChild(heading);

    const hint = document.createElement('atlas-text');
    hint.setAttribute('variant', 'muted');
    const firstRegion = snap.regions[0]?.name;
    hint.textContent = firstRegion
      ? `Select a chip to add into "${firstRegion}", or drag onto a region.`
      : 'Pick a template with regions to enable adding widgets.';
    wrap.appendChild(hint);

    const list = document.createElement('atlas-stack');
    list.setAttribute('gap', 'xs');

    const seen = new Set<string>();
    for (const widgetId of Object.keys(editorWidgetSchemas)) {
      if (seen.has(widgetId)) continue;
      seen.add(widgetId);
      const chip = document.createElement('atlas-button');
      chip.setAttribute('name', `palette-${widgetId}`);
      chip.setAttribute('data-palette-chip', '');
      chip.setAttribute('data-widget-id', widgetId);
      chip.setAttribute('size', 'sm');
      chip.setAttribute('variant', 'ghost');
      chip.textContent = widgetId;
      chip.addEventListener('click', () => {
        if (firstRegion) {
          void this._controller?.addWidget({ widgetId, region: firstRegion });
        }
      });
      list.appendChild(chip);
    }
    wrap.appendChild(list);
    return wrap;
  }

  private _buildSettingsDrawer(instanceId: string): HTMLElement {
    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'sm');
    wrap.setAttribute('name', 'settings-drawer-content');

    const panel = document.createElement('page-editor-property-panel') as
      PageEditorPropertyPanel & HTMLElement;
    panel.setAttribute('name', 'property-panel');
    panel.onChange = (cfg) => void this._controller?.updateWidgetConfig(instanceId, cfg);
    wrap.appendChild(panel);
    this._propertyPanel = panel;

    queueMicrotask(() => this._populatePanel(instanceId));
    return wrap;
  }

  private _populatePanel(instanceId: string): void {
    if (!this._propertyPanel) return;
    const editor = this._canvasPage?.editor;
    if (!editor) {
      this._propertyPanel.clear();
      return;
    }
    const entry = editor.get(instanceId);
    if (!entry) {
      this._propertyPanel.clear();
      return;
    }
    const schema = editorWidgetSchemas[entry.widgetId];
    if (!schema) {
      this._propertyPanel.clear();
      this.onLog?.('inspector-no-schema', { widgetId: entry.widgetId });
      return;
    }
    this._propertyPanel.configure({
      widgetId: entry.widgetId,
      instanceId: entry.instanceId,
      config: entry.config,
      schema,
    });
  }

  // ---- canvas click -> selection ----

  private _handleCanvasClick(event: Event): void {
    if (!this._controller) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest('[data-widget-cell]');
    if (!cell) {
      this._controller.selectWidget(null);
      return;
    }
    const instanceId = cell.getAttribute('data-instance-id');
    if (!instanceId) return;
    const me = event as MouseEvent;
    const additive = me.shiftKey || me.metaKey || me.ctrlKey;
    this._controller.selectWidget(instanceId, { additive });
  }

  // ---- template switching ----

  private async _switchTemplate(nextTemplateId: string): Promise<void> {
    if (!this._controller || !this.pageStore) return;
    const currentDoc = this._controller.getSnapshot().pageDocument;
    if (!currentDoc || currentDoc.templateId === nextTemplateId) return;
    const registry: TemplateRegistry =
      this.templateRegistry ?? (moduleDefaultTemplateRegistry as unknown as TemplateRegistry);
    let nextManifest: TemplateManifest;
    try {
      nextManifest = registry.get(nextTemplateId).manifest;
    } catch {
      this.onLog?.('template-switch-unknown', { nextTemplateId });
      return;
    }
    const nextRegionNames = new Set(nextManifest.regions.map((r) => r.name));
    const dropped: Array<{ instanceId: string; widgetId: string; region: string }> = [];
    for (const [regionName, entries] of Object.entries(currentDoc.regions ?? {})) {
      if (!nextRegionNames.has(regionName)) {
        for (const e of entries as WidgetInstance[]) {
          dropped.push({ instanceId: e.instanceId, widgetId: e.widgetId, region: regionName });
        }
      }
    }
    if (dropped.length > 0) {
      const ok = window.confirm(
        `Switching to "${nextManifest.displayName ?? nextTemplateId}" will remove ${dropped.length} widget(s) from regions that don't exist in the new template. Continue?`,
      );
      if (!ok) {
        this.onLog?.('template-switch-cancelled', { nextTemplateId, dropped: dropped.length });
        return;
      }
    }
    const nextRegions: Record<string, WidgetInstance[]> = {};
    for (const [regionName, entries] of Object.entries(currentDoc.regions ?? {})) {
      if (nextRegionNames.has(regionName)) nextRegions[regionName] = entries as WidgetInstance[];
    }
    for (const r of nextRegionNames) {
      if (!(r in nextRegions)) nextRegions[r] = [];
    }
    const nextDoc: PageDocument = {
      ...currentDoc,
      templateId: nextTemplateId,
      ...(nextManifest.version !== undefined ? { templateVersion: nextManifest.version } : {}),
      regions: nextRegions,
    };
    const result = await this._controller.setLayoutTemplate(nextDoc);
    if (!result.ok) return;
    // Remount the canvas so content-page picks up the new template.
    await this._mountCanvas();
    this._controller.setDocument(nextDoc);
    this.onLog?.('template-switched', {
      from: currentDoc.templateId,
      to: nextTemplateId,
      widgetsRemoved: dropped.length,
    });
  }

  // ---- undo / redo ----

  private async _undo(): Promise<void> {
    if (!this._controller) return;
    const ok = await this._controller.undo();
    if (ok) {
      await this._canvasPage?.reload?.();
      this._controller.setEditor(this._canvasPage?.editor ?? null);
    }
  }

  private async _redo(): Promise<void> {
    if (!this._controller) return;
    const ok = await this._controller.redo();
    if (ok) {
      await this._canvasPage?.reload?.();
      this._controller.setEditor(this._canvasPage?.editor ?? null);
    }
  }

  // ---- keyboard ----

  private _handleKeyDown(e: KeyboardEvent): void {
    if (!this._controller) return;
    const path = e.composedPath();
    if (!path.includes(this)) return;

    const inField = path.some(
      (el) =>
        el instanceof Element &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'),
    );
    const isMeta = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (isMeta && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      void this._undo();
      return;
    }
    if (isMeta && ((key === 'z' && e.shiftKey) || key === 'y')) {
      e.preventDefault();
      void this._redo();
      return;
    }
    const snap = this._controller.getSnapshot();
    if (
      !inField &&
      (e.key === 'Delete' || e.key === 'Backspace') &&
      snap.selectedWidgetInstanceIds.length > 0
    ) {
      e.preventDefault();
      void this._controller.removeSelected();
      return;
    }
    if (e.key === 'Escape' && snap.selectedWidgetInstanceIds.length > 0) {
      this._controller.selectWidget(null);
    }
  }
}

function drawerChanged(a: DrawerState, b: DrawerState): boolean {
  if (a.kind !== b.kind) return true;
  if (a.kind === 'settings' && b.kind === 'settings') {
    return a.widgetInstanceId !== b.widgetInstanceId;
  }
  return false;
}

function toggleDisabled(el: HTMLElement, disabled: boolean): void {
  if (disabled) el.setAttribute('disabled', '');
  else el.removeAttribute('disabled');
}

AtlasElement.define('authoring-page-editor-shell', AuthoringPageEditorShellElement);
