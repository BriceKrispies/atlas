/**
 * <content-page> — view-mode runtime for page templates + page documents.
 *
 * Lifecycle (view mode only — editor mode is deferred to a later step):
 *
 *   1. On connect, `<content-page>` loads the page document via its
 *      `pageStore` and looks up the resolved template in its
 *      `templateRegistry`.
 *   2. It performs version / region validation (INV-TEMPLATE-02, -05, -08)
 *      and, on failure, renders a fail-closed error box.
 *   3. On success it instantiates the template's element class, appends a
 *      `<widget-host>` as a child of that template element, and forwards
 *      the layout `{ version: 1, slots: doc.regions }` to the widget-host.
 *
 * Template element contract:
 *   The template receives a `<widget-host>` as a child. Templates extend
 *   AtlasElement and are expected to project the widget-host into the
 *   right spot (typically via a `<slot>` in their shadow root, or by
 *   arranging their own chrome around the child). `<content-page>`
 *   creates the widget-host, configures it, and appends it to the template
 *   — the template decides where it renders.
 *
 * Forwarded to `<widget-host>`:
 *   principal, tenantId, correlationId, locale, theme, capabilities,
 *   resolveWidgetModuleUrl, onMediatorTrace, onCapabilityTrace, widgetRegistry
 *   (as .registry).
 */

import { AtlasElement, AtlasSurface, html } from '@atlas/core';
import { moduleDefaultRegistry } from '@atlas/widget-host';

import { moduleDefaultTemplateRegistry } from './registry.js';
import { attachEditor } from './editor/edit-mount.js';
import './editor/widget-palette.js';
import { ensureEditorStyles } from './editor/editor-styles.js';


