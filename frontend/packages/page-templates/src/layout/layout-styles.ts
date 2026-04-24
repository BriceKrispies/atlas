/**
 * layout-styles.ts — one-shot CSS injection for <atlas-layout>.
 *
 * Mirrors the pattern used by `editor-styles.ts` and `dnd/styles.ts`: the
 * base layout chrome is inlined as a string and appended to whichever
 * root (document or shadow) the element lives in, once per root.
 *
 * Per-instance grid settings (column count, row height, gap) and per-slot
 * positions (grid-column / grid-row) are written as inline style on the
 * element + each section so a single layout document can drive a unique
 * grid without emitting per-layout CSS.
 */

const CSS = `
atlas-layout {
  display: grid;
  width: 100%;
  box-sizing: border-box;
}
atlas-layout > widget-host {
  display: contents;
}
atlas-layout > widget-host > section[data-slot] {
  /* Template CSS in @atlas/bundle-standard already pins the slot to a
     fixed footprint (height, overflow, border). <atlas-layout> does not
     override that — it only sets grid placement inline on each section. */
}
`;

const _injected: WeakSet<Document | ShadowRoot> = new WeakSet();

export function ensureLayoutStyles(elOrRoot?: Node | null): void {
  if (typeof document === 'undefined') return;
  let root: Document | ShadowRoot = document;
  if (elOrRoot) {
    const maybeRoot =
      typeof (elOrRoot as Node).getRootNode === 'function'
        ? (elOrRoot as Node).getRootNode()
        : (elOrRoot as unknown as Node);
    if (maybeRoot && (maybeRoot === document || (maybeRoot as Node).nodeType === 11)) {
      root = maybeRoot as Document | ShadowRoot;
    }
  }
  if (_injected.has(root)) return;
  _injected.add(root);
  const style = document.createElement('style');
  style.setAttribute('data-atlas-layout', '');
  style.textContent = CSS;
  const target: Node = root === document ? document.head : root;
  target.appendChild(style);
}
