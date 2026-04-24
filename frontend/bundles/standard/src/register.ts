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
 * `./templates/index.ts` barrel) so this file is safe to import from
 * node-based tests that cannot resolve CSS imports. Apps that need the
 * shared layout CSS should import the `./templates/index.ts` barrel
 * from a browser entry point.
 */

import { moduleDefaultRegistry, type WidgetRegistry } from '@atlas/widget-host';
import {
  moduleDefaultTemplateRegistry,
  type TemplateRegistry,
} from '@atlas/page-templates';

import * as announcements from './widgets/announcements/index.ts';
import * as messaging from './widgets/messaging/index.ts';
import * as uploader from './widgets/spreadsheet-uploader/index.ts';

import * as oneColumn from './templates/one-column/index.ts';
import * as twoColumn from './templates/two-column/index.ts';
import * as threeColumn from './templates/three-column/index.ts';
import * as headerMainFooter from './templates/header-main-footer/index.ts';
import * as heroAndGrid from './templates/hero-and-grid/index.ts';
import * as dashboardTiles from './templates/dashboard-tiles/index.ts';

export function registerAllWidgets(
  registry: WidgetRegistry = moduleDefaultRegistry,
): WidgetRegistry {
  registry.register({ manifest: announcements.manifest, element: announcements.element });
  registry.register({ manifest: messaging.manifest, element: messaging.element });
  registry.register({ manifest: uploader.manifest, element: uploader.element });
  return registry;
}

export function registerAllTemplates(
  registry: TemplateRegistry = moduleDefaultTemplateRegistry,
): TemplateRegistry {
  registry.register({ manifest: oneColumn.manifest, element: oneColumn.element });
  registry.register({ manifest: twoColumn.manifest, element: twoColumn.element });
  registry.register({ manifest: threeColumn.manifest, element: threeColumn.element });
  registry.register({ manifest: headerMainFooter.manifest, element: headerMainFooter.element });
  registry.register({ manifest: heroAndGrid.manifest, element: heroAndGrid.element });
  registry.register({ manifest: dashboardTiles.manifest, element: dashboardTiles.element });
  return registry;
}
