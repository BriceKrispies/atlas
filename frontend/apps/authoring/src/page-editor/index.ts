/**
 * Page Editor sandbox module — entry point.
 *
 * Importing this file:
 *   1. Registers the <sandbox-page-editor> custom element.
 *   2. Registers the five editor widgets (heading, text, kpi-tile,
 *      sparkline, data-table) into moduleDefaultRegistry so the
 *      <widget-palette> lists them and <widget-host> can mount them.
 *
 * Specimens are registered separately in `specimens.js` so the
 * registration order (specimen data → sandbox-app class load → first
 * connect) stays deterministic.
 */

import './page-editor-shell.ts';
import { registerEditorWidgets } from './editor-widgets/index.ts';

// Side effect: append the sandbox editor widgets to the default registry.
// Safe to call at module evaluation — widgets with clashing IDs would
// throw during validation; the `has()` guard inside skips duplicates.
registerEditorWidgets();

export { createMountPageEditor } from './mount.ts';
export { editorSeedPages, editorStarterPage, editorBlankPage } from './seed-pages.ts';
export { editorWidgetSchemas, editorWidgetManifests } from './editor-widgets/index.ts';
