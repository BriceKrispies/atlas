/**
 * Register every widget and template this bundle ships.
 *
 * Each widget module exports { manifest, element }. Registration
 * validates the manifest against widget_manifest.schema.json and throws
 * on failure — so a green `registerAllWidgets` is a real contract test
 * that every manifest in the bundle is well-formed (INV-WIDGET-01).
 *
 * Each template module exports { manifest, element }. Registration
 * validates the manifest against page_template.schema.json and throws
 * on failure (INV-TEMPLATE-01).
 *
 * Template modules are imported directly here (not via the
 * `./templates/index.js` barrel) so this file is safe to import from
 * node-based tests that cannot resolve CSS imports. Apps that need the
 * shared layout CSS should import the `./templates/index.js` barrel
 * from a browser entry point.
 */

import { moduleDefaultRegistry } from '@atlas/widget-host';
import { moduleDefaultTemplateRegistry } from '@atlas/page-templates';

import * as announcements from './widgets/announcements/index.js';
import * as messaging from './widgets/messaging/index.js';
import * as uploader from './widgets/spreadsheet-uploader/index.js';

import * as oneColumn from './templates/one-column/index.js';
import * as twoColumn from './templates/two-column/index.js';

/**
 * @param {{ register: (entry: { manifest: object, element: Function }) => void }} [registry]
 */
export function registerAllWidgets(registry = moduleDefaultRegistry) {
  registry.register({ manifest: announcements.manifest, element: announcements.element });
  registry.register({ manifest: messaging.manifest, element: messaging.element });
  registry.register({ manifest: uploader.manifest, element: uploader.element });
  return registry;
}

/**
 * @param {{ register: (entry: { manifest: object, element: Function }) => void }} [registry]
 */
export function registerAllTemplates(registry = moduleDefaultTemplateRegistry) {
  registry.register({ manifest: oneColumn.manifest, element: oneColumn.element });
  registry.register({ manifest: twoColumn.manifest, element: twoColumn.element });
  return registry;
}
