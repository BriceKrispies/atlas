/**
 * dnd/styles.js — minimal CSS for overlay/ghost/dragging states.
 *
 * Injected once per root (document or shadow root). Inline so the CSS is
 * guaranteed present even in environments where the bundler cannot serve
 * `.css` modules.
 */

const CSS = `
[data-dnd-source="ghost"] {
  opacity: 0.4;
  pointer-events: none;
}
[data-dnd-source="hidden"] {
  visibility: hidden;
}
[data-dnd-over="true"] {
  background: var(--atlas-color-primary-subtle, rgba(51, 102, 255, 0.12));
  border-color: var(--atlas-color-primary, #3366ff) !important;
}
[data-dnd-candidate="true"] {
  transition: background 0.12s, border-color 0.12s;
}
[data-dnd-overlay-preview] {
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
  opacity: 0.9;
  cursor: grabbing;
  border-radius: var(--atlas-radius-sm, 4px);
  background: var(--atlas-color-bg, #fff);
}
.atlas-dnd-overlay {
  contain: layout style paint;
}
`;

const _injected = new WeakSet();

export function ensureDndStyles(elOrRoot) {
  if (typeof document === 'undefined') return;
  let root = document;
  if (elOrRoot) {
    const maybeRoot =
      typeof elOrRoot.getRootNode === 'function' ? elOrRoot.getRootNode() : elOrRoot;
    if (maybeRoot && (maybeRoot === document || maybeRoot.nodeType === 11)) {
      root = maybeRoot;
    }
  }
  if (_injected.has(root)) return;
  _injected.add(root);
  const style = document.createElement('style');
  style.setAttribute('data-atlas-dnd', '');
  style.textContent = CSS;
  const target = root === document ? document.head : root;
  target.appendChild(style);
}
