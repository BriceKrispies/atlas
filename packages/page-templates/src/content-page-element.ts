/**
 * <content-page> — view-mode runtime for page templates + page documents.
 */

import { AtlasElement, AtlasSurface, html } from '@atlas/core';
import { moduleDefaultRegistry } from '@atlas/widget-host';

import {
  moduleDefaultTemplateRegistry,
  type TemplateManifest,
  type TemplateRegistry,
} from './registry.ts';
import { attachEditor, type EditorHandle } from './editor/edit-mount.ts';
import './editor/widget-palette.ts';
import { ensureEditorStyles } from './editor/editor-styles.ts';
import { AtlasLayoutElement } from './layout/layout-element.ts';
import {
  moduleDefaultLayoutRegistry,
  type LayoutRegistry,
} from './layout/layout-registry.ts';
import type { LayoutDocument } from './layout/layout-document.ts';
import type { PageDocument, PageStore } from './page-store.ts';
import type { EditorAPI, CommitInfo } from './editor/editor-api.ts';
import type { WidgetRegistryLike } from './drop-zones.ts';

export interface LayoutStoreLike {
  get(id: string): Promise<LayoutDocument | null>;
}

interface WidgetHostLike extends HTMLElement {
  registry?: unknown;
  principal?: unknown;
  tenantId?: string;
  correlationId?: string;
  locale?: string;
  theme?: string;
  capabilities?: Record<string, unknown>;
  resolveWidgetModuleUrl?: ((widgetId: string) => string | null | undefined) | null;
  onMediatorTrace?: ((event: object) => void) | null;
  onCapabilityTrace?: ((event: object) => void) | null;
  layout?: { version: number; slots: Record<string, unknown> };
  applyMutation?: (args: Record<string, unknown>) => boolean;
}

function telemetry(event: string, payload: Record<string, unknown>): void {
  // Errors go to console.error; lifecycle events to console.debug.
  // eslint-disable-next-line no-console
  const fn = event === 'atlas.content-page.load.error' ? console.error : console.debug;
  fn(event, payload);
}

