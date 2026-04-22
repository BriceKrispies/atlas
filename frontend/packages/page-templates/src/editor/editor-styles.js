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

/* ------- cells ------- */

content-page[edit] [data-widget-cell] {
  position: relative;
  outline-offset: 2px;
  transition: outline-color var(--atlas-transition-fast, 0.12s);
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
}
content-page[edit] [data-widget-cell]:active {
  cursor: grabbing;
}
content-page[edit] [data-widget-cell]:focus-visible {
  outline: 2px solid var(--atlas-color-primary, #3366ff);
}
content-page[edit] [data-widget-cell][data-selected="true"] {
  outline: 2px solid var(--atlas-color-primary, #3366ff);
  outline-offset: 2px;
}
/* Widget bodies don't receive pointer events in edit mode so clicks land
   on the cell itself. The chrome overlay opts back in. */
content-page[edit] [data-widget-cell] > *:not([data-cell-chrome]) {
  pointer-events: none;
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
  opacity: 0.4;
  transition: opacity 0.12s;
  pointer-events: auto;
}
content-page[edit] [data-widget-cell]:hover [data-cell-chrome],
content-page[edit] [data-widget-cell]:focus-within [data-cell-chrome],
content-page[edit] [data-widget-cell][data-selected="true"] [data-cell-chrome] {
  opacity: 1;
}

/* ------- template slots — edit-only overlays -------
 *
 * The slot's size/border/padding/background are defined in the template
 * stylesheet so view mode and edit mode look identical at the slot level.
 * Edit mode only adds drag/drop indicators on top: empty-state dashed
 * border, drop highlight, active/invalid markers.
 */

content-page[edit] section[data-editor-slot] {
  transition: background 0.12s, border-color 0.12s;
}

/* Empty slots: swap the plain border for a dashed drop target with helper text. */
content-page[edit] section[data-editor-slot][data-empty="true"] {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--atlas-color-surface, #f6f7fa);
  border: 2px dashed var(--atlas-color-border, #cbd5e1);
  color: var(--atlas-color-text-muted, #6b7280);
  font-size: 0.875rem;
  cursor: copy;
}
content-page[edit] section[data-editor-slot][data-empty="true"]::before {
  content: "Empty slot — drop a widget here";
}
content-page[edit] section[data-editor-slot][data-empty="true"]:hover,
content-page[edit] section[data-editor-slot][data-empty="true"]:focus-visible {
  background: var(--atlas-color-surface-strong, #eef0f4);
  border-color: var(--atlas-color-border-strong, #94a3b8);
  color: var(--atlas-color-text, #111827);
}
content-page[edit] section[data-editor-slot][data-empty="true"]:focus-visible {
  outline: 2px solid var(--atlas-color-primary, #3366ff);
  outline-offset: 2px;
}

/* Active (matching the current click/keyboard selection). */
content-page[edit] section[data-editor-slot][data-empty="true"][data-active="true"] {
  background: var(--atlas-color-primary-subtle, rgba(51, 102, 255, 0.06));
  border-color: var(--atlas-color-primary, #3366ff);
}
content-page[edit] section[data-editor-slot][data-empty="true"][data-invalid="true"] {
  background: transparent;
  border-color: var(--atlas-color-danger-subtle, rgba(220, 38, 38, 0.4));
  opacity: 0.6;
}

/* Pointer-drag hover state (set by the DnD subsystem's projection). */
content-page[edit] section[data-editor-slot][data-empty="true"][data-dnd-over="true"] {
  background: var(--atlas-color-primary-subtle, rgba(51, 102, 255, 0.12));
  border-color: var(--atlas-color-primary, #3366ff);
  border-style: solid;
}
content-page[edit] [data-widget-cell][data-dnd-source] {
  opacity: 0.4;
}

/* ------- palette ------- */

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
widget-palette [data-palette-chip] {
  display: block;
  width: 100%;
  cursor: grab;
}
widget-palette [data-palette-chip][data-selected="true"] {
  outline: 2px solid var(--atlas-color-primary, #3366ff);
  outline-offset: 2px;
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
  const target = root === document ? document.head : root;
  target.appendChild(style);
}
