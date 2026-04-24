/**
 * @atlas/page-templates — public entry point.
 *
 * Importing this module registers the <content-page> and <widget-palette>
 * custom elements as a side effect. <widget-host> is transitively registered
 * by content-page-element.js.
 */

import { AtlasElement } from '@atlas/core';
import { ContentPageElement } from './content-page-element.js';
import { WidgetPaletteElement } from './editor/widget-palette.js';
// Side-effect imports so `<atlas-layout>` and `<atlas-layout-editor>`
// are registered as soon as the package loads.
import './layout/layout-element.js';
import './layout-editor/layout-editor-element.js';
import './block-editor/index.js';

export { TemplateRegistry, moduleDefaultTemplateRegistry } from './registry.js';
export { validateTemplateManifest } from './manifest.js';
export { validatePageDocument } from './document.js';
export { InMemoryPageStore, ValidatingPageStore } from './page-store.js';
export { ContentPageElement } from './content-page-element.js';
export { computeValidTargets } from './drop-zones.js';
export { EditorController } from './editor/editor-controller.js';
export { EditorAPI, freshInstanceId } from './editor/editor-api.js';
export { WidgetPaletteElement } from './editor/widget-palette.js';
export * as dnd from './dnd/index.js';
export * as layout from './layout/index.js';
export {
  AtlasLayoutElement,
  validateLayoutDocument,
  cloneLayoutDocument,
  emptyLayoutDocument,
  nextFreeRect,
  InMemoryLayoutStore,
  ValidatingLayoutStore,
  LayoutRegistry,
  moduleDefaultLayoutRegistry,
  presetLayouts,
} from './layout/index.js';
export { AtlasLayoutEditorElement } from './layout-editor/layout-editor-element.js';
export { ensureLayoutEditorStyles } from './layout-editor/layout-editor-styles.js';
export {
  BlockEditorController,
  AtlasBlockEditor,
  AtlasBlock,
  AtlasEditorToolbar,
  freshBlockId,
} from './block-editor/index.js';
export * from './errors.js';

if (typeof customElements !== 'undefined') {
  AtlasElement.define('content-page', ContentPageElement);
  AtlasElement.define('widget-palette', WidgetPaletteElement);
}
