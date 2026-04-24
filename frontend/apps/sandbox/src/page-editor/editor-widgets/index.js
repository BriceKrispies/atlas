/**
 * Sandbox editor widgets — registry entry point.
 *
 * Registers five small widgets against the widget-host registry so the
 * Page Editor's palette lists them and widget-host can mount them by
 * widgetId. Each widget is a thin wrapper around an existing atlas
 * element whose config the property panel (Phase C) will drive via the
 * per-widget JSON Schema.
 *
 * These widgets live in the sandbox app only — they wrap design
 * primitives in a way that's useful for demos but not fit for a
 * production registry. Promotion to a shared bundle can happen later.
 */

import { moduleDefaultRegistry } from '@atlas/widget-host';

import * as heading from './heading.js';
import * as text from './text.js';
import * as kpiTile from './kpi-tile.js';
import * as sparkline from './sparkline.js';
import * as dataTable from './data-table.js';

import headingSchema from './heading.config.schema.json' with { type: 'json' };
import textSchema from './text.config.schema.json' with { type: 'json' };
import kpiTileSchema from './kpi-tile.config.schema.json' with { type: 'json' };
import sparklineSchema from './sparkline.config.schema.json' with { type: 'json' };
import dataTableSchema from './data-table.config.schema.json' with { type: 'json' };

const EDITOR_WIDGETS = [
  { ...heading, schema: headingSchema },
  { ...text, schema: textSchema },
  { ...kpiTile, schema: kpiTileSchema },
  { ...sparkline, schema: sparklineSchema },
  { ...dataTable, schema: dataTableSchema },
];

/**
 * Register all sandbox editor widgets into the given registry. Idempotent
 * per registry: duplicate registration throws (WidgetRegistry.register
 * uses Map.set, which silently overwrites — but the manifest validation
 * fires on every call).
 *
 * @param {{ register: (entry: { manifest: object, element: Function }) => void }} [registry]
 */
export function registerEditorWidgets(registry = moduleDefaultRegistry) {
  for (const w of EDITOR_WIDGETS) {
    if (registry.has?.(w.manifest.widgetId)) continue;
    registry.register({ manifest: w.manifest, element: w.element, schema: w.schema });
  }
  return registry;
}

/**
 * Schema lookup keyed by widgetId. Used by the Page Editor property
 * panel (Phase C) to resolve a widget's config schema.
 *
 * @type {Record<string, object>}
 */
export const editorWidgetSchemas = Object.fromEntries(
  EDITOR_WIDGETS.map((w) => [w.manifest.widgetId, w.schema]),
);

export const editorWidgetManifests = EDITOR_WIDGETS.map((w) => w.manifest);
