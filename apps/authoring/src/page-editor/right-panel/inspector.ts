/**
 * `<page-editor-inspector>` — orchestrates the right-panel settings body.
 *
 * Wraps `<page-editor-property-panel>` (the low-level field renderer) with:
 *   - A header showing the inspected widget id + a kebab menu exposing
 *     Copy / Paste / Reset and a Presets dropdown sourced from the schema's
 *     `x-atlas-presets`.
 *   - Schema-grouped sections with collapsible headers (driven by
 *     `x-atlas-section-order` + `x-atlas-section`).
 *   - A multi-select banner when ≥2 widgets are selected; the property panel
 *     then renders only the **intersection of property keys** across the
 *     selected widgets' schemas, and edits commit `updateWidgetConfig` once
 *     per selected instance.
 *   - An empty-state hint when no widget is inspected.
 *
 * The wrapper continues to render the historical `<atlas-stack name="settings-tab-content">`
 * so the existing shell tests (which assert that name) keep passing.
 *
 * Test-state: registers `editor:<pageId>:inspector` returning
 * `{ surfaceId, widgetId, instanceId, instanceIds, config, openSections,
 *    mode: 'single' | 'multi' | 'empty', selectionSize, clipboardWidgetId,
 *    lastCommit }`.
 *
 * Local intents committed on the inspector surface:
 *   - `toggleSection({ section, open })`
 *   - `applyPreset({ presetId, widgetId })`
 *   - `copyConfig({ widgetId, instanceId })`
 *   - `pasteConfig({ widgetId, instanceId })`
 *   - `resetDefaults({ widgetId, instanceId })`
 *
 * The actual config edit always lands on the shell via
 * `controller.updateWidgetConfig(...)`.
 */

import { AtlasSurface, AtlasElement } from '@atlas/core';
import { registerTestState, makeCommit, type CommitRecord } from '@atlas/test-state';

import { editorWidgetSchemas } from '../editor-widgets/index.ts';
import { PageEditorPropertyPanel } from '../property-panel.ts';
import type {
  PageEditorController,
  PageEditorStateSnapshot,
} from '../state.ts';

interface PresetDescriptor {
  id: string;
  label: string;
  description?: string;
  config: Record<string, unknown>;
}

interface ClipboardEntry {
  widgetId: string;
  config: Record<string, unknown>;
}

type InspectorMode = 'single' | 'multi' | 'empty';

interface ControllerEditorBridge {
  /**
   * The inspector reads the current per-instance config off the canvas
   * editor (the shell does the same via `_canvasPage?.editor`). To keep the
   * inspector decoupled from the DOM walker, the shell can inject a getter
   * via a method-level setter; failing that, the inspector falls back to
   * reading from the controller's snapshot's widgetInstances list.
   */
  getInstanceConfig?: (instanceId: string) => Record<string, unknown> | null;
}

export class PageEditorInspector extends AtlasSurface {
  static override surfaceId = 'authoring.page-editor.shell.right-panel.inspector';

  /**
   * In-memory clipboard scoped to the inspector class. Browser clipboard
   * is gated behind permissions in many embedding contexts; v1 keeps it
   * in-memory so behaviour is deterministic for tests.
   */
  static _clipboard: ClipboardEntry | null = null;

  private _controller: PageEditorController | null = null;
  private _editorBridge: ControllerEditorBridge | null = null;
  private _unsubscribe: (() => void) | null = null;
  private _disposeReader: (() => void) | null = null;
  private _propertyPanel: PageEditorPropertyPanel | null = null;
  private _menuOpen = false;
  private _lastSnapshot: PageEditorStateSnapshot | null = null;
  private _renderedInstanceId: string | null = null;
  private _renderedInstanceIds: string[] = [];
  private _lastCommit: CommitRecord | null = null;

  /** Visible for the shell when constructing this element. */
  set controller(c: PageEditorController | null) {
    if (this._controller === c) return;
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._controller = c;
    if (c) {
      this._unsubscribe = c.subscribe((snap) => this._onSnapshot(snap));
      // Prime the first render synchronously.
      this._onSnapshot(c.getSnapshot());
    } else if (this.isConnected) {
      this._renderEmpty();
    }
  }

  get controller(): PageEditorController | null {
    return this._controller;
  }

