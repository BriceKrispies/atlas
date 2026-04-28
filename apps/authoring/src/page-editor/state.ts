/**
 * PageEditorState — central state model for the page editor shell.
 *
 * This module owns the shell-level state machine: the active page document,
 * derived region + widget-instance lists, selection, mode, drawer state,
 * save status, and history. It is pure logic (no DOM); the shell subscribes
 * and renders against it.
 *
 * Document-shape mutations (add/remove/update widget, change template) are
 * delegated to the underlying `EditorAPI` exposed by `<content-page>` and
 * persisted through the wrapped page store. The wrapped store's subscribe
 * hook drives `setDocument` so the state always reflects the latest saved
 * doc; history (`HistoryStack`) is wired via the same store wrapper.
 *
 * Every successful shell-level intent records a commit envelope on the
 * snapshot's `lastCommit` field per `specs/frontend/interaction-contracts.md`.
 * The shell registers a reader keyed `editor:<pageId>:shell` against
 * `@atlas/test-state` so Playwright can assert `assertCommitted(...)` rather
 * than scraping DOM. The inner content-page registers its own `editor:<pageId>`
 * key for document-layer intents (add/remove/update); the two surfaces are
 * distinct on purpose.
 */
import type { PageDocument, PageStore, WidgetInstance } from '@atlas/page-templates';
import { makeCommit, type CommitRecord } from '@atlas/test-state';
import { HistoryStack, wrapStoreWithHistory, type WrappedPageStore } from './history.ts';

export type EditorMode = 'structure' | 'content' | 'preview';

export type PanelId = 'left' | 'right' | 'bottom';

/**
 * Tab vocabulary per panel. Tabs are content slots inside a panel; only
 * one is active at a time. Stage-2 wires three tabs in service of the
 * existing palette / settings / templates content; stages 3+ extend each
 * panel with additional tabs (outline on left, issues / history /
 * preview-device on bottom).
 */
export type LeftPanelTab = 'palette' | 'templates' | 'outline';
export type RightPanelTab = 'settings';
export type BottomPanelTab = 'issues' | 'history' | 'preview-device';
export type AnyPanelTab = LeftPanelTab | RightPanelTab | BottomPanelTab;

export interface PanelState<TTab extends string = string> {
  open: boolean;
  /** Active tab id. */
  tab: TTab;
  /** Pixel size: width for left/right, height for bottom. */
  size: number;
}

export interface PanelsState {
  left: PanelState<LeftPanelTab>;
  right: PanelState<RightPanelTab>;
  bottom: PanelState<BottomPanelTab>;
}

/** Bounds enforced by the controller; the shell may also clamp at the DOM layer. */
export const PANEL_SIZE_BOUNDS: Record<PanelId, { min: number; max: number; default: number }> = {
  left:   { min: 200, max: 520, default: 280 },
  right:  { min: 240, max: 560, default: 320 },
  bottom: { min: 100, max: 480, default: 200 },
};

export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

export interface Region {
  name: string;
  widgetIds: string[];
}

export interface PageEditorStateSnapshot {
  surfaceId: string;
  pageId: string;
  pageDocument: PageDocument | null;
  layoutTemplateId: string;
  regions: ReadonlyArray<Region>;
  widgetInstances: ReadonlyArray<WidgetInstance>;
  selectedWidgetInstanceId: string | null;
  selectedWidgetInstanceIds: ReadonlyArray<string>;
  mode: EditorMode;
  panels: PanelsState;
  /**
   * Convenience derivation of which widget instance the right-panel
   * `settings` tab is configured to inspect. Mirrors the previous
   * `drawer.widgetInstanceId` field for callers that just want the
   * single-selection focus without traversing `selectedWidgetInstanceIds`.
   */
  inspectedWidgetInstanceId: string | null;
  device: PreviewDevice;
  status: SaveStatus;
  history: { canUndo: boolean; canRedo: boolean };
  lastCommit: CommitRecord | null;
}

/**
 * Canonical shell-level intent vocabulary. Locking these names lets the
 * surface contract reference them and lets test authors use string literals
 * directly. Stage-2 adds the three panel intents.
 */
