/**
 * <sandbox-page-editor> — the shell that hosts a full-featured page editor
 * inside the sandbox. See `specs/frontend/surfaces/sandbox-page-editor.md`
 * for the contract. Phase A lays down the structural skeleton:
 *
 *   toolbar (undo, redo, template switcher stub, save status, preview toggle)
 *   canvas  (content-page edit=true — drives EditorAPI + palette)
 *   inspector (property panel — schema-driven in Phase C)
 *   preview (view-mode content-page, mirror of canvas pageId — Phase F)
 *
 * Later phases add behaviour behind the stubbed toolbar controls:
 *   - Phase C: inspector content + editor.update wiring
 *   - Phase D: history stack + undo/redo buttons
 *   - Phase E: multi-select + bulk delete
 *   - Phase F: live-reactive preview pane
 *   - Phase G: template switcher dropdown + diff/confirm flow
 */

import { AtlasElement, AtlasSurface } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';
import { adoptAtlasWidgetStyles } from '@atlas/widgets/shared-styles';
import templatesCssText from '@atlas/bundle-standard/templates/templates.css?inline';
import './property-panel.js';
import { editorWidgetSchemas } from './editor-widgets/index.js';
import { HistoryStack, wrapStoreWithHistory } from './history.js';
import { moduleDefaultTemplateRegistry } from '@atlas/page-templates';

const styles = `
  :host {
    display: grid;
    grid-template-columns: 1fr 320px;
    grid-template-rows: 48px 1fr;
    grid-template-areas:
      "toolbar   toolbar"
      "canvas    inspector";
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

  :host([preview-open]) {
    grid-template-columns: 1fr 320px minmax(280px, 1fr);
    grid-template-areas:
      "toolbar   toolbar   toolbar"
      "canvas    inspector preview";
  }

  atlas-box[data-role="toolbar"] {
    grid-area: toolbar;
    display: flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    padding: 0 var(--atlas-space-md);
    background: var(--atlas-color-surface);
    border-bottom: 1px solid var(--atlas-color-border);
    min-height: 48px;
  }
  atlas-box[data-role="toolbar"] atlas-box[data-role="spacer"] {
    flex: 1;
  }

  atlas-box[data-role="canvas"] {
    grid-area: canvas;
    overflow: auto;
    padding: var(--atlas-space-md);
    min-width: 0;
    background: var(--atlas-color-bg);
  }

  atlas-box[data-role="inspector"] {
    grid-area: inspector;
    overflow: auto;
    padding: var(--atlas-space-md);
    border-left: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-surface);
  }

  atlas-box[data-role="preview"] {
    grid-area: preview;
    overflow: auto;
    padding: var(--atlas-space-md);
    border-left: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-bg);
  }
  :host(:not([preview-open])) atlas-box[data-role="preview"] {
    display: none;
  }

  /* Multi-select visual: an additional outline that co-exists with
     edit-mount's single-selection outline. Dashed to distinguish the two. */
  atlas-box[data-role="canvas"] [data-widget-cell][data-multi-selected="true"] {
    outline: 2px dashed var(--atlas-color-primary);
    outline-offset: 4px;
  }
`;

