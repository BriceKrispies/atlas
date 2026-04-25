/**
 * Page Editor module — entry point.
 *
 * Importing this file:
 *   1. Registers the <authoring-page-editor-shell> custom element.
 *   2. Registers the five editor widgets (heading, text, kpi-tile,
 *      sparkline, data-table) into moduleDefaultRegistry so the
 *      <widget-palette> lists them and <widget-host> can mount them.
 */

import './page-editor-shell.ts';
import { registerEditorWidgets } from './editor-widgets/index.ts';

// Side effect: append the editor widgets to the default registry. Widgets
// with clashing IDs would throw during validation; the `has()` guard inside
// skips duplicates.
registerEditorWidgets();

export { createMountPageEditor } from './mount.ts';
export { editorSeedPages, editorStarterPage, editorBlankPage } from './seed-pages.ts';
export { editorWidgetSchemas, editorWidgetManifests } from './editor-widgets/index.ts';
