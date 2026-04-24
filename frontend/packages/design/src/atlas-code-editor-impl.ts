/**
 * Monaco runtime impl for <atlas-code-editor>. Loaded dynamically by
 * the stub in ./atlas-code-editor.ts, which means Vite emits this
 * module (and all of Monaco) as a separate chunk. Consumers that never
 * mount a code editor pay nothing.
 */
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

import type { AtlasCodeEditor, CodeEditorController } from './atlas-code-editor.ts';

// Monaco reads `self.MonacoEnvironment.getWorker` each time it spawns a
// worker. Configure it exactly once — subsequent editor instances pick
// up the same mapping. Workers themselves are lazy: only the languages
// actually used on the page get spawned.
declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

let envConfigured = false;
function configureEnvironment(): void {
  if (envConfigured) return;
  envConfigured = true;
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      switch (label) {
        case 'json':
          return new JsonWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker();
        case 'typescript':
        case 'javascript':
          return new TsWorker();
        default:
          return new EditorWorker();
      }
    },
  };
}

/**
 * <atlas-code-editor> is a light-DOM element, but nothing prevents a
 * host app (including the sandbox shell) from mounting it *inside* a
 * shadow root. Monaco writes its CSS into document.head as Vite-injected
 * <style> tags and CSSStyleSheets, which don't pierce shadow boundaries
 * — the editor would render unstyled (faded text, visible IME textarea,
 * no `.vs-dark` background). To keep the element usable in that case we
 * adopt any document-level stylesheet whose rules mention `.monaco-editor`
 * into the enclosing shadow root using `adoptedStyleSheets`.
 *
 * This adopts *copies* of the rules (we can't adopt a document-owned
 * sheet directly), so there is a small per-shadow-root memory cost.
 * Each shadow root is adopted into only once; a MutationObserver on
 * document.head catches late-arriving stylesheets (Monaco can inject
 * more when a feature like suggest first activates).
 *
 * Returns a disconnect function the caller invokes on dispose.
 */
const adoptedRoots = new WeakSet<ShadowRoot>();

function adoptMonacoStylesIntoShadow(host: HTMLElement): () => void {
  const root = host.getRootNode();
  if (!(root instanceof ShadowRoot)) return () => {};

  const known = new Set<CSSStyleSheet>();

  const collect = (): CSSStyleSheet[] => {
    const out: CSSStyleSheet[] = [];
    for (const src of Array.from(document.styleSheets)) {
      if (known.has(src)) continue;
      let rules: CSSRuleList;
      try {
        rules = src.cssRules;
      } catch {
        // Cross-origin sheets throw on cssRules access — skip.
        known.add(src);
        continue;
      }
      let hasMonaco = false;
      const parts: string[] = [];
      for (const rule of Array.from(rules)) {
        const txt = rule.cssText;
        parts.push(txt);
        if (!hasMonaco && txt.includes('.monaco-editor')) hasMonaco = true;
      }
      known.add(src);
      if (!hasMonaco || parts.length === 0) continue;
      const sheet = new CSSStyleSheet();
      try {
        sheet.replaceSync(parts.join('\n'));
        out.push(sheet);
      } catch {
        // Some @-rules (e.g. @import) can't be replaceSync'd — ignore.
      }
    }
    return out;
  };

  const apply = (): void => {
    const next = collect();
    if (next.length === 0) return;
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...next];
  };

  // First editor mounted into this shadow root drives the MutationObserver;
  // later mounts just re-run collect() in case new sheets arrived.
  apply();
  if (adoptedRoots.has(root)) return () => {};
  adoptedRoots.add(root);
  const obs = new MutationObserver(apply);
  obs.observe(document.head, { childList: true, subtree: true });
  return () => obs.disconnect();
}

/**
 * Shared DOM node for overflow widgets (suggest, hover, context menu).
 * Must live in light DOM — otherwise widgets render inside the shadow
 * root and get clipped, hidden, or unstyled. One node is shared across
 * every editor instance and stays attached for the lifetime of the tab.
 */
let overflowWidgetsNode: HTMLElement | null = null;
function getOverflowWidgetsNode(): HTMLElement {
  if (overflowWidgetsNode) return overflowWidgetsNode;
  const el = document.createElement('div');
  el.className = 'monaco-editor';
  el.style.position = 'absolute';
  el.style.zIndex = '1000';
  el.style.top = '0';
  el.style.left = '0';
  document.body.appendChild(el);
  overflowWidgetsNode = el;
  return el;
}

export function mount(host: AtlasCodeEditor): CodeEditorController {
  configureEnvironment();

  // Monaco needs a block-level container with explicit height. The
  // stub sets host.style.height pre-mount, so we just need an inner
  // wrapper Monaco can own.
  const container = document.createElement('div');
  container.style.width = '100%';
  container.style.height = '100%';
  host.appendChild(container);

  const stopMirroring = adoptMonacoStylesIntoShadow(host);

  const editor = monaco.editor.create(container, {
    value: host.getAttribute('value') ?? '',
    language: host.getAttribute('language') ?? 'typescript',
    theme: host.getAttribute('theme') ?? 'vs-dark',
    readOnly: host.hasAttribute('readonly'),
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontFamily: 'var(--atlas-font-mono)',
    fontSize: 13,
    tabSize: 2,
    fixedOverflowWidgets: true,
    overflowWidgetsDomNode: getOverflowWidgetsNode(),
  });

  return {
    getValue: () => editor.getValue(),
    setValue: (next: string) => {
      if (editor.getValue() !== next) editor.setValue(next);
    },
    applyAttribute(name: string, value: string | null): void {
      switch (name) {
        case 'value':
          if (value !== null && value !== editor.getValue()) editor.setValue(value);
          return;
        case 'language': {
          const model = editor.getModel();
          if (model) monaco.editor.setModelLanguage(model, value ?? 'plaintext');
          return;
        }
        case 'theme':
          monaco.editor.setTheme(value ?? 'vs-dark');
          return;
        case 'readonly':
          editor.updateOptions({ readOnly: value !== null });
          return;
        case 'height':
          host.style.height = value ?? '320px';
          return;
      }
    },
    dispose(): void {
      stopMirroring();
      editor.getModel()?.dispose();
      editor.dispose();
      container.remove();
    },
  };
}
