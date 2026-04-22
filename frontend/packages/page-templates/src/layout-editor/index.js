/**
 * @atlas/page-templates/layout-editor — visual editor for layout docs.
 *
 * Registers `<atlas-layout-editor>` on import. Consumers typically only
 * need the side-effect, but the class is exported for type annotations
 * and for SSR / test construction paths that bypass custom-element
 * upgrade.
 */

export { AtlasLayoutEditorElement } from './layout-editor-element.js';
export { ensureLayoutEditorStyles } from './layout-editor-styles.js';
