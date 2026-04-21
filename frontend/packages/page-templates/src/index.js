/**
 * @atlas/page-templates — public entry point.
 *
 * Importing this module registers the <content-page> custom element as
 * a side effect. <widget-host> is also transitively registered by
 * content-page-element.js.
 */

import { AtlasElement } from '@atlas/core';
import { ContentPageElement } from './content-page-element.js';
import { WidgetPaletteElement } from './editor/widget-palette.js';

export { TemplateRegistry, moduleDefaultTemplateRegistry } from './registry.js';
export { validateTemplateManifest } from './manifest.js';
export { validatePageDocument } from './document.js';
export { InMemoryPageStore, ValidatingPageStore } from './page-store.js';
export { ContentPageElement } from './content-page-element.js';
export { computeValidTargets } from './drop-zones.js';
export { EditorController } from './editor/editor-controller.js';
export { WidgetPaletteElement } from './editor/widget-palette.js';
export * from './errors.js';

if (typeof customElements !== 'undefined') {
  AtlasElement.define('content-page', ContentPageElement);
  // widget-palette self-registers at import time via its own module.
  // Re-assert here so the public-entry import is sufficient.
  AtlasElement.define('widget-palette', WidgetPaletteElement);
}