export type PageEditorIntent =
  | 'setMode'
  | 'selectWidget'
  | 'openPalette'
  | 'openSettings'
  | 'closeDrawer'
  | 'addWidget'
  | 'removeWidget'
  | 'removeSelected'
  | 'moveWidget'
  | 'updateWidgetConfig'
  | 'setLayoutTemplate'
  | 'undo'
  | 'redo'
  | 'save'
  | 'panelToggle'
  | 'panelResize'
  | 'panelTab'
  | 'deviceChange';

/** Device frames the preview surface (S5) renders against. */
export type PreviewDevice = 'mobile' | 'tablet' | 'desktop';

export interface PageEditorControllerOptions {
  pageId: string;
  pageStore: PageStore;
  initialDoc: PageDocument | null;
  initialMode?: EditorMode;
}

type Listener = (snapshot: PageEditorStateSnapshot) => void;

function deriveRegions(doc: PageDocument | null): Region[] {
  if (!doc?.regions) return [];
  const out: Region[] = [];
  for (const [name, entries] of Object.entries(doc.regions)) {
    out.push({
      name,
      widgetIds: (entries as WidgetInstance[]).map((e) => e.instanceId),
    });
  }
  return out;
}

function deriveInstances(doc: PageDocument | null): WidgetInstance[] {
  if (!doc?.regions) return [];
  const out: WidgetInstance[] = [];
  for (const entries of Object.values(doc.regions)) {
    for (const entry of entries as WidgetInstance[]) out.push(entry);
  }
  return out;
}

/**
 * Build the default panel state for an editor mode. Selection drives whether
 * the right-panel `settings` tab opens; preview hides every panel; structure
 * mode focuses the templates tab on the left.
 *
 * Sizes carry over from the previous panel state if present so user-tuned
 * widths survive mode changes.
 */
function derivePanelsForMode(
  mode: EditorMode,
  prev: PanelsState | null,
  selection: ReadonlySet<string>,
): PanelsState {
  const sizes = {
    left: prev?.left.size ?? PANEL_SIZE_BOUNDS.left.default,
    right: prev?.right.size ?? PANEL_SIZE_BOUNDS.right.default,
    bottom: prev?.bottom.size ?? PANEL_SIZE_BOUNDS.bottom.default,
  };
  const prevBottomTab: BottomPanelTab = prev?.bottom.tab ?? 'issues';
  if (mode === 'preview') {
    return {
      left: { open: false, tab: prev?.left.tab ?? 'palette', size: sizes.left },
      right: { open: false, tab: 'settings', size: sizes.right },
      bottom: { open: false, tab: prevBottomTab, size: sizes.bottom },
    };
  }
  if (mode === 'structure') {
    return {
      left: { open: true, tab: 'templates', size: sizes.left },
      right: { open: false, tab: 'settings', size: sizes.right },
      bottom: { open: false, tab: prevBottomTab, size: sizes.bottom },
    };
  }
  // content mode
  const single = selection.size === 1;
  return {
    left: { open: true, tab: 'palette', size: sizes.left },
    right: { open: single, tab: 'settings', size: sizes.right },
    bottom: { open: false, tab: prevBottomTab, size: sizes.bottom },
  };
}

function clampSize(panel: PanelId, size: number): number {
  const { min, max } = PANEL_SIZE_BOUNDS[panel];
  if (!Number.isFinite(size)) return PANEL_SIZE_BOUNDS[panel].default;
  return Math.max(min, Math.min(max, Math.round(size)));
}

const VALID_TABS: { left: ReadonlySet<string>; right: ReadonlySet<string>; bottom: ReadonlySet<string> } = {
  left: new Set<LeftPanelTab>(['palette', 'templates', 'outline']),
  right: new Set<RightPanelTab>(['settings']),
  bottom: new Set<BottomPanelTab>(['issues', 'history', 'preview-device']),
};

function isValidTabFor(panel: PanelId, tab: string): boolean {
  return VALID_TABS[panel].has(tab);
}

/**
 * PageEditorController — owns PageEditorState and exposes intents.
 *
 * Document mutations are delegated to the host's EditorAPI via setter
 * injection (`setEditor`); this keeps the controller decoupled from the
 * `<content-page>` element so tests can drive it without a DOM.
 */
