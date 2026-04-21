/**
 * editor-styles.js — guaranteed injection of editor chrome styles.
 *
 * Dynamic `import('./editor.css')` is bundler-dependent and fails silently
 * in environments where CSS modules aren't wired up. This module ships the
 * same rules inline and appends a <style data-atlas-page-templates-editor>
 * to the target root (document or shadow root). Idempotent per root.
 */

const CSS = `
content-page[edit] .content-page-edit-layout {
  display: grid;
  grid-template-columns: 1fr 260px;
  gap: var(--atlas-space-md, 1rem);
  align-items: start;
}
@media (max-width: 900px) {
  content-page[edit] .content-page-edit-layout {
    grid-template-columns: 1fr;
  }
}
content-page[edit] [data-widget-cell] {
  position: relative;
  outline-offset: 2px;
  transition: outline-color var(--atlas-transition-fast, 0.12s);
}
content-page[edit] [data-widget-cell]:focus-visible {
  outline: 2px solid var(--atlas-color-primary, #3366ff);
}
content-page[edit] [data-widget-cell][data-picked="true"] {
  outline: 2px dashed var(--atlas-color-primary, #3366ff);
  opacity: 0.7;
}
content-page[edit] [data-cell-chrome] {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  gap: var(--atlas-space-xs, 4px);
  z-index: 2;
  background: var(--atlas-color-bg, #fff);
  border: 1px solid var(--atlas-color-border, #ddd);
  border-radius: var(--atlas-radius-sm, 4px);
  padding: 2px;
}
/* Drop indicators are always visible in edit mode — every insertion
   slot shows as a thin off-white bar so authors can see where widgets
   will land without needing to start a drag. Size is fixed so layout
   doesn't jump at pickup; only color changes during drag. */
content-page[edit] [data-drop-indicator] {
  display: block;
  height: 32px;
  margin: 6px 0;
  border-radius: 4px;
  background: var(--atlas-color-surface, #f4f4f4);
  border: 1px dotted var(--atlas-color-border, #ddd);
  box-sizing: border-box;
  transition: background 0.12s, border-color 0.12s;
}
content-page[edit] [data-drop-indicator][data-valid="true"] {
  border: 1px dotted var(--atlas-color-border-strong, #bbb);
  cursor: pointer;
}
content-page[edit] [data-drop-indicator][data-valid="false"] {
  background: var(--atlas-color-danger-subtle, #fee2e2);
  border: 1px dotted var(--atlas-color-danger, #dc2626);
}
content-page[edit] [data-drop-indicator][data-hover="true"] {
  background: var(--atlas-color-surface-hover, #ececec);
  border: 1px dotted var(--atlas-color-primary, #3366ff);
}
content-page[edit] [data-drop-indicator]:focus-visible {
  outline: 2px solid var(--atlas-color-primary, #3366ff);
  outline-offset: 1px;
}
widget-palette {
  display: block;
  border: 1px solid var(--atlas-color-border, #ddd);
  border-radius: var(--atlas-radius-md, 6px);
  padding: var(--atlas-space-sm, 8px);
  background: var(--atlas-color-surface, #fafafa);
}
widget-palette [data-palette-list] {
  display: flex;
  flex-direction: column;
  gap: var(--atlas-space-xs, 4px);
}
widget-palette atlas-button[data-widget-id] {
  display: block;
  width: 100%;
}
content-page[edit] [data-drag-ghost] {
  position: fixed;
  pointer-events: none;
  opacity: 0.85;
  z-index: 1000;
  transform: translate(-50%, -50%);
  border: 1px dashed var(--atlas-color-primary, #3366ff);
  background: var(--atlas-color-bg, #fff);
  padding: 6px 10px;
  border-radius: var(--atlas-radius-sm, 4px);
  font-size: var(--atlas-font-size-sm, 12px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
content-page[edit] [data-editor-toast] {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1001;
  background: var(--atlas-color-primary, #3366ff);
  color: #fff;
  padding: 8px 14px;
  border-radius: 4px;
  font-size: 14px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  max-width: 80vw;
}
content-page[edit] [data-editor-toast][data-variant="error"] {
  background: var(--atlas-color-danger, #dc2626);
}
`;

const _injectedRoots = new WeakSet();

/**
 * Inject editor styles into the correct scope. CSS in document.head does NOT
 * cross shadow-DOM boundaries, so we need to append a <style> into whichever
 * root the content-page element lives in. Accepts the content-page element
 * (or any descendant) and injects into its root node.
 */
export function ensureEditorStyles(elOrRoot) {
  if (typeof document === 'undefined') return;
  let root = document;
  if (elOrRoot) {
    const maybeRoot =
      typeof elOrRoot.getRootNode === 'function' ? elOrRoot.getRootNode() : elOrRoot;
    if (maybeRoot && (maybeRoot === document || maybeRoot.nodeType === 11)) {
      root = maybeRoot;
    }
  }
  if (_injectedRoots.has(root)) return;
  _injectedRoots.add(root);
  const style = document.createElement('style');
  style.setAttribute('data-atlas-page-templates-editor', '');
  style.textContent = CSS;
  // Document → append to <head>; ShadowRoot → append directly.
  const target = root === document ? document.head : root;
  target.appendChild(style);
}
