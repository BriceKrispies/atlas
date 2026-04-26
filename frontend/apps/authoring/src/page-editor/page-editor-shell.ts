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
import { registerTestState } from '@atlas/test-state';
import templatesCssText from '@atlas/bundle-standard/templates/templates.css?inline';
import './property-panel.ts';
// `<atlas-dialog>` is registered as a side effect of `@atlas/design`'s
// barrel, which the authoring app loads at boot via `src/main.ts`.
import {
  loadPanelSizes,
  savePanelSize,
  type PageEditorLeftPanelElement,
  type PageEditorRightPanelElement,
  type PageEditorBottomPanelElement,
  type PanelResizeEventDetail,
  type PanelTabEventDetail,
  type PanelToggleEventDetail,
} from './panels/index.ts';
import './panels/left-panel.ts';
import './panels/right-panel.ts';
import './panels/bottom-panel.ts';
// Burst-C content elements that slot into the panels and the canvas-stage:
import './left-panel/index.ts';
import './right-panel/index.ts';
import './preview/index.ts';
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
  PANEL_SIZE_BOUNDS,
  type EditorMode,
  type LeftPanelTab,
  type PageEditorStateSnapshot,
  type PanelId,
  type PanelsState,
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
    --atlas-pe-left-w: 280px;
    --atlas-pe-right-w: 320px;
    --atlas-pe-bottom-h: 200px;
    display: grid;
    grid-template-columns: var(--atlas-pe-left-w) minmax(0, 1fr) var(--atlas-pe-right-w);
    grid-template-rows: 48px minmax(0, 1fr) var(--atlas-pe-bottom-h);
    grid-template-areas:
      "topbar topbar topbar"
      "left   canvas right"
      "bottom bottom bottom";
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

  /* Closed-panel collapses its grid track to zero so the canvas reclaims space. */
  :host([data-left-open="false"]) {
    grid-template-columns: 0 minmax(0, 1fr) var(--atlas-pe-right-w);
  }
  :host([data-right-open="false"]) {
    grid-template-columns: var(--atlas-pe-left-w) minmax(0, 1fr) 0;
  }
  :host([data-left-open="false"][data-right-open="false"]) {
    grid-template-columns: 0 minmax(0, 1fr) 0;
  }
  :host([data-bottom-open="false"]) {
    grid-template-rows: 48px minmax(0, 1fr) 0;
  }

  /* Preview mode hides every panel and the topbar's editor-only controls. */
  :host([data-mode="preview"]) {
    grid-template-columns: 0 minmax(0, 1fr) 0;
    grid-template-rows: 48px minmax(0, 1fr) 0;
  }
  :host([data-mode="preview"]) page-editor-left-panel,
  :host([data-mode="preview"]) page-editor-right-panel,
  :host([data-mode="preview"]) page-editor-bottom-panel {
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

  /* Panel hosts. */
  page-editor-left-panel {
    grid-area: left;
  }
  page-editor-right-panel {
    grid-area: right;
  }
  page-editor-bottom-panel {
    grid-area: bottom;
  }
  page-editor-left-panel,
  page-editor-right-panel,
  page-editor-bottom-panel {
    position: relative;
    display: grid;
    grid-template-rows: 36px minmax(0, 1fr);
    background: var(--atlas-color-surface);
    overflow: hidden;
    min-width: 0;
    min-height: 0;
  }
  page-editor-left-panel { border-right: 1px solid var(--atlas-color-border); }
  page-editor-right-panel { border-left: 1px solid var(--atlas-color-border); }
  page-editor-bottom-panel { border-top: 1px solid var(--atlas-color-border); }

  page-editor-left-panel[data-open="false"],
  page-editor-right-panel[data-open="false"],
  page-editor-bottom-panel[data-open="false"] {
    display: none;
  }

  .atlas-page-editor-panel__header {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-xs);
    padding: 0 var(--atlas-space-xs) 0 var(--atlas-space-sm);
    background: var(--atlas-color-surface);
    border-bottom: 1px solid var(--atlas-color-border);
    height: 36px;
    box-sizing: border-box;
  }
  .atlas-page-editor-panel__title {
    font-weight: 600;
    font-size: 0.85em;
    color: var(--atlas-color-text-muted, #64748b);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .atlas-page-editor-panel__tabs {
    display: flex;
    gap: var(--atlas-space-xs);
    flex: 1;
    min-width: 0;
    align-items: center;
    overflow: hidden;
  }
  /* Keep the collapse button compact and right-aligned in the panel header so
     it doesn't crowd the tab strip or visually float over the canvas. */
  .atlas-page-editor-panel__header > atlas-button[name="collapse"] {
    flex: 0 0 auto;
    min-width: 0;
    padding-inline: var(--atlas-space-xs);
    margin-inline-start: auto;
    opacity: 0.7;
  }
  .atlas-page-editor-panel__header > atlas-button[name="collapse"]:hover {
    opacity: 1;
  }
  .atlas-page-editor-panel__body {
    overflow: auto;
    padding: var(--atlas-space-md);
  }

  /* Resize handles. */
  .atlas-page-editor-panel__resize {
    position: absolute;
    background: transparent;
    z-index: 1;
  }
  page-editor-left-panel .atlas-page-editor-panel__resize {
    top: 0; bottom: 0; right: 0; width: 4px; cursor: col-resize;
  }
  page-editor-right-panel .atlas-page-editor-panel__resize {
    top: 0; bottom: 0; left: 0; width: 4px; cursor: col-resize;
  }
  page-editor-bottom-panel .atlas-page-editor-panel__resize {
    left: 0; right: 0; top: 0; height: 4px; cursor: row-resize;
  }
  .atlas-page-editor-panel__resize:hover {
    background: var(--atlas-color-primary);
  }

  /* Floating "open" buttons that appear on the canvas edge when a panel is closed. */
  atlas-box[data-role="canvas-edge"] {
    position: absolute;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: var(--atlas-space-xs);
    padding: var(--atlas-space-xs);
  }
  atlas-box[data-role="canvas-edge"][data-edge="left"]   { left: 0;   top: var(--atlas-space-sm); }
  atlas-box[data-role="canvas-edge"][data-edge="right"]  { right: 0;  top: var(--atlas-space-sm); }
  atlas-box[data-role="canvas-edge"][data-edge="bottom"] { right: 0;  bottom: 0; }

  atlas-box[data-role="canvas"] {
    grid-area: canvas;
    position: relative;
    overflow: auto;
    padding: var(--atlas-space-md);
    min-width: 0;
    background: var(--atlas-color-bg);
  }
  :host([data-mode="preview"]) atlas-box[data-role="canvas"] {
    padding: 0;
  }
  /* The stage is the actual mount point for <content-page>. The shell's
     canvas-edge open buttons are absolutely-positioned siblings, so the
     stage must fill the canvas so the content sits beneath them. */
  atlas-box[data-role="canvas-stage"] {
    display: block;
    width: 100%;
    min-height: 100%;
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

  /* Mobile-first override (≤768px): panels become floating overlays so the
     canvas always gets full width. C16.5 — no horizontal document scroll
     at 320px. */
  @media (max-width: 768px) {
    :host,
    :host([data-left-open="false"]),
    :host([data-right-open="false"]),
    :host([data-bottom-open="false"]) {
      grid-template-columns: minmax(0, 1fr);
    }
    page-editor-left-panel,
    page-editor-right-panel,
    page-editor-bottom-panel {
      position: absolute;
      top: 48px;
      bottom: 0;
      width: min(80vw, var(--atlas-pe-left-w));
      max-width: 80vw;
      box-shadow: 0 0 24px rgba(0,0,0,0.18);
      z-index: 3;
    }
    page-editor-left-panel  { left: 0; right: auto; }
    page-editor-right-panel { right: 0; left: auto; width: min(80vw, var(--atlas-pe-right-w)); }
    page-editor-bottom-panel {
      left: 0; right: 0; top: auto;
      width: 100%; max-width: 100%;
      height: var(--atlas-pe-bottom-h);
    }
  }
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
  private _canvasStage: HTMLElement | null = null;
  private _leftPanel: PageEditorLeftPanelElement | null = null;
  private _rightPanel: PageEditorRightPanelElement | null = null;
  private _bottomPanel: PageEditorBottomPanelElement | null = null;
  /** Panel-body slot containers, keyed by `<panel>:<tab>`. */
  private _tabSlots: Map<string, HTMLElement> = new Map();
  private _propertyPanel: (PageEditorPropertyPanel & HTMLElement) | null = null;
  private _propertyPanelInstanceId: string | null = null;
  /** Pixel size at the moment a resize started, per panel. */
  private _resizeOriginSize: Partial<Record<PanelId, number>> = {};
  private _onCanvasClick: (e: Event) => void;
  private _onKeyDown: (e: KeyboardEvent) => void;
  private _onPanelToggle: (e: Event) => void;
  private _onPanelTab: (e: Event) => void;
  private _onPanelResize: (e: Event) => void;
  private _unsubscribe: (() => void) | null = null;
  private _disposeTestState: (() => void) | null = null;
  private _lastSnapshot: PageEditorStateSnapshot | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this.shadowRoot as unknown as ShadowRoot);
    adoptAtlasWidgetStyles(this.shadowRoot as unknown as ShadowRoot);

    this._onCanvasClick = (e: Event) => this._handleCanvasClick(e);
    this._onKeyDown = (e: KeyboardEvent) => this._handleKeyDown(e);
    this._onPanelToggle = (e: Event) => this._handlePanelToggle(e as CustomEvent<PanelToggleEventDetail>);
    this._onPanelTab = (e: Event) => this._handlePanelTab(e as CustomEvent<PanelTabEventDetail>);
    this._onPanelResize = (e: Event) => this._handlePanelResize(e as CustomEvent<PanelResizeEventDetail>);
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
    const root = this.shadowRoot;
    if (root) {
      root.removeEventListener('atlas-panel-toggle', this._onPanelToggle);
      root.removeEventListener('atlas-panel-tab', this._onPanelTab);
      root.removeEventListener('atlas-panel-resize', this._onPanelResize);
    }
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._disposeTestState?.();
    this._disposeTestState = null;
    this._controller?.dispose();
    this._controller = null;
    this._canvasPage = null;
    this._canvasHost = null;
    this._canvasStage = null;
    this._leftPanel = null;
    this._rightPanel = null;
    this._bottomPanel = null;
    this._tabSlots.clear();
    this._propertyPanel = null;
    this._propertyPanelInstanceId = null;
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
      initialPanelSizes: loadPanelSizes(),
    });
    this._unsubscribe = this._controller.subscribe((snap) => this._onSnapshot(snap));

    // Expose the shell controller's snapshot to Playwright via
    // `window.__atlasTest.getEditorState('<pageId>:shell')` and
    // `getLastCommit('editor:<pageId>:shell')`. Keyed distinctly from the
    // inner content-page editor (which already owns `editor:<pageId>`) so
    // shell-level intents (mode, drawer, undo/redo, panel state) are
    // observable without colliding with document-level intents.
    const controller = this._controller;
    this._disposeTestState = registerTestState(controller.surfaceId, () =>
      controller.getSnapshot(),
    );

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
      <page-editor-left-panel name="left-panel"></page-editor-left-panel>
      <atlas-box data-role="canvas" name="canvas" tabindex="-1">
        <atlas-box data-role="canvas-stage"></atlas-box>
        <atlas-box data-role="canvas-edge" data-edge="left">
          <atlas-button name="open-left" variant="ghost" size="sm" aria-label="Open left panel">▶</atlas-button>
        </atlas-box>
        <atlas-box data-role="canvas-edge" data-edge="right">
          <atlas-button name="open-right" variant="ghost" size="sm" aria-label="Open right panel">◀</atlas-button>
        </atlas-box>
        <atlas-box data-role="canvas-edge" data-edge="bottom">
          <atlas-button name="open-bottom" variant="ghost" size="sm" aria-label="Open bottom panel">▲</atlas-button>
        </atlas-box>
      </atlas-box>
      <page-editor-right-panel name="right-panel"></page-editor-right-panel>
      <page-editor-bottom-panel name="bottom-panel"></page-editor-bottom-panel>
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
    const openLeftBtn = root.querySelector('atlas-button[name="open-left"]');
    const openRightBtn = root.querySelector('atlas-button[name="open-right"]');
    const openBottomBtn = root.querySelector('atlas-button[name="open-bottom"]');

    undoBtn?.addEventListener('click', () => void this._undo());
    redoBtn?.addEventListener('click', () => void this._redo());
    saveBtn?.addEventListener('click', () => void this._controller?.save());
    previewBtn?.addEventListener('click', () => this._controller?.setMode('preview'));
    exitPreviewBtn?.addEventListener('click', () => this._controller?.setMode('content'));
    openLeftBtn?.addEventListener('click', () => this._controller?.togglePanel('left', true));
    openRightBtn?.addEventListener('click', () => this._controller?.togglePanel('right', true));
    openBottomBtn?.addEventListener('click', () => this._controller?.togglePanel('bottom', true));

    document.addEventListener('keydown', this._onKeyDown);

    this._canvasHost = root.querySelector('atlas-box[data-role="canvas"]') as HTMLElement | null;
    this._canvasStage = this._canvasHost?.querySelector(
      'atlas-box[data-role="canvas-stage"]',
    ) as HTMLElement | null;
    this._canvasHost?.addEventListener('click', this._onCanvasClick, true);

    this._leftPanel = root.querySelector('page-editor-left-panel') as PageEditorLeftPanelElement | null;
    this._rightPanel = root.querySelector('page-editor-right-panel') as PageEditorRightPanelElement | null;
    this._bottomPanel = root.querySelector('page-editor-bottom-panel') as PageEditorBottomPanelElement | null;

    // Configure tab labels on each panel. The left-panel vocabulary depends
    // on mode (palette+outline in content, templates in structure); seed the
    // initial set here and let `_onSnapshot` swap on mode changes.
    this._leftPanel?.setTabs([
      { id: 'palette', label: 'Palette' },
      { id: 'outline', label: 'Outline' },
    ]);
    this._rightPanel?.setTabs([{ id: 'settings', label: 'Inspector' }]);
    this._bottomPanel?.setTabs([{ id: 'issues', label: 'Issues' }]);

    // Build the per-tab slot containers inside each panel's body.
    this._buildTabSlots();

    // Listen once at the shadow root for all panel events.
    root.addEventListener('atlas-panel-toggle', this._onPanelToggle);
    root.addEventListener('atlas-panel-tab', this._onPanelTab);
    root.addEventListener('atlas-panel-resize', this._onPanelResize);
  }

  /**
   * Build empty `[data-tab=…]` slot containers inside each panel's body
   * so snapshot updates can target them by `${panelId}:${tab}`. Content
   * (palette chips, property panel, templates select) is rendered into
   * the appropriate slot by `_renderTabContent`.
   */
  private _buildTabSlots(): void {
    this._tabSlots.clear();
    const wireSlots = (
      panel: HTMLElement | null,
      panelId: PanelId,
      tabs: ReadonlyArray<string>,
    ): void => {
      if (!panel) return;
      const body = panel.querySelector('[data-role="panel-body"]') as HTMLElement | null;
      if (!body) return;
      body.textContent = '';
      for (const tab of tabs) {
        const slot = document.createElement('div');
        slot.setAttribute('data-tab', tab);
        body.appendChild(slot);
        this._tabSlots.set(`${panelId}:${tab}`, slot);
      }
    };
    wireSlots(this._leftPanel, 'left', ['palette', 'templates', 'outline']);
    wireSlots(this._rightPanel, 'right', ['settings']);
    wireSlots(this._bottomPanel, 'bottom', ['issues', 'history', 'preview-device']);
  }

  private async _mountCanvas(): Promise<void> {
    if (!this._canvasStage || !this._controller) return;
    // Only wipe the dedicated stage — the canvas-edge "open panel" buttons
    // are siblings inside the canvas and must survive a remount.
    this._canvasStage.textContent = '';

    const mode = this._controller.getSnapshot().mode;
    if (mode === 'preview') {
      this._mountPreview();
      return;
    }

    const page = document.createElement('content-page') as ContentPageElement;
    page.pageId = this.pageId;
    page.pageStore = this._controller.wrappedStore;
    if (this.layoutRegistry) page.layoutRegistry = this.layoutRegistry;
    if (this.templateRegistry) page.templateRegistry = this.templateRegistry;
    page.principal = this.principal;
    page.tenantId = this.tenantId;
    page.correlationId = this.correlationId;
    page.capabilities = this.capabilities ?? {};
    page.edit = true;
    page.onMediatorTrace = (evt) => this.onLog?.('mediator', evt);
    page.onCapabilityTrace = (evt) => this.onLog?.('capability', evt);
    this._canvasStage.appendChild(page);
    this._canvasPage = page;
    // The content-page mounts asynchronously; poll a few microtasks for its
    // editor handle to appear, then hand it to the controller.
    await this._waitForEditor();
    this._controller.setEditor(this._canvasPage?.editor ?? null);
  }

  /**
   * Mount the dedicated preview surface (Burst C-3) into the canvas-stage.
   * Preview owns its own internal `<content-page edit=false>` and applies
   * device frame chrome around it.
   */
  private _mountPreview(): void {
    if (!this._canvasStage || !this._controller) return;
    const preview = document.createElement('page-editor-preview') as HTMLElement & {
      controller: PageEditorController | null;
      pageId: string;
      templateRegistry?: unknown;
      layoutRegistry?: unknown;
      principal?: unknown;
      tenantId?: string;
      correlationId?: string;
      capabilities?: Record<string, (a: unknown) => Promise<unknown>>;
    };
    preview.pageId = this.pageId;
    if (this.templateRegistry) preview.templateRegistry = this.templateRegistry;
    if (this.layoutRegistry) preview.layoutRegistry = this.layoutRegistry;
    preview.principal = this.principal;
    preview.tenantId = this.tenantId;
    preview.correlationId = this.correlationId;
    preview.capabilities = this.capabilities ?? {};
    preview.controller = this._controller;
    this._canvasStage.appendChild(preview);
    // Editing handle goes away in preview; surface tests assert against
    // the preview surface's own test-state key.
    this._canvasPage = null;
    this._controller.setEditor(null);
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
      // Mode change can flip which left-panel tab is meaningful (palette vs
      // templates); reflect this on the panel host so its (future) tab strip
      // shows the right active state.
      this._leftPanel?.setTabs(leftPanelTabsForMode(snap.mode));
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

    if (!prev || panelsChanged(prev.panels, snap.panels)) {
      this._reflectPanels(snap.panels);
    }
    this._renderTabContent(snap, prev);

    if (!prev || panelsChanged(prev.panels, snap.panels) || prev.mode !== snap.mode) {
      this._reflectPanelEdgeButtons(snap);
    }
  }

  /** Drive `data-*` attributes + CSS variables for size + open state. */
  private _reflectPanels(panels: PanelsState): void {
    this.setAttribute('data-left-open', String(panels.left.open));
    this.setAttribute('data-right-open', String(panels.right.open));
    this.setAttribute('data-bottom-open', String(panels.bottom.open));
    this.style.setProperty('--atlas-pe-left-w', `${panels.left.size}px`);
    this.style.setProperty('--atlas-pe-right-w', `${panels.right.size}px`);
    this.style.setProperty('--atlas-pe-bottom-h', `${panels.bottom.size}px`);
    this._leftPanel?.setOpen(panels.left.open);
    this._leftPanel?.setActiveTab(panels.left.tab);
    this._rightPanel?.setOpen(panels.right.open);
    this._rightPanel?.setActiveTab(panels.right.tab);
    this._bottomPanel?.setOpen(panels.bottom.open);
    this._bottomPanel?.setActiveTab(panels.bottom.tab);
  }

  /** Show the floating canvas-edge "open" button for any closed panel. */
  private _reflectPanelEdgeButtons(snap: PageEditorStateSnapshot): void {
    const root = this.shadowRoot;
    if (!root) return;
    const setVisible = (edge: 'left' | 'right' | 'bottom', visible: boolean): void => {
      const box = root.querySelector(
        `atlas-box[data-role="canvas-edge"][data-edge="${edge}"]`,
      ) as HTMLElement | null;
      if (!box) return;
      // Hide the open-buttons entirely in preview mode, otherwise show
      // exactly when the matching panel is closed.
      const show = snap.mode !== 'preview' && visible;
      box.style.display = show ? '' : 'none';
    };
    setVisible('left', !snap.panels.left.open);
    setVisible('right', !snap.panels.right.open);
    setVisible('bottom', !snap.panels.bottom.open);
  }

  private async _reflectModeOnCanvas(mode: EditorMode): Promise<void> {
    // Crossing the preview boundary swaps the canvas-stage between
    // `<content-page>` (editing) and `<page-editor-preview>` (read-only +
    // device frame). Other mode changes just toggle `edit` on the live
    // content-page.
    const isPreview = mode === 'preview';
    const stageHasPreview = !!this._canvasStage?.querySelector('page-editor-preview');
    const stageHasContent = !!this._canvasPage;
    if (isPreview !== stageHasPreview || (!isPreview && !stageHasContent)) {
      await this._mountCanvas();
      return;
    }
    if (!this._canvasPage) return;
    const wantsEdit = !isPreview;
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

  /**
   * Populate the panel slot containers based on the current snapshot.
   *
   * Stage-2 keeps the three content blocks (palette / settings / templates)
   * intact but re-routes them: palette → left panel `palette` tab, templates →
   * left panel `templates` tab, settings → right panel `settings` tab. The
   * bottom panel ships an empty placeholder until S5/S6.
   *
   * `name` attributes on the wrapping atlas-stack elements are preserved
   * (`add-widget-tab-content`, `settings-tab-content`, `templates-tab-content`)
   * so test ids remain stable through the rename from `*-drawer-content`.
   */
  private _renderTabContent(
    snap: PageEditorStateSnapshot,
    prev: PageEditorStateSnapshot | null,
  ): void {
    if (snap.mode === 'preview') return;

    // ---- left panel: palette + outline (Burst C-1) ----
    const paletteSlot = this._tabSlots.get('left:palette');
    if (paletteSlot && paletteSlot.childElementCount === 0 && this._controller) {
      const palette = document.createElement('page-editor-palette') as HTMLElement & {
        controller: PageEditorController | null;
      };
      palette.controller = this._controller;
      paletteSlot.appendChild(palette);
    }
    const outlineSlot = this._tabSlots.get('left:outline');
    if (outlineSlot && outlineSlot.childElementCount === 0 && this._controller) {
      const outline = document.createElement('page-editor-outline') as HTMLElement & {
        controller: PageEditorController | null;
      };
      outline.controller = this._controller;
      outlineSlot.appendChild(outline);
    }

    // ---- left panel: templates tab (still rendered inline; the templates
    // select is small and template-driven, no benefit to extracting). ----
    const templatesSlot = this._tabSlots.get('left:templates');
    if (
      templatesSlot &&
      (templatesSlot.childElementCount === 0 || prev?.layoutTemplateId !== snap.layoutTemplateId)
    ) {
      templatesSlot.textContent = '';
      templatesSlot.appendChild(this._buildTemplatesContent(snap));
    }

    // ---- right panel: inspector (Burst C-2) ----
    // The inspector subscribes to the controller and handles single/multi/
    // empty modes itself. Mount once; never tear down on snapshot ticks.
    const settingsSlot = this._tabSlots.get('right:settings');
    if (settingsSlot && settingsSlot.childElementCount === 0 && this._controller) {
      const inspector = document.createElement('page-editor-inspector') as HTMLElement & {
        controller: PageEditorController | null;
      };
      inspector.controller = this._controller;
      settingsSlot.appendChild(inspector);
    }

    // ---- bottom panel: placeholder for S5/S6 ----
    const issuesSlot = this._tabSlots.get('bottom:issues');
    if (issuesSlot && issuesSlot.childElementCount === 0) {
      issuesSlot.appendChild(this._buildBottomPlaceholderContent());
    }
  }

  private _buildTemplatesContent(snap: PageEditorStateSnapshot): HTMLElement {
    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'sm');
    wrap.setAttribute('name', 'templates-tab-content');

    const heading = document.createElement('atlas-heading');
    heading.setAttribute('level', '4');
    heading.textContent = 'Template';
    wrap.appendChild(heading);

    const sub = document.createElement('atlas-text');
    sub.setAttribute('variant', 'muted');
    sub.textContent =
      'Select a template for this page. Widgets in regions that no longer exist will be removed.';
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

  private _buildPaletteContent(snap: PageEditorStateSnapshot): HTMLElement {
    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'sm');
    wrap.setAttribute('name', 'add-widget-tab-content');

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

  private _buildSettingsContent(instanceId: string): HTMLElement {
    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'sm');
    wrap.setAttribute('name', 'settings-tab-content');

    const panel = document.createElement('page-editor-property-panel') as
      PageEditorPropertyPanel & HTMLElement;
    panel.setAttribute('name', 'property-panel');
    panel.onChange = (cfg) => void this._controller?.updateWidgetConfig(instanceId, cfg);
    wrap.appendChild(panel);
    this._propertyPanel = panel;

    queueMicrotask(() => this._populatePanel(instanceId));
    return wrap;
  }

  private _buildSettingsEmptyContent(): HTMLElement {
    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'sm');
    wrap.setAttribute('name', 'settings-empty-content');
    const text = document.createElement('atlas-text');
    text.setAttribute('variant', 'muted');
    text.textContent = 'Select a widget on the canvas to edit its properties.';
    wrap.appendChild(text);
    return wrap;
  }

  private _buildBottomPlaceholderContent(): HTMLElement {
    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'sm');
    wrap.setAttribute('name', 'issues-tab-content');
    const text = document.createElement('atlas-text');
    text.setAttribute('variant', 'muted');
    text.textContent = 'Page issues and validation messages will appear here.';
    wrap.appendChild(text);
    return wrap;
  }

  // ---- panel event handlers (S2) ---------------------------------

  private _handlePanelToggle(ev: CustomEvent<PanelToggleEventDetail>): void {
    const detail = ev.detail;
    if (!detail || !this._controller) return;
    this._controller.togglePanel(detail.panel, detail.open);
  }

  private _handlePanelTab(ev: CustomEvent<PanelTabEventDetail>): void {
    const detail = ev.detail;
    if (!detail || !this._controller) return;
    this._controller.setPanelTab(detail.panel, detail.tab as LeftPanelTab);
  }

  private _handlePanelResize(ev: CustomEvent<PanelResizeEventDetail>): void {
    const detail = ev.detail;
    if (!detail || !this._controller) return;
    const snap = this._controller.getSnapshot();
    if (detail.phase === 'start') {
      this._resizeOriginSize[detail.panel] = snap.panels[detail.panel].size;
      return;
    }
    const origin = this._resizeOriginSize[detail.panel] ?? snap.panels[detail.panel].size;
    const next = origin + detail.dx;
    this._controller.resizePanel(detail.panel, next);
    if (detail.phase === 'end') {
      const updated = this._controller.getSnapshot().panels[detail.panel].size;
      savePanelSize(detail.panel, updated);
      delete this._resizeOriginSize[detail.panel];
    }
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
      const ok = await confirmTemplateSwitch({
        displayName: nextManifest.displayName ?? nextTemplateId,
        dropCount: dropped.length,
      });
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

/**
 * Replaces the previous `window.confirm()` call in `_switchTemplate` (C13.7).
 * Builds a transient `<atlas-dialog>`, attaches it to `document.body`,
 * resolves with `true` on Confirm and `false` on Cancel / Esc / backdrop.
 */
async function confirmTemplateSwitch(args: {
  displayName: string;
  dropCount: number;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('atlas-dialog') as HTMLElement & {
      open: () => void;
      close: (returnValue?: string) => void;
    };
    dialog.setAttribute('heading', 'Switch template?');
    dialog.setAttribute('size', 'sm');

    const body = document.createElement('atlas-text');
    body.textContent =
      `Switching to "${args.displayName}" will remove ${args.dropCount} widget(s) ` +
      `from regions that don't exist in the new template. Continue?`;
    dialog.appendChild(body);

    const actions = document.createElement('atlas-box');
    actions.setAttribute('slot', 'actions');

    const cancelBtn = document.createElement('atlas-button');
    cancelBtn.setAttribute('name', 'template-switch-cancel');
    cancelBtn.setAttribute('variant', 'ghost');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => dialog.close('cancel'));

    const confirmBtn = document.createElement('atlas-button');
    confirmBtn.setAttribute('name', 'template-switch-confirm');
    confirmBtn.setAttribute('variant', 'primary');
    confirmBtn.textContent = 'Switch template';
    confirmBtn.addEventListener('click', () => dialog.close('confirm'));

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);

    let settled = false;
    dialog.addEventListener('close', (ev) => {
      if (settled) return;
      settled = true;
      const returnValue = (ev as CustomEvent<{ returnValue: string }>).detail?.returnValue;
      dialog.remove();
      resolve(returnValue === 'confirm');
    });

    document.body.appendChild(dialog);
    dialog.open();
  });
}

function panelsChanged(a: PanelsState, b: PanelsState): boolean {
  return (
    a.left.open !== b.left.open ||
    a.left.tab !== b.left.tab ||
    a.left.size !== b.left.size ||
    a.right.open !== b.right.open ||
    a.right.tab !== b.right.tab ||
    a.right.size !== b.right.size ||
    a.bottom.open !== b.bottom.open ||
    a.bottom.tab !== b.bottom.tab ||
    a.bottom.size !== b.bottom.size
  );
}

function leftPanelTabsForMode(mode: EditorMode): Array<{ id: string; label: string }> {
  if (mode === 'structure') return [{ id: 'templates', label: 'Templates' }];
  return [
    { id: 'palette', label: 'Palette' },
    { id: 'outline', label: 'Outline' },
  ];
}

function toggleDisabled(el: HTMLElement, disabled: boolean): void {
  if (disabled) el.setAttribute('disabled', '');
  else el.removeAttribute('disabled');
}

AtlasElement.define('authoring-page-editor-shell', AuthoringPageEditorShellElement);
