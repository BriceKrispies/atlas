/**
 * Register every widget this bundle ships into a WidgetRegistry.
 *
 * Each widget module exports { manifest, element }. Registration
 * validates the manifest against widget_manifest.schema.json and throws
 * on failure — so a green `registerAllWidgets` is a real contract test
 * that every manifest in the bundle is well-formed (INV-WIDGET-01).
 */

import { moduleDefaultRegistry } from '@atlas/widget-host';

import * as announcements from './widgets/announcements/index.js';
import * as messaging from './widgets/messaging/index.js';
import * as uploader from './widgets/spreadsheet-uploader/index.js';

/**
 * @param {{ register: (entry: { manifest: object, element: Function }) => void }} [registry]
 */
export function registerAllWidgets(registry = moduleDefaultRegistry) {
  registry.register({ manifest: announcements.manifest, element: announcements.element });
  registry.register({ manifest: messaging.manifest, element: messaging.element });
  registry.register({ manifest: uploader.manifest, element: uploader.element });
  return registry;
}
