import { AtlasElement } from '@atlas/core';

/**
 * <atlas-code-editor> — Monaco-backed code editor.
 *
 * LIGHT DOM by design. Monaco injects global CSS into document.head and
 * is not compatible with shadow DOM; this primitive intentionally
 * renders in light DOM so its stylesheets apply. All other Atlas
 * primitives use shadow DOM — this one does not. Default visual
 * layout (display:block, min-height) is defined in elements.css
 * targeting `atlas-code-editor` from outside.
 *
 * Zero-cost stub: this file ships in the main bundle and only registers
 * the tag. The Monaco runtime (~3MB) lives in ./atlas-code-editor-impl.ts
 * and is fetched via a dynamic import the first time any instance
 * connects. The dynamic import is cached by the module graph, so the
 * second editor on the page is instant and shares the same Monaco.
 *
 * Attributes:
 *   value     — initial text content
 *   language  — Monaco language id (default 'typescript')
 *   theme     — 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'
 *   readonly  — (boolean) read-only editor
 *   height    — CSS height (default: 320px, from elements.css)
 */
export class AtlasCodeEditor extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['value', 'language', 'theme', 'readonly', 'height'];
  }

  private _controller: CodeEditorController | null = null;
  private _loading = false;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this._controller || this._loading) return;
    this._loading = true;

    // Only the `height` attribute needs to reflect to inline style —
    // it's a numeric override, not a layout default. `display:block`
    // and the 320px fallback live in elements.css.
    const heightAttr = this.getAttribute('height');
    if (heightAttr) this.style.height = heightAttr;

    void loadCodeEditorImpl().then((mod) => {
      this._loading = false;
      if (!this.isConnected) return;
      this._controller = mod.mount(this);
    });
  }

  override disconnectedCallback(): void {
    this._controller?.dispose();
    this._controller = null;
    super.disconnectedCallback?.();
  }

  override attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    newValue: string | null,
  ): void {
    // Before the impl lands, attribute changes are a no-op — the impl
    // reads current attribute values at mount time.
    this._controller?.applyAttribute(name, newValue);
  }

  /** Current editor text. Returns the unmounted `value` attr if Monaco
   *  hasn't finished loading yet. */
  get value(): string {
    return this._controller?.getValue() ?? this.getAttribute('value') ?? '';
  }

  set value(next: string) {
    if (this._controller) this._controller.setValue(next);
    else this.setAttribute('value', next);
  }
}

AtlasElement.define('atlas-code-editor', AtlasCodeEditor);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-code-editor': AtlasCodeEditor;
  }
}

/**
 * Shape the impl module must export. Keeping this here (instead of in
 * the impl) means `atlas-code-editor-impl.ts` can be fully tree-shaken
 * out of any consumer that doesn't instantiate the element.
 */
export interface CodeEditorController {
  getValue(): string;
  setValue(next: string): void;
  applyAttribute(name: string, value: string | null): void;
  dispose(): void;
}

interface CodeEditorModule {
  mount(host: AtlasCodeEditor): CodeEditorController;
}

let implPromise: Promise<CodeEditorModule> | null = null;

/**
 * Returns a singleton promise for the Monaco-backed impl module. First
 * call starts the network fetch; every later call re-uses the same
 * promise, so Monaco is downloaded exactly once per page load no
 * matter how many editors are mounted.
 */
function loadCodeEditorImpl(): Promise<CodeEditorModule> {
  if (!implPromise) {
    implPromise = import('./atlas-code-editor-impl.ts');
  }
  return implPromise;
}
