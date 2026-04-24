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

import * as heading from './heading.ts';
import * as text from './text.ts';
import * as kpiTile from './kpi-tile.ts';
import * as sparkline from './sparkline.ts';
import * as dataTable from './data-table.ts';

import headingSchema from './heading.config.schema.json' with { type: 'json' };
import textSchema from './text.config.schema.json' with { type: 'json' };
import kpiTileSchema from './kpi-tile.config.schema.json' with { type: 'json' };
import sparklineSchema from './sparkline.config.schema.json' with { type: 'json' };
import dataTableSchema from './data-table.config.schema.json' with { type: 'json' };

interface EditorWidgetEntry {
  manifest: { widgetId: string; [k: string]: unknown };
  element: CustomElementConstructor;
  schema: Record<string, unknown>;
}

interface EditorWidgetRegistry {
  register: (entry: { manifest: unknown; element: CustomElementConstructor; schema: unknown }) => void;
  has?: (widgetId: string) => boolean;
}

const EDITOR_WIDGETS: EditorWidgetEntry[] = [
  { manifest: heading.manifest, element: heading.element, schema: headingSchema as Record<string, unknown> },
  { manifest: text.manifest, element: text.element, schema: textSchema as Record<string, unknown> },
  { manifest: kpiTile.manifest, element: kpiTile.element, schema: kpiTileSchema as Record<string, unknown> },
  { manifest: sparkline.manifest, element: sparkline.element, schema: sparklineSchema as Record<string, unknown> },
  { manifest: dataTable.manifest, element: dataTable.element, schema: dataTableSchema as Record<string, unknown> },
];

/**
 * Register all sandbox editor widgets into the given registry. Idempotent
 * per registry: duplicate registration throws (WidgetRegistry.register
 * uses Map.set, which silently overwrites — but the manifest validation
 * fires on every call).
 */
export function registerEditorWidgets(
  registry: EditorWidgetRegistry = moduleDefaultRegistry as unknown as EditorWidgetRegistry,
): EditorWidgetRegistry {
  for (const w of EDITOR_WIDGETS) {
    if (registry.has?.(w.manifest.widgetId)) continue;
    registry.register({ manifest: w.manifest, element: w.element, schema: w.schema });
  }
  return registry;
}

/**
 * Schema lookup keyed by widgetId. Used by the Page Editor property
 * panel (Phase C) to resolve a widget's config schema.
 */
export const editorWidgetSchemas: Record<string, Record<string, unknown>> = Object.fromEntries(
  EDITOR_WIDGETS.map((w) => [w.manifest.widgetId, w.schema]),
);

export const editorWidgetManifests = EDITOR_WIDGETS.map((w) => w.manifest);