export interface PageEditorControllerExtraOptions {
  /** Persisted panel sizes (e.g. from localStorage) to seed initial state with. */
  initialPanelSizes?: Partial<Record<PanelId, number>>;
}

export class PageEditorController {
  readonly pageId: string;
  readonly surfaceId: string;
  private _store: PageStore;
  private _wrapped: WrappedPageStore;
  private _history: HistoryStack;
  private _doc: PageDocument | null;
  private _mode: EditorMode;
  private _panels: PanelsState;
  private _device: PreviewDevice = 'desktop';
  private _status: SaveStatus = 'saved';
  private _selection: Set<string> = new Set();
  private _lastCommit: CommitRecord | null = null;
  private _listeners: Set<Listener> = new Set();
  private _editor: import('@atlas/page-templates').EditorAPI | null = null;
  private _unsubscribe: (() => void) | null = null;

  constructor(opts: PageEditorControllerOptions & PageEditorControllerExtraOptions) {
    this.pageId = opts.pageId;
    this.surfaceId = `editor:${opts.pageId}:shell`;
    this._store = opts.pageStore;
    this._doc = opts.initialDoc;
    this._mode = opts.initialMode ?? 'content';
    // Seed panels with sizes from persisted user preference (if provided),
    // then apply the mode-default open/tab logic.
    const seeded: PanelsState = {
      left: {
        open: false,
        tab: 'palette',
        size: clampSize('left', opts.initialPanelSizes?.left ?? PANEL_SIZE_BOUNDS.left.default),
      },
      right: {
        open: false,
        tab: 'settings',
        size: clampSize('right', opts.initialPanelSizes?.right ?? PANEL_SIZE_BOUNDS.right.default),
      },
      bottom: {
        open: false,
        tab: 'issues',
        size: clampSize('bottom', opts.initialPanelSizes?.bottom ?? PANEL_SIZE_BOUNDS.bottom.default),
      },
    };
    this._panels = derivePanelsForMode(this._mode, seeded, this._selection);
    this._history = new HistoryStack({
      pageId: opts.pageId,
      initialDoc: opts.initialDoc,
      onChange: () => this._emit(),
    });
    this._wrapped = wrapStoreWithHistory(opts.pageStore, this._history);
    this._unsubscribe = this._wrapped.subscribe(opts.pageId, (next) => {
      this._doc = next;
      this._emit();
    });
  }

  /** The page store the canvas content-page should use (history-wrapping). */
  get wrappedStore(): WrappedPageStore {
    return this._wrapped;
  }

  /** Inject the canvas EditorAPI once the content-page has mounted. */
  setEditor(editor: import('@atlas/page-templates').EditorAPI | null): void {
    this._editor = editor;
  }

  getSnapshot(): PageEditorStateSnapshot {
    const ids = [...this._selection];
    const single = ids.length === 1 ? (ids[0] ?? null) : null;
    return {
      surfaceId: this.surfaceId,
      pageId: this.pageId,
      pageDocument: this._doc,
      layoutTemplateId: (this._doc?.templateId as string | undefined) ?? '',
      regions: deriveRegions(this._doc),
      widgetInstances: deriveInstances(this._doc),
      selectedWidgetInstanceId: single,
      selectedWidgetInstanceIds: ids,
      mode: this._mode,
      panels: this._panels,
      inspectedWidgetInstanceId: this._panels.right.open ? single : null,
      device: this._device,
      status: this._status,
      history: { canUndo: this._history.canUndo, canRedo: this._history.canRedo },
      lastCommit: this._lastCommit,
    };
  }

  /** Most-recent commit envelope, or null before any commit has landed. */
  get lastCommit(): CommitRecord | null {
    return this._lastCommit;
  }

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  dispose(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._listeners.clear();
  }

  // ---- intents ----
  //
  // Every public intent that user code or tests can trigger MUST record a
  // commit envelope on success (rules from interaction-contracts.md):
  //   - Past-tense fact: commit recorded AFTER state mutation lands.
  //   - Rejected intents do NOT commit.
  //   - The patch shape is the canonical record of what the intent did.

