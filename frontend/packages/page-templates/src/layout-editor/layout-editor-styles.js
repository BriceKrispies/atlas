/**
 * layout-editor-styles.js — one-shot CSS injection for <atlas-layout-editor>.
 *
 * Same pattern as editor-styles.js / dnd/styles.js: inline string, appended
 * to the host root once per root. Keeps the editor self-contained; consumers
 * don't need to import a CSS file.
 */

/* Mobile-first. Base layout stacks toolbar → canvas → panel so the editor is
 * usable on a 360px phone. At 900px (atlas-bp-md) we restore the original
 * two-column layout with the 280px properties panel on the right.
 *
 * Resize handles stay visually small on fine-pointer devices (mouse/trackpad)
 * but expand their hit area to the 44px WCAG 2.5.5 target on coarse-pointer
 * devices via a `::before` overlay. Since touch has no hover state, handles
 * are always visible there too.
 */
const CSS = `
atlas-layout-editor {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-areas:
    "toolbar"
    "canvas"
    "panel";
  gap: var(--atlas-space-md, 1rem);
  width: 100%;
  box-sizing: border-box;
}

atlas-layout-editor [data-editor-toolbar] {
  grid-area: toolbar;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--atlas-space-sm, 0.5rem);
  padding: var(--atlas-space-sm, 0.5rem);
  border: 1px solid var(--atlas-color-border, #e5e7eb);
  border-radius: var(--atlas-radius-md, 6px);
  background: var(--atlas-color-surface, #f6f7fa);
}
atlas-layout-editor [data-editor-toolbar] > [data-spacer] {
  flex: 1 1 0;
  min-width: 0;
}
atlas-layout-editor [data-editor-toolbar] atlas-input {
  flex: 1 1 160px;
  min-width: 0;
}

atlas-layout-editor [data-editor-canvas] {
  grid-area: canvas;
  position: relative;
  padding: var(--atlas-space-md, 1rem);
  border: 1px solid var(--atlas-color-border, #e5e7eb);
  border-radius: var(--atlas-radius-md, 6px);
  background: var(--atlas-color-bg, #fff);
  overflow: auto;
}

/* The canvas hosts an <atlas-layout> directly as its grid. Sections pick up
 * the editor's chrome (border, drag cursor, handles). */
atlas-layout-editor [data-editor-canvas] > atlas-layout {
  display: grid;
  width: 100%;
}
atlas-layout-editor [data-editor-canvas] > atlas-layout > section[data-slot] {
  position: relative;
  height: auto;               /* override the view-mode fixed 320px */
  overflow: visible;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  /* Consume every touch gesture ourselves — otherwise the browser steals
   * vertical drags for page scroll and the edit gesture never starts. */
  touch-action: none;
}
atlas-layout-editor [data-editor-canvas] > atlas-layout > section[data-slot]:active {
  cursor: grabbing;
}

atlas-layout-editor [data-editor-canvas] section[data-slot][data-selected="true"] {
  border-color: var(--atlas-color-primary, #3366ff);
  box-shadow: 0 0 0 2px var(--atlas-color-primary, #3366ff);
}

/* Drop target preview — a dashed outline rendered as a sibling grid cell
 * inside <atlas-layout>. It shows the snapped destination while the
 * dragged section follows the finger freely. */
atlas-layout-editor [data-drag-ghost] {
  pointer-events: none;
  border: 2px dashed var(--atlas-color-primary, #3366ff);
  border-radius: var(--atlas-radius-md, 6px);
  background: rgba(37, 99, 235, 0.08);
  z-index: 1;
}

/* Lifted look while the section is being dragged. Placed after the selected
 * rule so its compound shadow wins on source order even when a slot is both
 * selected and dragging (which it always is). */
atlas-layout-editor [data-editor-canvas] section[data-slot][data-dragging="true"] {
  z-index: 10;
  box-shadow:
    0 0 0 2px var(--atlas-color-primary, #3366ff),
    var(--atlas-shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.12));
  opacity: 0.95;
  will-change: transform;
  cursor: grabbing;
}

/* FLIP return: after the doc commits on drop, JS offsets the section with a
 * transform equal to its pre-commit visible position, then clears the
 * transform next frame. This transition smooths that release into the new
 * grid cell so the drop "settles in" instead of snapping. */
atlas-layout-editor section[data-slot][data-drop-return="true"] {
  /* Keep in sync with DROP_ANIM_MS in layout-editor-element.js. */
  transition: transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: transform;
}

/* Slot label overlaid top-left so the editor always identifies the slot. */
atlas-layout-editor [data-slot-label] {
  position: absolute;
  top: 4px;
  left: 8px;
  font-size: 0.75rem;
  color: var(--atlas-color-text-muted, #6b7280);
  background: var(--atlas-color-bg, #fff);
  padding: 2px 6px;
  border-radius: var(--atlas-radius-sm, 4px);
  pointer-events: none;
}

/* Resize handles. Right = east, bottom = south, bottom-right = corner. */
atlas-layout-editor [data-resize-handle] {
  position: absolute;
  background: var(--atlas-color-primary, #3366ff);
  opacity: 0;
  transition: opacity 0.12s;
  z-index: 2;
}
atlas-layout-editor section[data-slot]:hover [data-resize-handle],
atlas-layout-editor section[data-slot][data-selected="true"] [data-resize-handle] {
  opacity: 0.8;
}
atlas-layout-editor [data-resize-handle="e"] {
  top: 10%;
  bottom: 10%;
  right: -3px;
  width: 6px;
  cursor: ew-resize;
  border-radius: 3px;
}
atlas-layout-editor [data-resize-handle="s"] {
  left: 10%;
  right: 10%;
  bottom: -3px;
  height: 6px;
  cursor: ns-resize;
  border-radius: 3px;
}
atlas-layout-editor [data-resize-handle="se"] {
  right: -5px;
  bottom: -5px;
  width: 10px;
  height: 10px;
  cursor: nwse-resize;
  border-radius: 2px;
}

/* Properties panel. */
atlas-layout-editor [data-editor-panel] {
  grid-area: panel;
  padding: var(--atlas-space-md, 1rem);
  border: 1px solid var(--atlas-color-border, #e5e7eb);
  border-radius: var(--atlas-radius-md, 6px);
  background: var(--atlas-color-surface, #f6f7fa);
  overflow: auto;
}
atlas-layout-editor [data-editor-panel] [data-empty] {
  color: var(--atlas-color-text-muted, #6b7280);
  font-size: 0.875rem;
}
atlas-layout-editor [data-editor-panel] label {
  display: block;
  font-size: 0.75rem;
  color: var(--atlas-color-text-muted, #6b7280);
  margin-top: var(--atlas-space-sm, 0.5rem);
}
atlas-layout-editor [data-editor-panel] input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--atlas-color-border, #e5e7eb);
  border-radius: var(--atlas-radius-sm, 4px);
  box-sizing: border-box;
  font-family: inherit;
  font-size: 0.875rem;
}
atlas-layout-editor [data-editor-panel] input:focus-visible {
  outline: 2px solid var(--atlas-color-primary, #3366ff);
  outline-offset: 1px;
}
atlas-layout-editor [data-editor-panel] [data-rect-grid] {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--atlas-space-sm, 0.5rem);
}

/* Coarse-pointer (touch) devices: resize handles are always visible (no hover
 * to reveal them) and expand their hit area to meet WCAG 2.5.5 without
 * enlarging the visible rail. The ::before overlay is transparent, ≥44px in
 * every direction, and positioned so the handle sits at its centre. */
@media (hover: none) {
  atlas-layout-editor [data-resize-handle] {
    opacity: 0.8;
  }
  atlas-layout-editor [data-resize-handle]::before {
    content: "";
    position: absolute;
    inset: -19px;
  }
}

/* Tablet-landscape / laptop: restore the two-column editor layout. */
@media (min-width: 900px) {
  atlas-layout-editor {
    grid-template-columns: 1fr 280px;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "toolbar toolbar"
      "canvas  panel";
    min-height: 480px;
  }
}
`;

const _injected = new WeakSet();

export function ensureLayoutEditorStyles(elOrRoot) {
  if (typeof document === 'undefined') return;
  let root = document;
  if (elOrRoot) {
    const maybeRoot =
      typeof elOrRoot.getRootNode === 'function'
        ? elOrRoot.getRootNode()
        : elOrRoot;
    if (maybeRoot && (maybeRoot === document || maybeRoot.nodeType === 11)) {
      root = maybeRoot;
    }
  }
  if (_injected.has(root)) return;
  _injected.add(root);
  const style = document.createElement('style');
  style.setAttribute('data-atlas-layout-editor', '');
  style.textContent = CSS;
  const target = root === document ? document.head : root;
  target.appendChild(style);
}