  /** Optional: the shell can inject a faster path to live config. */
  setEditorBridge(bridge: ControllerEditorBridge | null): void {
    this._editorBridge = bridge;
  }

  override connectedCallback(): void {
    super.connectedCallback?.();
    this._installTestStateReader();
    if (this._controller) {
      this._onSnapshot(this._controller.getSnapshot());
    } else {
      this._renderEmpty();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback?.();
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._disposeReader?.();
    this._disposeReader = null;
    this._propertyPanel = null;
  }

  // ---- snapshot wiring ----

  private _onSnapshot(snap: PageEditorStateSnapshot): void {
    this._lastSnapshot = snap;
    if (!this.isConnected) return;
    const ids = snap.selectedWidgetInstanceIds;
    if (ids.length === 0) {
      this._renderEmpty();
      return;
    }
    if (ids.length === 1) {
      const id = ids[0]!;
      const inst = snap.widgetInstances.find((w) => w.instanceId === id);
      if (!inst) {
        this._renderEmpty();
        return;
      }
      this._renderSingle(id, inst.widgetId);
      return;
    }
    this._renderMulti([...ids], snap);
  }

  private _renderEmpty(): void {
    this.textContent = '';
    this._propertyPanel = null;
    this._renderedInstanceId = null;
    this._renderedInstanceIds = [];
    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'sm');
    wrap.setAttribute('name', 'settings-tab-content');

    const empty = document.createElement('atlas-stack');
    empty.setAttribute('gap', 'sm');
    empty.setAttribute('name', 'inspector-empty');
    const text = document.createElement('atlas-text');
    text.setAttribute('variant', 'muted');
    text.textContent = 'Select a widget on the canvas to edit its properties.';
    empty.appendChild(text);
    wrap.appendChild(empty);

    this.appendChild(wrap);
  }

  private _renderSingle(instanceId: string, widgetId: string): void {
    this.textContent = '';
    this._renderedInstanceId = instanceId;
    this._renderedInstanceIds = [instanceId];

    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'sm');
    wrap.setAttribute('name', 'settings-tab-content');

    wrap.appendChild(this._buildHeader(widgetId, instanceId));

    const schema = editorWidgetSchemas[widgetId];
    const config = this._readInstanceConfig(instanceId) ?? {};

    const panel = document.createElement('page-editor-property-panel') as
      PageEditorPropertyPanel & HTMLElement;
    panel.setAttribute('name', 'property-panel');
    panel.onChange = (cfg) => {
      void this._controller?.updateWidgetConfig(instanceId, cfg);
    };
    panel.onSectionToggle = (section, open) => {
      this._recordCommit('toggleSection', { section, open });
    };
    wrap.appendChild(panel);
    this._propertyPanel = panel;

    queueMicrotask(() => {
      if (!this._propertyPanel || this._propertyPanel !== panel) return;
      panel.setHeaderSuppressed(true);
      if (schema) {
        panel.configure({
          widgetId,
          instanceId,
          config,
          schema,
        });
      } else {
        panel.clear();
      }
    });