  /** Replace the in-memory document (e.g. after canvas reload). Internal: not a user intent, no commit. */
  setDocument(doc: PageDocument | null): void {
    this._doc = doc;
    this._emit();
  }

  setMode(mode: EditorMode): void {
    if (this._mode === mode) return;
    const previousMode = this._mode;
    this._mode = mode;
    this._panels = derivePanelsForMode(mode, this._panels, this._selection);
    this._recordCommit('setMode', { mode, previousMode });
    this._emit();
  }

  /**
   * Switch the preview device frame. Used by the dedicated `<page-editor-preview>`
   * surface (S5) to render the page at a chosen breakpoint. The shell retains
   * the active device across mode changes so re-entering preview lands on the
   * last-used frame.
   */
  setDevice(device: PreviewDevice): void {
    if (this._device === device) return;
    const previousDevice = this._device;
    this._device = device;
    this._recordCommit('deviceChange', { device, previousDevice });
    this._emit();
  }

  selectWidget(instanceId: string | null, opts?: { additive?: boolean }): void {
    const additive = opts?.additive === true;
    if (instanceId == null) {
      if (this._selection.size === 0) return;
      this._selection = new Set();
      if (this._mode === 'content') {
        this._panels = {
          ...this._panels,
          right: { ...this._panels.right, open: false },
        };
      }
      this._recordCommit('selectWidget', {
        instanceId: null,
        additive,
        selection: [],
      });
      this._emit();
      return;
    }
    if (additive) {
      const next = new Set(this._selection);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      this._selection = next;
    } else {
      this._selection = new Set([instanceId]);
    }
    if (this._mode === 'content') {
      const single = this._selection.size === 1;
      this._panels = {
        ...this._panels,
        right: {
          ...this._panels.right,
          open: single,
          tab: 'settings',
        },
      };
    }
    this._recordCommit('selectWidget', {
      instanceId,
      additive,
      selection: [...this._selection],
    });
    this._emit();
  }

  /**
   * High-level intent: focus the palette tab in the left panel.
   *
   * Maps onto two lower-level intents (panelTab + panelToggle) but is kept
   * as a first-class intent because callers and tests reason about the
   * palette concept, not panel mechanics.
   */
  openPalette(): void {
    if (this._mode === 'preview') return;
    this._panels = {
      ...this._panels,
      left: { ...this._panels.left, open: true, tab: 'palette' },
    };
    this._recordCommit('openPalette', {});
    this._emit();
  }

  /**
   * High-level intent: focus the settings tab in the right panel for a
   * given widget instance, selecting it as a side effect.
   */
  openSettings(instanceId: string): void {
    if (this._mode !== 'content') return;
    this._selection = new Set([instanceId]);
    this._panels = {
      ...this._panels,
      right: { ...this._panels.right, open: true, tab: 'settings' },
    };
    this._recordCommit('openSettings', { instanceId });
    this._emit();
  }

  /**
   * Legacy alias: closes the right panel (which historically was "the drawer").
   * Preserved so existing callers (keyboard Escape, programmatic dismiss)
   * keep working without reaching into panel mechanics.
   */
  closeDrawer(): void {
    if (!this._panels.right.open) return;
    this._panels = {
      ...this._panels,
      right: { ...this._panels.right, open: false },
    };
    this._recordCommit('closeDrawer', {});
    this._emit();
  }

  // ---- panel intents (S2) ------------------------------------------

  /**
   * Toggle a panel open or closed. Pass an explicit `open` to set absolutely;
   * omit it to flip. Records a `panelToggle` commit only if state actually
   * changed (rule: rejected/no-op intents must not commit).
   */
  togglePanel(panel: PanelId, open?: boolean): void {
    const current = this._panels[panel];
    const next = open === undefined ? !current.open : !!open;
    if (current.open === next) return;
    this._panels = { ...this._panels, [panel]: { ...current, open: next } } as PanelsState;
    this._recordCommit('panelToggle', { panel, open: next });
    this._emit();
  }