export class SandboxPageEditorElement extends AtlasSurface {
  static surfaceId = 'sandbox.page-editor';

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this.shadowRoot);
    adoptAtlasWidgetStyles(this.shadowRoot);

    /** @type {string} */
    this.pageId = '';
    /** @type {import('@atlas/page-templates').PageStore | null} */
    this.pageStore = null;
    /** @type {object | null} */
    this.layoutRegistry = null;
    /** @type {object | null} */
    this.templateRegistry = null;
    /** @type {object | null} */
    this.principal = null;
    /** @type {string} */
    this.tenantId = '';
    /** @type {string} */
    this.correlationId = '';
    /** @type {Record<string, Function>} */
    this.capabilities = {};
    /** @type {(kind: string, payload: unknown) => void} */
    this.onLog = () => {};

    /** @type {HTMLElement | null} */
    this._canvasPage = null;
    /** @type {HTMLElement | null} */
    this._previewPage = null;
    /** @type {boolean} */
    this._previewOpen = false;
    /** @type {Set<string>} */
    this._selectedInstanceIds = new Set();
    /** @type {HTMLElement | null} */
    this._inspectorEl = null;
    /** @type {HTMLElement | null} */
    this._canvasHost = null;
    /** @type {(e: Event) => void} */
    this._onCanvasClick = (e) => this._handleCanvasClick(e);
    /** @type {(e: KeyboardEvent) => void} */
    this._onKeyDown = (e) => this._handleKeyDown(e);
    /** @type {HistoryStack | null} */
    this._history = null;
    /** @type {object | null} */
    this._wrappedStore = null;
    /** @type {(() => void) | null} */
    this._previewUnsubscribe = null;
  }

  connectedCallback() {
    super.connectedCallback?.();
    this._applyTestId?.();
    // Defer one microtask so properties set by the mount helper just before
    // insertion (pageId, pageStore, etc.) are populated before we render.
    queueMicrotask(() => this._render());
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._canvasHost?.removeEventListener('click', this._onCanvasClick, true);
    document.removeEventListener('keydown', this._onKeyDown);
    this._previewUnsubscribe?.();
    this._previewUnsubscribe = null;
    this._canvasPage = null;
    this._previewPage = null;
    this._canvasHost = null;
    this._inspectorEl = null;
    this._history = null;
    this._wrappedStore = null;
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>${styles}\n${templatesCssText}</style>
      <atlas-box data-role="toolbar" name="toolbar">
        <atlas-button name="undo" variant="ghost" size="sm" aria-label="Undo">Undo</atlas-button>
        <atlas-button name="redo" variant="ghost" size="sm" aria-label="Redo">Redo</atlas-button>
        <atlas-text variant="muted" name="save-status">saved</atlas-text>
        <atlas-box data-role="spacer"></atlas-box>
        <atlas-text variant="small" name="template-label">Template:</atlas-text>
        <atlas-stack direction="row" gap="xs" name="template-switcher"></atlas-stack>
        <atlas-button name="toggle-preview" variant="ghost" size="sm" aria-label="Toggle live preview">Preview</atlas-button>
      </atlas-box>
      <atlas-box data-role="canvas" name="canvas" tabindex="-1"></atlas-box>
      <atlas-box data-role="inspector" name="inspector">
        <page-editor-property-panel name="property-panel"></page-editor-property-panel>
      </atlas-box>
      <atlas-box data-role="preview" name="preview"></atlas-box>
    `;

    const previewBtn = this.shadowRoot.querySelector('atlas-button[name="toggle-preview"]');
    previewBtn?.addEventListener('click', () => this._togglePreview());

    const undoBtn = this.shadowRoot.querySelector('atlas-button[name="undo"]');
    const redoBtn = this.shadowRoot.querySelector('atlas-button[name="redo"]');
    undoBtn?.addEventListener('click', () => this._undo());
    redoBtn?.addEventListener('click', () => this._redo());

    document.addEventListener('keydown', this._onKeyDown);

    this._inspectorEl = this.shadowRoot.querySelector('page-editor-property-panel');
    if (this._inspectorEl) {
      this._inspectorEl.onChange = (nextConfig) => this._commitConfig(nextConfig);
    }

    this._canvasHost = this.shadowRoot.querySelector('atlas-box[data-role="canvas"]');
    // Capture phase: edit-mount's cell click handlers call
    // `stopPropagation()` to keep their internal selection self-contained.
    // Listening in capture means the shell sees the click before edit-mount
    // swallows the bubble, so the inspector + multi-select state stay in
    // sync with user intent without having to change edit-mount semantics.
    this._canvasHost?.addEventListener('click', this._onCanvasClick, true);

    this._mountCanvas().then(() => this._renderTemplateSwitcher());

    this.onLog?.('editor-mount', { pageId: this.pageId });
  }

  _handleCanvasClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const cell = target.closest('[data-widget-cell]');
    if (!cell) {
      if (this._selectedInstanceIds.size > 0) {
        this._setSelection(new Set());
      }
      return;
    }
    const instanceId = cell.getAttribute('data-instance-id');
    if (!instanceId) return;

    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    const next = new Set(additive ? this._selectedInstanceIds : []);
    if (additive && next.has(instanceId)) {
      next.delete(instanceId);
    } else {
      next.add(instanceId);
    }
    this._setSelection(next);
  }

  _setSelection(nextSet) {
    // Clear previous multi-select marks.
    for (const id of this._selectedInstanceIds) {
      const cell = this._canvasHost?.querySelector(
        `[data-widget-cell][data-instance-id="${CSS.escape(id)}"]`,
      );
      cell?.removeAttribute('data-multi-selected');
    }
    this._selectedInstanceIds = nextSet;
    if (nextSet.size > 1) {
      // Mark all selected cells.
      for (const id of nextSet) {
        const cell = this._canvasHost?.querySelector(
          `[data-widget-cell][data-instance-id="${CSS.escape(id)}"]`,
        );
        cell?.setAttribute('data-multi-selected', 'true');
      }
    }
    // Sync inspector:
    if (nextSet.size === 1) {
      const [only] = nextSet;
      this._populateInspector(only);
    } else if (nextSet.size > 1) {
      this._inspectorEl?.clear();
      this._showMultiSelectInspector(nextSet.size);
    } else {
      this._inspectorEl?.clear();
    }
    this.onLog?.('selection-changed', { count: nextSet.size });
  }

  _showMultiSelectInspector(count) {
    // Replace the inspector body with a simple multi-select notice. The
    // existing property-panel element is left in place but cleared — we
    // append a sibling notice.
    const inspector = this.shadowRoot?.querySelector('atlas-box[data-role="inspector"]');
    if (!inspector) return;
    const existingNotice = inspector.querySelector('[data-role="multi-select-notice"]');
    existingNotice?.remove();
    const notice = document.createElement('atlas-stack');
    notice.setAttribute('gap', 'sm');
    notice.setAttribute('data-role', 'multi-select-notice');

    const heading = document.createElement('atlas-heading');
    heading.setAttribute('level', '4');
    heading.textContent = `${count} widgets selected`;
    notice.appendChild(heading);

    const msg = document.createElement('atlas-text');
    msg.setAttribute('variant', 'muted');
    msg.textContent = 'Press Delete or Backspace to remove all. Shift- or cmd-click to adjust selection.';
    notice.appendChild(msg);

    inspector.appendChild(notice);
  }

  _populateInspector(instanceId) {
    // Clear any lingering multi-select notice before populating the
    // schema-driven property panel.
    const inspector = this.shadowRoot?.querySelector('atlas-box[data-role="inspector"]');
    inspector?.querySelector('[data-role="multi-select-notice"]')?.remove();
    if (!this._inspectorEl) return;
    const editor = this._canvasPage?.editor;
    if (!editor) return;
    const entry = editor.get(instanceId);
    if (!entry) {
      this._inspectorEl.clear();
      return;
    }
    const schema = editorWidgetSchemas[entry.widgetId];
    if (!schema) {
      this._inspectorEl.clear();
      this.onLog?.('inspector-no-schema', { widgetId: entry.widgetId });
      return;
    }
    this._inspectorEl.configure({
      widgetId: entry.widgetId,
      instanceId: entry.instanceId,
      config: entry.config,
      schema,
    });
  }

  async _commitConfig(nextConfig) {
    const editor = this._canvasPage?.editor;
    if (!editor) return;
    // Config edits only make sense for a single selection. Multi-select
    // suppresses the inspector's property panel, so this is defensive.
    if (this._selectedInstanceIds.size !== 1) return;
    const [instanceId] = this._selectedInstanceIds;
    this._setSaveStatus('saving');
    try {
      const res = await editor.update({ instanceId, config: nextConfig });
      if (res?.ok === false) {
        this._inspectorEl?.setError(res.reason ?? 'invalid-config');
        this.onLog?.('editor-update-rejected', { reason: res.reason });
        this._setSaveStatus('error');
        return;
      }
      this._inspectorEl?.setError(null);
      this._setSaveStatus('saved');
      this.onLog?.('editor-update', { instanceId });
      // Re-populate after remount to pick up any normalizations the editor applied.
      queueMicrotask(() => {
        if (this._selectedInstanceIds.has(instanceId)) this._populateInspector(instanceId);
      });
    } catch (err) {
      this._inspectorEl?.setError(err?.message ?? 'persist-failed');
      this._setSaveStatus('error');
    }
  }

  async _deleteSelected() {
    const editor = this._canvasPage?.editor;
    if (!editor || this._selectedInstanceIds.size === 0) return;
    const ids = [...this._selectedInstanceIds];
    this._setSaveStatus('saving');
    let removed = 0;
    for (const instanceId of ids) {
      try {
        const res = await editor.remove({ instanceId });
        if (res?.ok !== false) removed++;
        else this.onLog?.('editor-remove-rejected', { instanceId, reason: res.reason });
      } catch (err) {
        this.onLog?.('editor-remove-error', { instanceId, message: err?.message });
      }
    }
    this._setSelection(new Set());
    this._setSaveStatus(removed > 0 ? 'saved' : 'error');
    this.onLog?.('bulk-delete', { attempted: ids.length, removed });
  }

  _setSaveStatus(kind) {
    const el = this.shadowRoot?.querySelector('atlas-text[name="save-status"]');
    if (!el) return;
    el.textContent = kind;
  }

  async _mountCanvas() {
    const host = this.shadowRoot.querySelector('atlas-box[data-role="canvas"]');
    if (!host) return;
    host.textContent = '';

    // Seed the history stack with the pristine doc BEFORE any edits.
    const initialDoc = await this.pageStore.get(this.pageId);
    this._history = new HistoryStack({
      pageId: this.pageId,
      initialDoc,
      onChange: () => this._refreshUndoRedoButtons(),
    });
    this._wrappedStore = wrapStoreWithHistory(this.pageStore, this._history);
    this._refreshUndoRedoButtons();

    const page = document.createElement('content-page');
    page.pageId = this.pageId;
    page.pageStore = this._wrappedStore;
    if (this.layoutRegistry) page.layoutRegistry = this.layoutRegistry;
    if (this.templateRegistry) page.templateRegistry = this.templateRegistry;
    page.principal = this.principal;
    page.tenantId = this.tenantId;
    page.correlationId = this.correlationId;
    page.capabilities = this.capabilities ?? {};
    page.edit = true;
    page.onMediatorTrace = (evt) => this.onLog?.('mediator', evt);
    page.onCapabilityTrace = (evt) => this.onLog?.('capability', evt);
    host.appendChild(page);
    this._canvasPage = page;
  }

  async _undo() {
    if (!this._history || !this._wrappedStore) return;
    const frame = await this._history.undo((doc) =>
      this._wrappedStore.save(this.pageId, doc),
    );
    if (frame) {
      // The canvas content-page holds its own in-memory doc (via its
      // editor controller) and doesn't auto-refresh from the store, so we
      // reload it against the replayed doc.
      await this._canvasPage?.reload?.();
      this.onLog?.('undo', { depth: this._history.depth });
      this._setSaveStatus('saved');
    }
  }

  async _redo() {
    if (!this._history || !this._wrappedStore) return;
    const frame = await this._history.redo((doc) =>
      this._wrappedStore.save(this.pageId, doc),
    );
    if (frame) {
      await this._canvasPage?.reload?.();
      this.onLog?.('redo', { depth: this._history.depth });
      this._setSaveStatus('saved');
    }
  }

  _handleKeyDown(e) {
    // Only react when the editor is mounted AND focus is somewhere inside
    // this shell — avoid hijacking shortcuts when the user is typing
    // elsewhere on the page.
    if (!this._history) return;
    const path = e.composedPath();
    if (!path.includes(this)) return;

    // Don't steal Backspace/Delete from form fields (property-panel inputs).
    const inField = path.some((el) =>
      el instanceof Element &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'),
    );

    const isMeta = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (isMeta && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this._undo();
      return;
    }
    if (isMeta && ((key === 'z' && e.shiftKey) || key === 'y')) {
      e.preventDefault();
      this._redo();
      return;
    }
    if (!inField && (e.key === 'Delete' || e.key === 'Backspace') && this._selectedInstanceIds.size > 0) {
      e.preventDefault();
      this._deleteSelected();
      return;
    }
    if (e.key === 'Escape' && this._selectedInstanceIds.size > 0) {
      this._setSelection(new Set());
    }
  }

  _refreshUndoRedoButtons() {
    const undoBtn = this.shadowRoot?.querySelector('atlas-button[name="undo"]');
    const redoBtn = this.shadowRoot?.querySelector('atlas-button[name="redo"]');
    if (undoBtn) toggleDisabled(undoBtn, !this._history?.canUndo);
    if (redoBtn) toggleDisabled(redoBtn, !this._history?.canRedo);
  }

  async _renderTemplateSwitcher() {
    const container = this.shadowRoot?.querySelector('atlas-stack[name="template-switcher"]');
    if (!container) return;
    const registry = this.templateRegistry ?? moduleDefaultTemplateRegistry;
    const templates = registry.list?.() ?? [];
    // Prefer the live canvas doc, but fall back to the store — the canvas
    // content-page loads its doc asynchronously, so during initial mount
    // `_currentDoc` is null and every chip would render as "ghost". Reading
    // the store directly avoids a frame-dependent primary chip selection.
    const currentId =
      this._canvasPage?._currentDoc?.templateId
      ?? (await this.pageStore?.get?.(this.pageId))?.templateId
      ?? null;
    container.textContent = '';
    for (const t of templates) {
      const btn = document.createElement('atlas-button');
      btn.setAttribute('name', `template-${t.templateId}`);
      btn.setAttribute('variant', t.templateId === currentId ? 'primary' : 'ghost');
      btn.setAttribute('size', 'sm');
      btn.textContent = t.displayName ?? t.templateId;
      btn.addEventListener('click', () => this._switchTemplate(t.templateId));
      container.appendChild(btn);
    }
  }

  async _switchTemplate(nextTemplateId) {
    const editor = this._canvasPage?.editor;
    if (!editor) return;
    const currentDoc = await this.pageStore.get(this.pageId);
    if (!currentDoc) return;
    if (currentDoc.templateId === nextTemplateId) return;
    const registry = this.templateRegistry ?? moduleDefaultTemplateRegistry;
    let nextManifest;
    try {
      nextManifest = registry.get(nextTemplateId).manifest;
    } catch {
      this.onLog?.('template-switch-unknown', { nextTemplateId });
      return;
    }
    const nextRegionNames = new Set(nextManifest.regions.map((r) => r.name));
    // Collect widgets that would be dropped.
    const dropped = [];
    for (const [regionName, entries] of Object.entries(currentDoc.regions ?? {})) {
      if (!nextRegionNames.has(regionName)) {
        for (const e of entries) dropped.push({ instanceId: e.instanceId, widgetId: e.widgetId, region: regionName });
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
    // Build the next doc: keep widgets in regions that still exist; drop the rest.
    const nextRegions = {};
    for (const [regionName, entries] of Object.entries(currentDoc.regions ?? {})) {
      if (nextRegionNames.has(regionName)) nextRegions[regionName] = entries;
    }
    for (const r of nextRegionNames) {
      if (!(r in nextRegions)) nextRegions[r] = [];
    }
    const nextDoc = {
      ...currentDoc,
      templateId: nextTemplateId,
      templateVersion: nextManifest.version,
      regions: nextRegions,
    };
    // Save through the wrapped store so history captures this as a single
    // frame (prev = current doc, next = template-swapped doc).
    this._setSaveStatus('saving');
    try {
      const store = this._wrappedStore ?? this.pageStore;
      await store.save(this.pageId, nextDoc);
      this._setSaveStatus('saved');
      this.onLog?.('template-switched', {
        from: currentDoc.templateId,
        to: nextTemplateId,
        widgetsRemoved: dropped.length,
      });
      // Remount the canvas so content-page picks up the new template.
      this._setSelection(new Set());
      await this._mountCanvas();
      this._renderTemplateSwitcher();
    } catch (err) {
      this._setSaveStatus('error');
      this.onLog?.('template-switch-error', { message: err?.message ?? String(err) });
    }
  }

  _togglePreview() {
    this._previewOpen = !this._previewOpen;
    this.toggleAttribute('preview-open', this._previewOpen);
    const host = this.shadowRoot.querySelector('atlas-box[data-role="preview"]');
    if (!host) return;

    if (this._previewOpen) {
      this._mountPreview(host);
      // Re-mount the preview every time the canvas commits an edit so the
      // view-mode content-page picks up the new document. The wrapper's
      // subscribe() fires after each save (including undo/redo replays).
      if (this._wrappedStore?.subscribe) {
        this._previewUnsubscribe?.();
        this._previewUnsubscribe = this._wrappedStore.subscribe(this.pageId, () => {
          if (this._previewOpen) this._mountPreview(host);
        });
      }
    } else {
      this._previewUnsubscribe?.();
      this._previewUnsubscribe = null;
      host.textContent = '';
      this._previewPage = null;
    }

    this.onLog?.('preview-toggled', { open: this._previewOpen });
  }

  _mountPreview(host) {
    host.textContent = '';
    const page = document.createElement('content-page');
    page.pageId = this.pageId;
    page.pageStore = this._wrappedStore ?? this.pageStore;
    if (this.layoutRegistry) page.layoutRegistry = this.layoutRegistry;
    if (this.templateRegistry) page.templateRegistry = this.templateRegistry;
    page.principal = this.principal;
    page.tenantId = this.tenantId;
    page.correlationId = `${this.correlationId}-preview`;
    page.capabilities = this.capabilities ?? {};
    page.edit = false;
    host.appendChild(page);
    this._previewPage = page;
  }

  /**
   * Expose the underlying content-page element for tests and later phases
   * (undo/redo wiring, multi-select overlay) that need to reach through.
   */
  get canvasContentPage() {
    return this._canvasPage;
  }

  get previewContentPage() {
    return this._previewPage;
  }
}

function toggleDisabled(el, disabled) {
  if (disabled) {
    el.setAttribute('disabled', '');
    el.style.opacity = '0.5';
    el.style.pointerEvents = 'none';
  } else {
    el.removeAttribute('disabled');
    el.style.opacity = '';
    el.style.pointerEvents = '';
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

AtlasElement.define('sandbox-page-editor', SandboxPageEditorElement);
