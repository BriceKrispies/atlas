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
 */
import type { PageDocument, PageStore, WidgetInstance } from '@atlas/page-templates';
import { HistoryStack, wrapStoreWithHistory, type WrappedPageStore } from './history.ts';

export type EditorMode = 'structure' | 'content' | 'preview';

export type DrawerState =
  | { kind: 'closed' }
  | { kind: 'palette' }
  | { kind: 'settings'; widgetInstanceId: string };

export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

export interface Region {
  name: string;
  widgetIds: string[];
}

export interface PageEditorStateSnapshot {
  pageId: string;
  pageDocument: PageDocument | null;
  layoutTemplateId: string;
  regions: ReadonlyArray<Region>;
  widgetInstances: ReadonlyArray<WidgetInstance>;
  selectedWidgetInstanceId: string | null;
  selectedWidgetInstanceIds: ReadonlyArray<string>;
  mode: EditorMode;
  drawer: DrawerState;
  status: SaveStatus;
  history: { canUndo: boolean; canRedo: boolean };
}

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
 * PageEditorController — owns PageEditorState and exposes intents.
 *
 * Document mutations are delegated to the host's EditorAPI via setter
 * injection (`setEditor`); this keeps the controller decoupled from the
 * `<content-page>` element so tests can drive it without a DOM.
 */
export class PageEditorController {
  readonly pageId: string;
  private _store: PageStore;
  private _wrapped: WrappedPageStore;
  private _history: HistoryStack;
  private _doc: PageDocument | null;
  private _mode: EditorMode;
  private _drawer: DrawerState = { kind: 'closed' };
  private _status: SaveStatus = 'saved';
  private _selection: Set<string> = new Set();
  private _listeners: Set<Listener> = new Set();
  private _editor: import('@atlas/page-templates').EditorAPI | null = null;
  private _unsubscribe: (() => void) | null = null;

  constructor(opts: PageEditorControllerOptions) {
    this.pageId = opts.pageId;
    this._store = opts.pageStore;
    this._doc = opts.initialDoc;
    this._mode = opts.initialMode ?? 'content';
    if (this._mode === 'content') {
      this._drawer = { kind: 'palette' };
    }
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
    return {
      pageId: this.pageId,
      pageDocument: this._doc,
      layoutTemplateId: (this._doc?.templateId as string | undefined) ?? '',
      regions: deriveRegions(this._doc),
      widgetInstances: deriveInstances(this._doc),
      selectedWidgetInstanceId: ids.length === 1 ? (ids[0] ?? null) : null,
      selectedWidgetInstanceIds: ids,
      mode: this._mode,
      drawer: this._drawer,
      status: this._status,
      history: { canUndo: this._history.canUndo, canRedo: this._history.canRedo },
    };
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

  /** Replace the in-memory document (e.g. after canvas reload). */
  setDocument(doc: PageDocument | null): void {
    this._doc = doc;
    this._emit();
  }

  setMode(mode: EditorMode): void {
    if (this._mode === mode) return;
    this._mode = mode;
    if (mode === 'preview') {
      this._drawer = { kind: 'closed' };
    } else if (mode === 'content') {
      const ids = [...this._selection];
      const single = ids.length === 1 ? ids[0] : null;
      this._drawer = single
        ? { kind: 'settings', widgetInstanceId: single }
        : { kind: 'palette' };
    } else {
      // structure mode: drawer hosts template/slot settings. We reuse the
      // 'palette' drawer kind for "open with structural content"; the shell
      // chooses what to render based on mode.
      this._drawer = { kind: 'palette' };
    }
    this._emit();
  }

  selectWidget(instanceId: string | null, opts?: { additive?: boolean }): void {
    if (instanceId == null) {
      if (this._selection.size === 0) return;
      this._selection = new Set();
      if (this._mode === 'content') this._drawer = { kind: 'palette' };
      this._emit();
      return;
    }
    if (opts?.additive) {
      const next = new Set(this._selection);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      this._selection = next;
    } else {
      this._selection = new Set([instanceId]);
    }
    if (this._mode === 'content') {
      const ids = [...this._selection];
      if (ids.length === 1 && ids[0]) {
        this._drawer = { kind: 'settings', widgetInstanceId: ids[0] };
      } else {
        this._drawer = { kind: 'palette' };
      }
    }
    this._emit();
  }

  openPalette(): void {
    if (this._mode !== 'content') return;
    this._drawer = { kind: 'palette' };
    this._emit();
  }

  openSettings(instanceId: string): void {
    if (this._mode !== 'content') return;
    this._selection = new Set([instanceId]);
    this._drawer = { kind: 'settings', widgetInstanceId: instanceId };
    this._emit();
  }

  closeDrawer(): void {
    this._drawer = { kind: 'closed' };
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
        this._setStatus('saved');
        if (this._mode === 'content') this._drawer = { kind: 'palette' };
        this._emit();
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
    let removed = 0;
    this._setStatus('saving');
    for (const id of ids) {
      try {
        const res = await this._editor.remove({ instanceId: id });
        if (res.ok) removed++;
      } catch {
        /* counted as failure */
      }
    }
    this._selection = new Set();
    this._setStatus(removed > 0 ? 'saved' : 'error');
    if (this._mode === 'content') this._drawer = { kind: 'palette' };
    this._emit();
    return { removed, attempted: ids.length };
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
    this._setStatus('saving');
    try {
      await this._wrapped.save(this.pageId, nextDoc);
      this._selection = new Set();
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
    this._setStatus('saved');
  }

  /** Reset the history seed when the canvas is fully remounted. */
  resetHistory(initialDoc: PageDocument | null): void {
    this._history.clear(initialDoc);
    this._doc = initialDoc;
    this._emit();
  }

  // ---- internals ----

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