  /**
   * Resize a panel. The size is clamped to PANEL_SIZE_BOUNDS; if the clamped
   * value matches the current size, the call is a no-op.
   */
  resizePanel(panel: PanelId, size: number): void {
    const clamped = clampSize(panel, size);
    const current = this._panels[panel];
    if (current.size === clamped) return;
    this._panels = { ...this._panels, [panel]: { ...current, size: clamped } } as PanelsState;
    this._recordCommit('panelResize', { panel, size: clamped });
    this._emit();
  }

  /**
   * Switch the active tab in a panel. Validates the tab against the panel's
   * vocabulary; unknown tabs are rejected without committing.
   */
  setPanelTab(panel: PanelId, tab: AnyPanelTab): void {
    if (!isValidTabFor(panel, tab)) return;
    const current = this._panels[panel];
    if (current.tab === tab) return;
    this._panels = {
      ...this._panels,
      [panel]: { ...current, tab },
    } as PanelsState;
    this._recordCommit('panelTab', { panel, tab });
    this._emit();
  }

  async addWidget(args: {
    widgetId: string;
    region: string;
    index?: number;
    config?: Record<string, unknown>;
  }): Promise<{ ok: boolean; reason?: string; instanceId?: string }> {
    if (!this._editor) return { ok: false, reason: 'editor-not-ready' };
    this._setStatus('saving');
    try {
      const res = await this._editor.add(args);
      if (res.ok) {
        const patch: Record<string, unknown> = {
          widgetId: args.widgetId,
          region: args.region,
        };
        if (args.index !== undefined) patch['index'] = args.index;
        if (res.instanceId !== undefined) patch['instanceId'] = res.instanceId;
        this._recordCommit('addWidget', patch);
        this._setStatus('saved');
        return res.instanceId !== undefined
          ? { ok: true, instanceId: res.instanceId }
          : { ok: true };
      }
      this._setStatus('error');
      return { ok: false, reason: res.reason };
    } catch (err) {
      this._setStatus('error');
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async removeWidget(instanceId: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this._editor) return { ok: false, reason: 'editor-not-ready' };
    this._setStatus('saving');
    try {
      const res = await this._editor.remove({ instanceId });
      if (res.ok) {
        this._selection.delete(instanceId);
        if (this._mode === 'content' && this._selection.size === 0) {
          // No selection left — collapse the right (settings) panel.
          this._panels = {
            ...this._panels,
            right: { ...this._panels.right, open: false },
          };
        }
        this._recordCommit('removeWidget', { instanceId });
        this._setStatus('saved');
        // _setStatus already emitted; one emission is enough.
        return { ok: true };
      }
      this._setStatus('error');
      return { ok: false, reason: res.reason };
    } catch (err) {
      this._setStatus('error');
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async removeSelected(): Promise<{ removed: number; attempted: number }> {
    const ids = [...this._selection];
    if (ids.length === 0 || !this._editor) return { removed: 0, attempted: 0 };
    const removedIds: string[] = [];
    this._setStatus('saving');
    for (const id of ids) {
      try {
        const res = await this._editor.remove({ instanceId: id });
        if (res.ok) removedIds.push(id);
      } catch {
        /* counted as failure */
      }
    }
    this._selection = new Set();
    if (this._mode === 'content') {
      this._panels = {
        ...this._panels,
        right: { ...this._panels.right, open: false },
      };
    }
    if (removedIds.length > 0) {
      this._recordCommit('removeSelected', {
        attempted: ids.length,
        removed: removedIds.length,
        instanceIds: removedIds,
      });
    }
    this._setStatus(removedIds.length > 0 ? 'saved' : 'error');
    return { removed: removedIds.length, attempted: ids.length };
  }

  /**
   * Move a widget to a new region (and optionally a new index within that
   * region). Delegates to the inner content-page `EditorAPI.move`. Records
   * a `moveWidget` commit on success; the patch carries `instanceId`,
   * `toRegion`, and (if provided) `toIndex`. The from-region is implicit in
   * the document and not duplicated on the patch.
   */
  async moveWidget(args: {
    instanceId: string;
    toRegion: string;
    toIndex?: number;
  }): Promise<{ ok: boolean; reason?: string }> {
    const editor = this._editor;
    if (!editor) return { ok: false, reason: 'editor-not-ready' };
    if (typeof (editor as { move?: unknown }).move !== 'function') {
      return { ok: false, reason: 'move-not-supported' };
    }
    this._setStatus('saving');
    try {
      // Call through the editor reference so `this` stays bound to the
      // EditorAPI instance (its `move` reads `this._isEditable()`).
      const editorWithMove = editor as unknown as {
        move: (a: { instanceId: string; region: string; index?: number }) => Promise<{ ok: boolean; reason?: string }>;
      };
      const callArgs: { instanceId: string; region: string; index?: number } = {
        instanceId: args.instanceId,
        region: args.toRegion,
      };
      if (args.toIndex !== undefined) callArgs.index = args.toIndex;
      const res = await editorWithMove.move(callArgs);
      if (res.ok) {
        const patch: Record<string, unknown> = {
          instanceId: args.instanceId,
          toRegion: args.toRegion,
        };
        if (args.toIndex !== undefined) patch['toIndex'] = args.toIndex;
        this._recordCommit('moveWidget', patch);
        this._setStatus('saved');
        return { ok: true };
      }
      this._setStatus('error');
      return res.reason !== undefined ? { ok: false, reason: res.reason } : { ok: false };
    } catch (err) {
      this._setStatus('error');
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async updateWidgetConfig(
    instanceId: string,
    config: Record<string, unknown>,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!this._editor) return { ok: false, reason: 'editor-not-ready' };
    this._setStatus('saving');
    try {
      const res = await this._editor.update({ instanceId, config });
      if (res.ok) {
        this._recordCommit('updateWidgetConfig', { instanceId, config });
        this._setStatus('saved');
        return { ok: true };
      }
      this._setStatus('error');
      return { ok: false, reason: res.reason };
    } catch (err) {
      this._setStatus('error');
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Persist a template change directly through the wrapped store so
   * history captures the swap as a single frame. The shell handles the
   * widget-trim confirmation flow.
   */
  async setLayoutTemplate(nextDoc: PageDocument): Promise<{ ok: boolean; reason?: string }> {
    const fromTemplateId = (this._doc?.templateId as string | undefined) ?? '';
    this._setStatus('saving');
    try {
      await this._wrapped.save(this.pageId, nextDoc);
      this._selection = new Set();
      this._recordCommit('setLayoutTemplate', {
        from: fromTemplateId,
        to: (nextDoc.templateId as string | undefined) ?? '',
      });
      this._setStatus('saved');
      return { ok: true };
    } catch (err) {
      this._setStatus('error');
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  async undo(): Promise<boolean> {
    const frame = await this._history.undo((doc) =>
      this._wrapped.save(this.pageId, doc as PageDocument),
    );
    if (frame) {
      this._recordCommit('undo', {});
      this._setStatus('saved');
      return true;
    }
    return false;
  }

  async redo(): Promise<boolean> {
    const frame = await this._history.redo((doc) =>
      this._wrapped.save(this.pageId, doc),
    );
    if (frame) {
      this._recordCommit('redo', {});
      this._setStatus('saved');
      return true;
    }
    return false;
  }

  /**
   * Save is a no-op for the in-memory store (every commit is already
   * persisted), but the intent exists so the UI can show a transient
   * "saved" pulse and so a future networked store can hook in.
   */
  async save(): Promise<void> {
    this._recordCommit('save', {});
    this._setStatus('saved');
  }

  /** Reset the history seed when the canvas is fully remounted. */
  resetHistory(initialDoc: PageDocument | null): void {
    this._history.clear(initialDoc);
    this._doc = initialDoc;
    this._emit();
  }

  // ---- internals ----

  private _recordCommit(intent: PageEditorIntent, patch: Record<string, unknown>): void {
    this._lastCommit = makeCommit(this.surfaceId, intent, patch);
  }

  private _setStatus(next: SaveStatus): void {
    if (this._status === next) return;
    this._status = next;
    this._emit();
  }

  private _emit(): void {
    const snap = this.getSnapshot();
    for (const fn of this._listeners) {
      try {
        fn(snap);
      } catch (err) {
        console.error('[page-editor-state] listener threw', err);
      }
    }
  }

  // expose for tests / shell helpers
  get internalStore(): PageStore {
    return this._store;
  }
}
