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

export { AtlasLayoutElement } from './layout-element.ts';
export { ensureLayoutStyles } from './layout-styles.ts';
export {
  validateLayoutDocument,
  cloneLayoutDocument,
  emptyLayoutDocument,
  nextFreeRect,
} from './layout-document.ts';
export type {
  LayoutDocument,
  LayoutGrid,
  LayoutSlot,
  LayoutValidationError,
  LayoutValidationResult,
  EmptyLayoutDocumentArgs,
  RectSize,
  FreeRect,
} from './layout-document.ts';
export { InMemoryLayoutStore, ValidatingLayoutStore } from './layout-store.ts';
export type { LayoutStore } from './layout-store.ts';
export {
  LayoutRegistry,
  moduleDefaultLayoutRegistry,
} from './layout-registry.ts';
export { presetLayouts } from './presets/index.ts';