    this.appendChild(wrap);
  }

  private _renderMulti(instanceIds: string[], snap: PageEditorStateSnapshot): void {
    this.textContent = '';
    this._renderedInstanceId = null;
    this._renderedInstanceIds = instanceIds.slice();

    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'sm');
    wrap.setAttribute('name', 'settings-tab-content');

    // Banner / summary
    const banner = document.createElement('atlas-stack');
    banner.setAttribute('gap', 'xs');
    banner.setAttribute('name', 'multi-select-summary');
    banner.setAttribute('data-selection-size', String(instanceIds.length));
    const heading = document.createElement('atlas-heading');
    heading.setAttribute('level', '4');
    heading.textContent = `${instanceIds.length} widgets selected`;
    banner.appendChild(heading);
    const subtitle = document.createElement('atlas-text');
    subtitle.setAttribute('variant', 'muted');
    subtitle.textContent = 'Editing shared fields applies to all selected widgets.';
    banner.appendChild(subtitle);
    wrap.appendChild(banner);

    // Determine intersection of property keys across all selected widgets.
    const widgetIds = instanceIds
      .map((id) => snap.widgetInstances.find((w) => w.instanceId === id)?.widgetId)
      .filter((wid): wid is string => typeof wid === 'string');
    const sharedKeys = computeSharedKeys(widgetIds);

    if (widgetIds.length === 0 || sharedKeys.length === 0) {
      const empty = document.createElement('atlas-text');
      empty.setAttribute('variant', 'muted');
      empty.setAttribute('name', 'multi-select-no-shared');
      empty.textContent = 'No fields are shared across the selected widgets.';
      wrap.appendChild(empty);
      this.appendChild(wrap);
      return;
    }

    // Use the first widget's schema as the rendering scaffold; the property
    // panel only renders fields whose key is in `sharedKeys`.
    const firstWidgetId = widgetIds[0]!;
    const schema = editorWidgetSchemas[firstWidgetId];
    const firstInstanceId = instanceIds[0]!;
    const baseConfig = this._readInstanceConfig(firstInstanceId) ?? {};

    const panel = document.createElement('page-editor-property-panel') as
      PageEditorPropertyPanel & HTMLElement;
    panel.setAttribute('name', 'property-panel');
    panel.onChange = (cfg) => {
      // Apply the shared field changes to every selected instance.
      for (const id of instanceIds) {
        const existing = this._readInstanceConfig(id) ?? {};
        const merged: Record<string, unknown> = { ...existing };
        for (const k of sharedKeys) {
          if (k in cfg) merged[k] = cfg[k];
        }
        void this._controller?.updateWidgetConfig(id, merged);
      }
      this._recordCommit('multiSelectEdit', {
        instanceIds: instanceIds.slice(),
        fieldsChanged: sharedKeys.filter((k) => k in cfg),
      });
    };
    panel.onSectionToggle = (section, open) => {
      this._recordCommit('toggleSection', { section, open });
    };
    wrap.appendChild(panel);
    this._propertyPanel = panel;

    queueMicrotask(() => {
      if (!this._propertyPanel || this._propertyPanel !== panel) return;
      panel.setHeaderSuppressed(true);
      if (schema) {
        panel.configure({
          widgetId: firstWidgetId,
          instanceId: firstInstanceId,
          config: baseConfig,
          schema,
        });
        panel.setVisibleFields(sharedKeys);
      } else {
        panel.clear();
      }
    });

    this.appendChild(wrap);
  }

  // ---- header / menu ----

  private _buildHeader(widgetId: string, instanceId: string): HTMLElement {
    const header = document.createElement('atlas-stack');
    header.setAttribute('direction', 'row');
    header.setAttribute('gap', 'sm');
    header.setAttribute('align', 'center');
    header.setAttribute('name', 'inspector-header');

    const titleStack = document.createElement('atlas-stack');
    titleStack.setAttribute('gap', 'xs');
    const heading = document.createElement('atlas-heading');
    heading.setAttribute('level', '4');
    heading.setAttribute('name', 'inspector-title');
    const schema = editorWidgetSchemas[widgetId] as
      | { title?: string }
      | undefined;
    heading.textContent = schema?.title ?? widgetId;
    titleStack.appendChild(heading);
    const sub = document.createElement('atlas-text');
    sub.setAttribute('variant', 'small');
    sub.setAttribute('name', 'inspector-subtitle');
    sub.textContent = `${widgetId} · ${instanceId}`;
    titleStack.appendChild(sub);
    header.appendChild(titleStack);

    const menuBtn = document.createElement('atlas-button');
    menuBtn.setAttribute('name', 'inspector-menu');
    menuBtn.setAttribute('variant', 'ghost');
    menuBtn.setAttribute('size', 'sm');
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', this._menuOpen ? 'true' : 'false');
    menuBtn.style.cssText = 'min-width:44px;min-height:44px;';
    menuBtn.textContent = '⋮';
    menuBtn.addEventListener('click', () => {
      this._menuOpen = !this._menuOpen;
      this._refreshHeader(widgetId, instanceId);
    });
    header.appendChild(menuBtn);

    if (this._menuOpen) {
      header.appendChild(this._buildMenu(widgetId, instanceId));
    }

    return header;
  }

  private _refreshHeader(widgetId: string, instanceId: string): void {
    if (!this._lastSnapshot) return;
    // Cheapest path: re-render the whole single mode (reuses property panel).
    this._renderSingle(instanceId, widgetId);
  }

  private _buildMenu(widgetId: string, instanceId: string): HTMLElement {
    const menu = document.createElement('atlas-stack');
    menu.setAttribute('gap', 'xs');
    menu.setAttribute('name', 'inspector-menu-panel');
    menu.setAttribute('role', 'menu');

    const presets = readPresets(editorWidgetSchemas[widgetId]);
    if (presets.length > 0) {
      const presetLabel = document.createElement('atlas-text');
      presetLabel.setAttribute('variant', 'small');
      presetLabel.textContent = 'Presets';
      menu.appendChild(presetLabel);
      for (const preset of presets) {
        const btn = document.createElement('atlas-button');
        btn.setAttribute('name', `preset-${preset.id}`);
        btn.setAttribute('variant', 'ghost');
        btn.setAttribute('size', 'sm');
        btn.setAttribute('data-preset-id', preset.id);
        btn.textContent = preset.label;
        btn.style.cssText = 'min-height:44px;';
        btn.addEventListener('click', () => {
          this._applyPreset(preset, widgetId, instanceId);
        });
        menu.appendChild(btn);
      }
    }

    const copyBtn = document.createElement('atlas-button');
    copyBtn.setAttribute('name', 'copy-config');
    copyBtn.setAttribute('variant', 'ghost');
    copyBtn.setAttribute('size', 'sm');
    copyBtn.style.cssText = 'min-height:44px;';
    copyBtn.textContent = 'Copy config';
    copyBtn.addEventListener('click', () => {
      this._copyConfig(widgetId, instanceId);
    });
    menu.appendChild(copyBtn);

    const pasteBtn = document.createElement('atlas-button');
    pasteBtn.setAttribute('name', 'paste-config');
    pasteBtn.setAttribute('variant', 'ghost');
    pasteBtn.setAttribute('size', 'sm');
    pasteBtn.style.cssText = 'min-height:44px;';
    pasteBtn.textContent = 'Paste config';
    const clipboard = PageEditorInspector._clipboard;
    if (!clipboard || clipboard.widgetId !== widgetId) {
      pasteBtn.setAttribute('disabled', '');
    }
    pasteBtn.addEventListener('click', () => {
      this._pasteConfig(widgetId, instanceId);
    });
    menu.appendChild(pasteBtn);

    const resetBtn = document.createElement('atlas-button');
    resetBtn.setAttribute('name', 'reset-defaults');
    resetBtn.setAttribute('variant', 'ghost');
    resetBtn.setAttribute('size', 'sm');
    resetBtn.style.cssText = 'min-height:44px;';
    resetBtn.textContent = 'Reset to defaults';
    resetBtn.addEventListener('click', () => {
      this._resetDefaults(widgetId, instanceId);
    });
    menu.appendChild(resetBtn);

    return menu;
  }

  // ---- intents ----

  private _applyPreset(
    preset: PresetDescriptor,
    widgetId: string,
    instanceId: string,
  ): void {
    const existing = this._readInstanceConfig(instanceId) ?? {};
    const merged: Record<string, unknown> = { ...existing, ...preset.config };
    this._recordCommit('applyPreset', { presetId: preset.id, widgetId });
    void this._controller?.updateWidgetConfig(instanceId, merged);
    this._menuOpen = false;
    this._renderSingle(instanceId, widgetId);
  }

  private _copyConfig(widgetId: string, instanceId: string): void {
    const cfg = this._readInstanceConfig(instanceId) ?? {};
    PageEditorInspector._clipboard = {
      widgetId,
      config: cloneDeep(cfg) as Record<string, unknown>,
    };
    this._recordCommit('copyConfig', { widgetId, instanceId });
    this._menuOpen = false;
    this._renderSingle(instanceId, widgetId);
  }

  private _pasteConfig(widgetId: string, instanceId: string): void {
    const clip = PageEditorInspector._clipboard;
    if (!clip || clip.widgetId !== widgetId) return;
    const merged: Record<string, unknown> = cloneDeep(clip.config) as Record<string, unknown>;
    this._recordCommit('pasteConfig', { widgetId, instanceId });
    void this._controller?.updateWidgetConfig(instanceId, merged);
    this._menuOpen = false;
    this._renderSingle(instanceId, widgetId);
  }

  private _resetDefaults(widgetId: string, instanceId: string): void {
    const schema = editorWidgetSchemas[widgetId] as
      | { properties?: Record<string, { default?: unknown }> }
      | undefined;
    const next: Record<string, unknown> = {};
    const props = schema?.properties ?? {};
    for (const [key, propSchema] of Object.entries(props)) {
      if (propSchema && 'default' in propSchema && propSchema.default !== undefined) {
        next[key] = cloneDeep(propSchema.default);
      }
    }
    this._recordCommit('resetDefaults', { widgetId, instanceId });
    void this._controller?.updateWidgetConfig(instanceId, next);
    this._menuOpen = false;
    this._renderSingle(instanceId, widgetId);
  }

  // ---- helpers ----

  private _readInstanceConfig(instanceId: string): Record<string, unknown> | null {
    if (this._editorBridge?.getInstanceConfig) {
      try {
        return this._editorBridge.getInstanceConfig(instanceId);
      } catch {
        /* fall through */
      }
    }
    const snap = this._lastSnapshot ?? this._controller?.getSnapshot() ?? null;
    if (!snap) return null;
    const inst = snap.widgetInstances.find((w) => w.instanceId === instanceId);
    if (!inst) return null;
    const cfg = (inst as { config?: unknown }).config;
    return cfg && typeof cfg === 'object' ? (cfg as Record<string, unknown>) : {};
  }

  private get _surfaceKey(): string {
    const pageId = this._controller?.pageId ?? 'unknown';
    return `editor:${pageId}:inspector`;
  }

  private _recordCommit(intent: string, patch: Record<string, unknown>): void {
    this._lastCommit = makeCommit(this._surfaceKey, intent, patch);
  }

  private _installTestStateReader(): void {
    this._disposeReader?.();
    this._disposeReader = registerTestState(this._surfaceKey, () => {
      const snap = this._lastSnapshot ?? this._controller?.getSnapshot() ?? null;
      const ids = snap?.selectedWidgetInstanceIds ?? [];
      const mode: InspectorMode =
        ids.length === 0 ? 'empty' : ids.length === 1 ? 'single' : 'multi';
      const instanceId = ids.length === 1 ? (ids[0] ?? null) : null;
      const widgetId =
        instanceId && snap
          ? snap.widgetInstances.find((w) => w.instanceId === instanceId)?.widgetId ?? null
          : null;
      const config = instanceId ? this._readInstanceConfig(instanceId) : null;
      const openSections = this._propertyPanel?.getSectionState() ?? {};
      const clipboard = PageEditorInspector._clipboard;
      return {
        surfaceId: this._surfaceKey,
        mode,
        widgetId,
        instanceId,
        instanceIds: [...ids],
        selectionSize: ids.length,
        config,
        openSections,
        clipboardWidgetId: clipboard?.widgetId ?? null,
        lastCommit: this._lastCommit,
      };
    });
  }
}