/**
 * Compare two semver strings. Returns -1, 0, or 1.
 * Both inputs MUST match `^\d+\.\d+\.\d+$` — validated upstream by the
 * page-document / page-template schemas.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}

export class ContentPageElement extends AtlasSurface {
  static override surfaceId = 'content-page';

  pageId = '';
  pageStore: PageStore | null = null;
  private _templateRegistry: TemplateRegistry | null = null;
  private _layoutRegistry: LayoutRegistry | null = null;
  private _layoutStore: LayoutStoreLike | null | undefined = null;
  widgetRegistry: WidgetRegistryLike | null = null;
  principal: unknown = null;
  tenantId = '';
  correlationId = '';
  locale = 'en';
  theme = 'default';
  capabilities: Record<string, unknown> = {};
  resolveWidgetModuleUrl: ((widgetId: string) => string | null | undefined) | null = null;
  onMediatorTrace: ((event: object) => void) | null = null;
  onCapabilityTrace: ((event: object) => void) | null = null;

  /**
   * When true, the content-page mounts in editor mode: cells gain
   * chrome, drop indicators are rendered, a <widget-palette> appears,
   * and keyboard shortcuts become active. Toggling this at runtime
   * triggers a re-mount through _loadAndMount.
   */
  edit = false;

  /**
   * Gate for edit mode. When `edit=true` but `canEdit=false`, the
   * element renders in view mode and emits `atlas.content-page.edit.denied`.
   */
  canEdit = true;

  private _templateEl: HTMLElement | null = null;
  private _widgetHostEl: WidgetHostLike | null = null;
  private _editLayoutEl: HTMLElement | null = null;
  private _paletteEl: HTMLElement | null = null;
  private _editorHandle: EditorHandle | null = null;
  private _currentDoc: PageDocument | null = null;
  private _currentManifest: TemplateManifest | null = null;

  /**
   * Public imperative API for programmatic edits (agents, Playwright).
   */
  editor: EditorAPI | null = null;

  set templateRegistry(value: TemplateRegistry | null) {
    this._templateRegistry = value;
  }

  get templateRegistry(): TemplateRegistry {
    return this._templateRegistry ?? moduleDefaultTemplateRegistry;
  }

  set layoutRegistry(value: LayoutRegistry | null) {
    this._layoutRegistry = value;
  }

  get layoutRegistry(): LayoutRegistry {
    return this._layoutRegistry ?? moduleDefaultLayoutRegistry;
  }

  /**
   * Optional async store for user-created / edited layouts.
   */
  set layoutStore(value: LayoutStoreLike | null | undefined) {
    this._layoutStore = value;
  }

  get layoutStore(): LayoutStoreLike | null | undefined {
    return this._layoutStore;
  }

  override connectedCallback(): void {
    // Bypass AtlasSurface's managed lifecycle — this element drives its
    // own imperative mount pipeline. AtlasSurface._applyTestId sets
    // data-testid from surfaceId; children then inherit via surface
    // ancestor walk.
    (this as unknown as { _applyTestId: () => void })._applyTestId();
    if (this.pageId) {
      this.setAttribute('data-page-id', this.pageId);
    }
    this._loadAndMount().catch((err: unknown) => {
      const e = err as Error | undefined;
      this._renderError(`Unexpected error: ${e?.message ?? String(err)}`);
      telemetry('atlas.content-page.load.error', {
        pageId: this.pageId,
        reason: 'unexpected',
        correlationId: this.correlationId,
        message: e?.message ?? String(err),
      });
    });
    this.onMount();
  }

  override disconnectedCallback(): void {
    this.onUnmount();
    this._detachEditor();
    // The widget-host's own disconnectedCallback tears down its mediator,
    // capability bridge, and all mounted widgets. We just detach it.
    if (this._widgetHostEl && this._widgetHostEl.parentNode) {
      this._widgetHostEl.parentNode.removeChild(this._widgetHostEl);
    }
    this._widgetHostEl = null;
    this._templateEl = null;
    this._editLayoutEl = null;
    this._paletteEl = null;
    this.textContent = '';
  }

  private _detachEditor(): void {
    if (this._editorHandle) {
      try {
        this._editorHandle.detach();
      } catch {
        /* best effort */
      }
      this._editorHandle = null;
    }
    this.editor = null;
  }

  override render(): void {
    // Intentionally empty — connectedCallback runs the imperative mount.
  }

  /**
   * Re-read the doc from `pageStore` and remount the template + editor.
   */
  override async reload(): Promise<void> {
    this._detachEditor();
    if (this._widgetHostEl && this._widgetHostEl.parentNode) {
      this._widgetHostEl.parentNode.removeChild(this._widgetHostEl);
    }
    this._widgetHostEl = null;
    this._templateEl = null;
    this._editLayoutEl = null;
    this._paletteEl = null;
    this.textContent = '';
    await this._loadAndMount();
  }

  // ---- internal ----

  private _renderError(message: string): void {
    this.textContent = '';
    this.appendChild(
      html`
        <atlas-box padding="md">
          <atlas-text variant="error" name="content-page-error">${message}</atlas-text>
        </atlas-box>
      `,
    );
  }

  private async _loadAndMount(): Promise<void> {
    const started = Date.now();
    if (!this.pageStore || typeof this.pageStore.get !== 'function') {
      const msg = 'pageStore is required on <content-page>';
      this._renderError(msg);
      telemetry('atlas.content-page.load.error', {
        pageId: this.pageId,
        reason: 'missing-page-store',
        correlationId: this.correlationId,
        message: msg,
      });
      return;
    }

    let doc: PageDocument | null;
    try {
      doc = await this.pageStore.get(this.pageId);
    } catch (err) {
      const msg = `page load failed: ${(err as Error | undefined)?.message ?? String(err)}`;
      this._renderError(msg);
      telemetry('atlas.content-page.load.error', {
        pageId: this.pageId,
        reason: 'store-error',
        correlationId: this.correlationId,
        message: msg,
      });
      return;
    }

    if (doc == null) {
      const msg = `Page not found: ${this.pageId}`;
      this._renderError(msg);
      telemetry('atlas.content-page.load.error', {
        pageId: this.pageId,
        reason: 'not-found',
        correlationId: this.correlationId,
        message: msg,
      });
      return;
    }

    // A page doc may reference either a legacy static template
    // (`templateId`) or a data-driven layout (`layoutId`). Layouts win
    // when both are present.
    const docRegions = doc.regions ?? {};
    let manifest: TemplateManifest | null = null;
    let templateEl: HTMLElement | null = null;

    if (typeof doc.layoutId === 'string' && doc.layoutId.length > 0) {
      // --- Layout-based path ------------------------------------------
      let layoutDoc: LayoutDocument | null = null;
      if (this.layoutStore && typeof this.layoutStore.get === 'function') {
        try {
          layoutDoc = await this.layoutStore.get(doc.layoutId);
        } catch {
          /* fall through to registry */
        }
      }
      if (!layoutDoc) {
        layoutDoc = this.layoutRegistry.get(doc.layoutId);
      }
      if (!layoutDoc) {
        const msg = `Layout not found: ${doc.layoutId}`;
        this._renderError(msg);
        telemetry('atlas.content-page.load.error', {
          pageId: this.pageId,
          reason: 'layout-missing',
          correlationId: this.correlationId,
          message: msg,
        });
        return;
      }
      if (typeof doc.layoutVersion === 'string') {
        const cmp = compareSemver(doc.layoutVersion, layoutDoc.version);
        if (cmp > 0) {
          const msg =
            `Stored layoutVersion ${doc.layoutVersion} is ahead of ` +
            `registered ${layoutDoc.version} for layout ${doc.layoutId}.`;
          this._renderError(msg);
          telemetry('atlas.content-page.load.error', {
            pageId: this.pageId,
            reason: 'layout-version-ahead',
            correlationId: this.correlationId,
            message: msg,
          });
          return;
        }
      }
      const slotNames = new Set(layoutDoc.slots.map((s) => s.name));
      for (const regionName of Object.keys(docRegions)) {
        if (!slotNames.has(regionName)) {
          const msg = `Region '${regionName}' is not a slot in layout ${doc.layoutId}.`;
          this._renderError(msg);
          telemetry('atlas.content-page.load.error', {
            pageId: this.pageId,
            reason: 'region-validation',
            correlationId: this.correlationId,
            message: msg,
          });
          return;
        }
      }

      this._detachEditor();
      this.textContent = '';
      const layoutEl = new AtlasLayoutElement();
      layoutEl.layout = layoutDoc;
      templateEl = layoutEl;
      this._templateEl = layoutEl;

      // Synthesize a template-shaped manifest so the editor + palette can
      // operate on layout-based pages without a dedicated code path.
      manifest = {
        templateId: layoutDoc.layoutId,
        version: layoutDoc.version,
        displayName: layoutDoc.displayName ?? layoutDoc.layoutId,
        regions: layoutDoc.slots.map((s) => ({ name: s.name })),
      };
    } else {
      // --- Legacy template-based path ---------------------------------
      const registry = this.templateRegistry;
      if (!registry.has(doc.templateId as string)) {
        const msg = `Template not registered: ${doc.templateId}`;
        this._renderError(msg);
        telemetry('atlas.content-page.load.error', {
          pageId: this.pageId,
          reason: 'template-missing',
          correlationId: this.correlationId,
          message: msg,
        });
        return;
      }
      const resolved = registry.get(doc.templateId as string);
      manifest = resolved.manifest;
      const TemplateClass = resolved.element;

      // INV-TEMPLATE-08: stored version ahead of registered version fails closed.
      const cmp = compareSemver(doc.templateVersion as string, manifest.version);
      if (cmp > 0) {
        const msg =
          `Stored templateVersion ${doc.templateVersion} is ahead of registered ` +
          `${manifest.version} for template ${doc.templateId} — cannot render.`;
        this._renderError(msg);
        telemetry('atlas.content-page.load.error', {
          pageId: this.pageId,
          reason: 'template-version-ahead',
          correlationId: this.correlationId,
          message: msg,
        });
        return;
      }
      if (cmp < 0) {
        // eslint-disable-next-line no-console
        console.debug('atlas.content-page.version.behind', {
          pageId: this.pageId,
          templateId: doc.templateId,
          storedVersion: doc.templateVersion,
          registeredVersion: manifest.version,
          correlationId: this.correlationId,
        });
      }

      // INV-TEMPLATE-02: every region in the document must be declared
      // on the template manifest.
      const manifestRegionNames = new Set(manifest.regions.map((r) => r.name));
      for (const regionName of Object.keys(docRegions)) {
        if (!manifestRegionNames.has(regionName)) {
          const msg = `Region '${regionName}' is not declared on template ${doc.templateId}.`;
          this._renderError(msg);
          telemetry('atlas.content-page.load.error', {
            pageId: this.pageId,
            reason: 'region-validation',
            correlationId: this.correlationId,
            message: msg,
          });
          return;
        }
      }

      this._detachEditor();
      this.textContent = '';
      templateEl = new TemplateClass() as HTMLElement;
      this._templateEl = templateEl;
    }

    const hostEl = document.createElement('widget-host') as WidgetHostLike;
    if (this.widgetRegistry) hostEl.registry = this.widgetRegistry;
    hostEl.principal = this.principal;
    hostEl.tenantId = this.tenantId;
    hostEl.correlationId = this.correlationId;
    hostEl.locale = this.locale;
    hostEl.theme = this.theme;
    hostEl.capabilities = this.capabilities ?? {};
    hostEl.resolveWidgetModuleUrl = this.resolveWidgetModuleUrl;
    hostEl.onMediatorTrace = this.onMediatorTrace;
    hostEl.onCapabilityTrace = this.onCapabilityTrace;
    // Set layout last so the host's setter can pick up all forwarded props.
    hostEl.layout = { version: 1, slots: docRegions };
    this._widgetHostEl = hostEl;

    templateEl!.appendChild(hostEl);

    this._currentDoc = doc;
    this._currentManifest = manifest;

    // --- Editor-mode gate --------------------------------------------
    const wantsEdit = this.edit === true;
    if (wantsEdit && this.canEdit === false) {
      telemetry('atlas.content-page.edit.denied', {
        pageId: this.pageId,
        templateId: doc.templateId,
        correlationId: this.correlationId,
      });
    }
    const enterEdit = wantsEdit && this.canEdit !== false;
    // Reflect the edit state to an attribute so editor CSS (`content-page[edit]`)
    // can activate. The property stays the source of truth.
    this.toggleAttribute('edit', enterEdit);

    if (enterEdit) {
      // Wrap template + palette in an edit layout sibling.
      const layout = document.createElement('atlas-box');
      layout.className = 'content-page-edit-layout';
      layout.setAttribute('name', 'edit-layout');
      layout.appendChild(templateEl!);

      const palette = document.createElement('widget-palette') as HTMLElement & {
        widgetRegistry?: WidgetRegistryLike;
        templateManifest?: TemplateManifest | null;
        pageDoc?: PageDocument;
      };
      palette.widgetRegistry = (this.widgetRegistry ?? moduleDefaultRegistry) as WidgetRegistryLike;
      palette.templateManifest = manifest;
      palette.pageDoc = doc;
      layout.appendChild(palette);
      this._paletteEl = palette;
      this._editLayoutEl = layout;

      this.appendChild(layout);

      // Inject editor chrome styles into our root (document or shadow root).
      ensureEditorStyles(this);

      // Attach editor AFTER the DOM is in place so widget-host's cells
      // are present for decoration.
      this._editorHandle = attachEditor({
        contentPageEl: this,
        templateEl: templateEl!,
        widgetHostEl: hostEl,
        pageDoc: doc,
        templateManifest: manifest!,
        widgetRegistry: (this.widgetRegistry ?? moduleDefaultRegistry) as WidgetRegistryLike,
        onCommit: async (nextDoc, info) => this._commitAndRemount(nextDoc, info),
        onTelemetry: ({ event, payload }) =>
          telemetry(event, {
            pageId: this.pageId,
            correlationId: this.correlationId,
            ...payload,
          }),
      });
      this._editorHandle.setPalette(palette);
      // Expose the imperative API. Agents and tests call
      // `contentPageEl.editor.add({...})` etc. and never touch pointer state.
      this.editor = this._editorHandle.api;
    } else {
      this.appendChild(templateEl!);
    }

    telemetry('atlas.content-page.load', {
      pageId: this.pageId,
      templateId: doc.templateId,
      templateVersion: doc.templateVersion,
      correlationId: this.correlationId,
      elapsedMs: Date.now() - started,
      edit: enterEdit,
    });
  }

  private async _commitAndRemount(nextDoc: PageDocument, info: CommitInfo): Promise<void> {
    // Persist through the store (the ValidatingPageStore decorator will
    // reject invalid docs; let it throw — edit-mount catches and announces).
    await this.pageStore!.save(this.pageId, nextDoc);

    // Try an incremental mutation first — keeps every untouched widget
    // and every section exactly where it was, so nothing reflows on an
    // edit. Falls back to a full remount if the widget-host can't apply
    // the mutation in place (or if there's no action info).
    const applied =
      !!info?.action &&
      typeof this._widgetHostEl?.applyMutation === 'function' &&
      this._widgetHostEl.applyMutation({
        action: info.action,
        instanceId: info.instanceId,
        widgetId: info.widgetId,
        from: info.from,
        to: info.to,
        nextDoc,
      });

    if (applied) {
      this._currentDoc = nextDoc;
      // Re-decorate editor chrome against the new doc. No DnD teardown,
      // no widget remounting — just chrome + drop-target registration.
      this._editorHandle?.refresh?.();
      return;
    }

    // Full rebuild fallback.
    this._detachEditor();
    if (this._widgetHostEl && this._widgetHostEl.parentNode) {
      this._widgetHostEl.parentNode.removeChild(this._widgetHostEl);
    }
    this._widgetHostEl = null;
    this._templateEl = null;
    this._editLayoutEl = null;
    this._paletteEl = null;
    this.textContent = '';
    await this._loadAndMount();
  }
}