function telemetry(event, payload) {
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
function compareSemver(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

export class ContentPageElement extends AtlasSurface {
  static surfaceId = 'content-page';
  constructor() {
    super();
    /** @type {string} */
    this.pageId = '';
    /** @type {import('./page-store.js').PageStore | null} */
    this.pageStore = null;
    /** @type {import('./registry.js').TemplateRegistry | null} */
    this._templateRegistry = null;
    /** @type {object | null} */
    this.widgetRegistry = null;
    /** @type {object | null} */
    this.principal = null;
    /** @type {string} */
    this.tenantId = '';
    /** @type {string} */
    this.correlationId = '';
    /** @type {string} */
    this.locale = 'en';
    /** @type {string} */
    this.theme = 'default';
    /** @type {Record<string, Function>} */
    this.capabilities = {};
    /** @type {((widgetId: string) => (string | null | undefined)) | null} */
    this.resolveWidgetModuleUrl = null;
    /** @type {((event: object) => void) | null} */
    this.onMediatorTrace = null;
    /** @type {((event: object) => void) | null} */
    this.onCapabilityTrace = null;
    /**
     * When true, the content-page mounts in editor mode: cells gain
     * chrome, drop indicators are rendered, a <widget-palette> appears,
     * and keyboard shortcuts become active. Toggling this at runtime
     * triggers a re-mount through _loadAndMount.
     * @type {boolean}
     */
    this.edit = false;

    /**
     * Gate for edit mode. When `edit=true` but `canEdit=false`, the
     * element renders in view mode and emits `atlas.content-page.edit.denied`.
     * Future integration will set this from the authz check for
     * ContentPages.Page.UpdateLayout; today it's a pass-through default of
     * true.
     * @type {boolean}
     */
    this.canEdit = true;

    /** @type {HTMLElement | null} */
    this._templateEl = null;
    /** @type {HTMLElement | null} */
    this._widgetHostEl = null;
    /** @type {HTMLElement | null} */
    this._editLayoutEl = null;
    /** @type {HTMLElement | null} */
    this._paletteEl = null;
    /** @type {object | null} */
    this._editorHandle = null;
    /** @type {object | null} */
    this._currentDoc = null;
    /** @type {object | null} */
    this._currentManifest = null;
  }

  set templateRegistry(value) {
    this._templateRegistry = value;
  }

  get templateRegistry() {
    return this._templateRegistry ?? moduleDefaultTemplateRegistry;
  }

  connectedCallback() {
    // Bypass AtlasSurface's managed lifecycle — this element drives its
    // own imperative mount pipeline. AtlasSurface._applyTestId sets
    // data-testid from surfaceId; children then inherit via surface
    // ancestor walk.
    this._applyTestId();
    if (this.pageId) {
      this.setAttribute('data-page-id', this.pageId);
    }
    this._loadAndMount().catch((err) => {
      this._renderError(`Unexpected error: ${err?.message ?? String(err)}`);
      telemetry('atlas.content-page.load.error', {
        pageId: this.pageId,
        reason: 'unexpected',
        correlationId: this.correlationId,
        message: err?.message ?? String(err),
      });
    });
    this.onMount();
  }

  disconnectedCallback() {
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

  _detachEditor() {
    if (this._editorHandle) {
      try {
        this._editorHandle.detach();
      } catch {
        /* best effort */
      }
      this._editorHandle = null;
    }
  }

  render() {
    // Intentionally empty — connectedCallback runs the imperative mount.
  }

  // ---- internal ----

  _renderError(message) {
    this.textContent = '';
    this.appendChild(
      html`
        <atlas-box padding="md">
          <atlas-text variant="error" name="content-page-error">${message}</atlas-text>
        </atlas-box>
      `,
    );
  }

  async _loadAndMount() {
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

    let doc;
    try {
      doc = await this.pageStore.get(this.pageId);
    } catch (err) {
      const msg = `page load failed: ${err?.message ?? String(err)}`;
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

    const registry = this.templateRegistry;
    if (!registry.has(doc.templateId)) {
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
    const { manifest, element: TemplateClass } = registry.get(doc.templateId);

    // INV-TEMPLATE-08: stored version ahead of registered version fails closed.
    const cmp = compareSemver(doc.templateVersion, manifest.version);
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
      // Older stored doc — migration is deferred to a later step. For now
      // we render as-is; breaking changes would be caught by region
      // validation below.
      // eslint-disable-next-line no-console
      console.debug('atlas.content-page.version.behind', {
        pageId: this.pageId,
        templateId: doc.templateId,
        storedVersion: doc.templateVersion,
        registeredVersion: manifest.version,
        correlationId: this.correlationId,
      });
    }

    // INV-TEMPLATE-02: every region name in the document must exist
    // in the manifest. Regions may be empty — the template's `required`
    // flag is informational only and not enforced at load time.
    const manifestRegionNames = new Set(manifest.regions.map((r) => r.name));
    const docRegions = doc.regions ?? {};
    for (const regionName of Object.keys(docRegions)) {
      if (!manifestRegionNames.has(regionName)) {
        const msg =
          `Region '${regionName}' is not declared on template ${doc.templateId}.`;
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

    // All checks passed — instantiate the template element and append a
    // configured <widget-host> child.
    this._detachEditor();
    this.textContent = '';
    const templateEl = new TemplateClass();
    this._templateEl = templateEl;

    const hostEl = document.createElement('widget-host');
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

    templateEl.appendChild(hostEl);

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
      layout.appendChild(templateEl);

      const palette = document.createElement('widget-palette');
      palette.widgetRegistry = this.widgetRegistry ?? moduleDefaultRegistry;
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
        templateEl,
        widgetHostEl: hostEl,
        pageDoc: doc,
        templateManifest: manifest,
        widgetRegistry: this.widgetRegistry ?? moduleDefaultRegistry,
        onCommit: async (nextDoc, info) => this._commitAndRemount(nextDoc, info),
        onTelemetry: ({ event, payload }) =>
          telemetry(event, {
            pageId: this.pageId,
            correlationId: this.correlationId,
            ...payload,
          }),
      });
      this._editorHandle.setPalette(palette);
    } else {
      this.appendChild(templateEl);
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

  async _commitAndRemount(nextDoc, _info) {
    // Persist through the store (the ValidatingPageStore decorator will
    // reject invalid docs; let it throw — edit-mount catches and announces).
    await this.pageStore.save(this.pageId, nextDoc);
    // Re-read via get() and re-mount so the visible DOM is a pure
    // reflection of the store (round-trips through any validator).
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
