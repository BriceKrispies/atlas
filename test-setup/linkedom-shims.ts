/**
 * Vitest global setup: install DOM shims that linkedom doesn't provide.
 *
 * Why this file exists:
 *   Phase 2 refactored the design system to use modern DOM features —
 *   constructible stylesheets (`new CSSStyleSheet()`), form-associated
 *   custom elements (`attachInternals()` + `FormData`), and shadow roots
 *   with `adoptedStyleSheets`. Our vitest runner uses linkedom, which
 *   doesn't implement any of these. Any test that imports a Phase-2
 *   element (directly, or transitively via `@atlas/design`) would hit
 *   `ReferenceError: CSSStyleSheet is not defined` at module-load time.
 *
 * What this provides:
 *   - `CSSStyleSheet` stub with a no-op `replaceSync`. `createSheet()` in
 *     `@atlas/design/util` calls `new CSSStyleSheet()` at module scope,
 *     so the constructor must exist before design-system modules load.
 *   - `FormData` stub — some form-associated elements call `new FormData()`
 *     inside their `_commit()` path.
 *   - `ElementInternals` stub installed on `HTMLElement.prototype.attachInternals`
 *     so `this.attachInternals()` returns a neutered object with the two
 *     methods we actually call (`setFormValue`, `setValidity`).
 *   - `attachShadow` patch that seeds `adoptedStyleSheets = []` on the
 *     returned root — linkedom's ShadowRoot lacks this, and
 *     `adoptSheet()` both reads and writes it.
 *   - `ShadowRoot` global stub (linkedom doesn't expose it on window) so
 *     `instanceof ShadowRoot` checks don't blow up.
 *   - `structuredClone` fallback via JSON round-trip.
 *
 * Scope:
 *   These shims are functional-enough for the component state/event flows
 *   we exercise. They are NOT faithful implementations — do not rely on
 *   e.g. CSSStyleSheet actually applying CSS. That's covered by Playwright.
 *
 * linkedom resolution:
 *   Only some workspace packages (design, widgets, page-templates,
 *   widget-host) declare `linkedom` as a dep. Others (eslint-plugin,
 *   core-only unit tests) don't need DOM globals at all. We try to load
 *   it lazily — if absent we still install the plain class stubs
 *   (CSSStyleSheet, FormData) in case something references them, but
 *   skip the DOM-global installation (document, HTMLElement, etc.).
 */

interface GlobalLike {
  window?: unknown;
  document?: unknown;
  HTMLElement?: unknown;
  DocumentFragment?: unknown;
  customElements?: unknown;
  Node?: unknown;
  Event?: unknown;
  CustomEvent?: unknown;
  ShadowRoot?: unknown;
  CSSStyleSheet?: unknown;
  FormData?: unknown;
  structuredClone?: unknown;
}

interface AttachShadowHost {
  attachShadow: (init: unknown) => unknown;
}
interface AttachInternalsHost {
  attachInternals?: () => unknown;
}

// Only install once per process. Vitest may import the setup file from
// multiple worker entries; re-running would double-patch `attachShadow`.
const INSTALLED_KEY = '__atlasLinkedomShimsInstalled';
interface InstallFlag {
  [INSTALLED_KEY]?: boolean;
}
const g = globalThis as unknown as GlobalLike & InstallFlag;

if (!g[INSTALLED_KEY]) {
  g[INSTALLED_KEY] = true;

  // Try to load linkedom. Swallow the resolution failure so packages that
  // don't declare it (e.g. eslint-plugin-atlas-widgets) can still run
  // their pure unit tests through this shared setup file.
  let linkedom: { parseHTML: (src: string) => unknown } | null = null;
  try {
    linkedom = (await import('linkedom')) as {
      parseHTML: (src: string) => unknown;
    };
  } catch {
    linkedom = null;
  }

  if (linkedom) {
    const dom = linkedom.parseHTML(
      '<!doctype html><html><head></head><body></body></html>',
    ) as Record<string, unknown>;

    // Install DOM globals only if the host doesn't already have them
    // (individual test files may install their own DOM first — we
    // shouldn't clobber that).
    if (!g.window) g.window = dom;
    if (!g.document) g.document = dom['document'];
    if (!g.HTMLElement) g.HTMLElement = dom['HTMLElement'];
    if (!g.DocumentFragment) g.DocumentFragment = dom['DocumentFragment'];
    if (!g.customElements) g.customElements = dom['customElements'];
    if (!g.Node) g.Node = dom['Node'];
    // Node 16+ installs its own globalThis.Event / CustomEvent that are
    // incompatible with linkedom's dispatchEvent (setting eventPhase etc.
    // throws on Node's read-only implementation). Always prefer linkedom's.
    g.Event = dom['Event'];
    g.CustomEvent = dom['CustomEvent'];

    // linkedom doesn't expose ShadowRoot on the window; AtlasElement.surface
    // uses `instanceof ShadowRoot` so provide a never-matches stub.
    if (!g.ShadowRoot) {
      g.ShadowRoot = dom['ShadowRoot'] ?? class ShadowRoot {};
    }
  }

  if (!g.structuredClone) {
    g.structuredClone = (v: unknown): unknown =>
      JSON.parse(JSON.stringify(v)) as unknown;
  }

  // CSSStyleSheet: accept replaceSync, track cssText for debugging.
  if (!g.CSSStyleSheet) {
    g.CSSStyleSheet = class CSSStyleSheet {
      cssText = '';
      replaceSync(css: string): void {
        this.cssText = css;
      }
      replace(css: string): Promise<void> {
        this.cssText = css;
        return Promise.resolve();
      }
    };
  }

  // FormData: minimal append/get for form-associated elements.
  if (!g.FormData) {
    g.FormData = class FormData {
      private _entries: Array<[string, unknown]> = [];
      append(k: string, v: unknown): void {
        this._entries.push([k, v]);
      }
      get(k: string): unknown {
        const hit = this._entries.find(([name]) => name === k);
        return hit ? hit[1] : null;
      }
    };
  }

  // HTMLElement.prototype.attachInternals stub. Only install if
  // HTMLElement is present (skipped for DOM-less workspaces).
  const htmlEl = g.HTMLElement as unknown as
    | { prototype: AttachInternalsHost }
    | undefined;
  if (
    htmlEl?.prototype &&
    typeof htmlEl.prototype.attachInternals !== 'function'
  ) {
    htmlEl.prototype.attachInternals = function attachInternals(): unknown {
      return {
        setFormValue: () => undefined,
        setValidity: () => undefined,
        checkValidity: () => true,
        reportValidity: () => true,
      };
    };
  }

  // Patch attachShadow so the returned root always has an
  // `adoptedStyleSheets` array. `adoptSheet()` reads + writes it.
  const elProto = (
    g.HTMLElement as unknown as
      | { prototype: AttachShadowHost }
      | undefined
  )?.prototype;
  if (elProto && typeof elProto.attachShadow === 'function') {
    const orig = elProto.attachShadow;
    elProto.attachShadow = function patchedAttachShadow(
      init: unknown,
    ): unknown {
      const root = orig.call(this, init) as {
        adoptedStyleSheets?: unknown[];
      };
      if (!Array.isArray(root.adoptedStyleSheets)) {
        root.adoptedStyleSheets = [];
      }
      return root;
    };
  }
}