// ---- pure helpers (testable in isolation) ----

/**
 * Compute the intersection of property keys across the supplied widget
 * schemas. Order follows the iteration order of the **first** schema so
 * the rendered layout stays predictable.
 */
function computeSharedKeys(widgetIds: string[]): string[] {
  if (widgetIds.length === 0) return [];
  const schemas = widgetIds
    .map((id) => editorWidgetSchemas[id] as { properties?: Record<string, unknown> } | undefined)
    .filter((s): s is { properties?: Record<string, unknown> } => !!s);
  if (schemas.length === 0) return [];
  const firstKeys = Object.keys(schemas[0]?.properties ?? {});
  if (schemas.length === 1) return firstKeys;
  const others = schemas.slice(1).map((s) => new Set(Object.keys(s.properties ?? {})));
  return firstKeys.filter((k) => others.every((set) => set.has(k)));
}

function readPresets(schema: unknown): PresetDescriptor[] {
  if (!schema || typeof schema !== 'object') return [];
  const raw = (schema as Record<string, unknown>)['x-atlas-presets'];
  if (!Array.isArray(raw)) return [];
  const out: PresetDescriptor[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as {
      id?: unknown;
      label?: unknown;
      description?: unknown;
      config?: unknown;
    };
    if (typeof e.id !== 'string' || typeof e.label !== 'string') continue;
    const cfg = e.config && typeof e.config === 'object' ? (e.config as Record<string, unknown>) : {};
    const desc: PresetDescriptor = { id: e.id, label: e.label, config: cfg };
    if (typeof e.description === 'string') desc.description = e.description;
    out.push(desc);
  }
  return out;
}

function cloneDeep(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

AtlasElement.define('page-editor-inspector', PageEditorInspector);
