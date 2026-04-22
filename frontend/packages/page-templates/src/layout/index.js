/**
 * @atlas/page-templates/layout — data-driven layout engine.
 *
 * Public surface:
 *   - `<atlas-layout>` custom element (side-effect registered on import)
 *   - `LayoutDocument` shape + `validateLayoutDocument` / helpers
 *   - `InMemoryLayoutStore` / `ValidatingLayoutStore`
 *   - `LayoutRegistry` + `moduleDefaultLayoutRegistry`
 *   - `presetLayouts` (the six built-in presets)
 */

export { AtlasLayoutElement } from './layout-element.js';
export { ensureLayoutStyles } from './layout-styles.js';
export {
  validateLayoutDocument,
  cloneLayoutDocument,
  emptyLayoutDocument,
  nextFreeRect,
} from './layout-document.js';
export { InMemoryLayoutStore, ValidatingLayoutStore } from './layout-store.js';
export {
  LayoutRegistry,
  moduleDefaultLayoutRegistry,
} from './layout-registry.js';
export { presetLayouts } from './presets/index.js';
