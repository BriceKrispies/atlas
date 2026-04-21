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
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
content-page[edit] [data-widget-cell]:active {
  cursor: grabbing;
}
content-page[edit] [data-widget-cell]:focus-visible {
  outline: 2px solid var(--atlas-color-primary, #3366ff);
}
/* Widget bodies don't receive pointer events in edit mode so the whole
   cell is a grab handle. The chrome overlay (drag-handle + delete) opts
   back in via its own pointer-events rule below. */
content-page[edit] [data-widget-cell] > *:not([data-cell-chrome]) {
  pointer-events: none;
}
/* During a pickup the source cell is removed from the visual flow — the
   ghost follows the pointer and the gap closes naturally. The drop target
   is always another widget (or an empty region), never a sliver of space. */
content-page[edit] [data-widget-cell][data-picked="true"] {
  display: none;
}
content-page[edit] [data-cell-chrome] {
  position: absolute;
  top: 4px;
  right: 4px;
  display: inline-flex;
  gap: var(--atlas-space-xs, 4px);
  z-index: 3;
  background: var(--atlas-color-bg, #fff);
  border: 1px solid var(--atlas-color-border, #ddd);
  border-radius: var(--atlas-radius-sm, 4px);
  padding: 2px;
  opacity: 0;
  transition: opacity 0.12s;
  pointer-events: none;
}
content-page[edit] [data-widget-cell]:hover [data-cell-chrome],
content-page[edit] [data-widget-cell]:focus-within [data-cell-chrome],
content-page[edit] [data-widget-cell]:focus-visible [data-cell-chrome] {
  opacity: 1;
  pointer-events: auto;
}
/* Drop targets are widget-anchored halves. Two absolute overlays per cell:
   top half = "insert before", bottom half = "insert after". Both are
   invisible until a drag is active AND the pointer is over this cell's
   corresponding half. */
content-page[edit] [data-widget-cell][data-drop-half-before],
content-page[edit] [data-widget-cell][data-drop-half-after] {
  /* marker attributes only; the ::before / ::after pseudos do the work */
}
content-page[edit] [data-widget-cell]::before,
content-page[edit] [data-widget-cell]::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 50%;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s;
  z-index: 1;
  box-sizing: border-box;
}
content-page[edit] [data-widget-cell]::before {
  top: 0;
  border-top: 3px solid var(--atlas-color-primary, #3366ff);
  background: var(--atlas-color-primary-subtle, rgba(51, 102, 255, 0.08));
}
content-page[edit] [data-widget-cell]::after {
  bottom: 0;
  border-bottom: 3px solid var(--atlas-color-primary, #3366ff);
  background: var(--atlas-color-primary-subtle, rgba(51, 102, 255, 0.08));
}
content-page[edit] [data-widget-cell][data-drop-target="before"]::before,
content-page[edit] [data-widget-cell][data-drop-target="after"]::after {
  opacity: 1;
}
content-page[edit] [data-widget-cell][data-drop-target][data-drop-invalid="true"]::before,
content-page[edit] [data-widget-cell][data-drop-target][data-drop-invalid="true"]::after {
  border-color: var(--atlas-color-danger, #dc2626);
  background: var(--atlas-color-danger-subtle, rgba(220, 38, 38, 0.1));
}
/* Empty-region drop zone — a single rectangular target filling the empty
   section. Only visible when a drag is active AND this region permits the
   picked widget (see data-drop-valid attribute). */
content-page[edit] [data-drop-empty] {
  display: block;
  min-height: 72px;
  border: 2px dashed var(--atlas-color-border, #ddd);
  background: var(--atlas-color-surface, #fafafa);
  border-radius: var(--atlas-radius-md, 6px);
  margin: var(--atlas-space-sm, 8px) 0;
  padding: var(--atlas-space-md, 12px);
  color: var(--atlas-color-text-muted, #666);
  text-align: center;
  font-size: var(--atlas-font-size-sm, 12px);
  box-sizing: border-box;
  transition: background 0.12s, border-color 0.12s;
}
content-page[edit] [data-drop-empty][data-drop-valid="true"] {
  border-color: var(--atlas-color-primary, #3366ff);
  background: var(--atlas-color-primary-subtle, rgba(51, 102, 255, 0.06));
  color: var(--atlas-color-primary, #3366ff);
}
content-page[edit] [data-drop-empty][data-drop-valid="false"] {
  border-color: var(--atlas-color-danger, #dc2626);
  background: var(--atlas-color-danger-subtle, rgba(220, 38, 38, 0.08));
  color: var(--atlas-color-danger, #dc2626);
}
content-page[edit] [data-drop-empty][data-hover="true"] {
  border-style: solid;
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
