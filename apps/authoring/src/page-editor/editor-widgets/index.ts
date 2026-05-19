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
import { moduleDefaultRegistry, WidgetRegistry } from '@atlas/widget-host';
import type { WidgetManifest } from '@atlas/widget-host';
import { asWidgetConfigSchema } from '../widget-config.ts';
import type { EditorWidgetId, WidgetConfigSchema } from '../widget-config.ts';
import * as heading from './heading.ts';
import * as text from './text.ts';
import * as kpiTile from './kpi-tile.ts';
import * as sparkline from './sparkline.ts';
import * as dataTable from './data-table.ts';
import headingSchemaJson from './heading.config.schema.json' with { type: 'json' };
import textSchemaJson from './text.config.schema.json' with { type: 'json' };
import kpiTileSchemaJson from './kpi-tile.config.schema.json' with { type: 'json' };
import sparklineSchemaJson from './sparkline.config.schema.json' with { type: 'json' };
import dataTableSchemaJson from './data-table.config.schema.json' with { type: 'json' };
// The JSON schemas are static documents whose shape we control under
// `editor-widgets/`. They follow the typed `WidgetConfigSchema` contract
// declared in `widget-config.ts` (JSON Schema draft-07 + `x-atlas-*`
// extensions). `asWidgetConfigSchema` is the typed-factory boundary —
// validates the minimum-viable shape and concentrates the structural
// cast to one site (see widget-config.ts).
const headingSchema = asWidgetConfigSchema(headingSchemaJson);
const textSchema = asWidgetConfigSchema(textSchemaJson);
const kpiTileSchema = asWidgetConfigSchema(kpiTileSchemaJson);
const sparklineSchema = asWidgetConfigSchema(sparklineSchemaJson);
const dataTableSchema = asWidgetConfigSchema(dataTableSchemaJson);
interface EditorWidgetEntry {
    manifest: {
        readonly widgetId: EditorWidgetId;
        readonly [k: string]: unknown;
    };
    element: CustomElementConstructor;
    schema: WidgetConfigSchema;
}
const EDITOR_WIDGETS: EditorWidgetEntry[] = [
    { manifest: heading.manifest, element: heading.element, schema: headingSchema },
    { manifest: text.manifest, element: text.element, schema: textSchema },
    { manifest: kpiTile.manifest, element: kpiTile.element, schema: kpiTileSchema },
    { manifest: sparkline.manifest, element: sparkline.element, schema: sparklineSchema },
    { manifest: dataTable.manifest, element: dataTable.element, schema: dataTableSchema },
];
/**
 * Register all sandbox editor widgets into the given registry. Idempotent
 * per registry: duplicate registration throws (WidgetRegistry.register
 * uses Map.set, which silently overwrites — but the manifest validation
 * fires on every call).
 */
/**
 * Convert a sandbox-side manifest literal (declared `as const`) into the
 * `WidgetManifest` shape `WidgetRegistry.register` expects. Field-by-field
 * copy widens the `readonly` literal types and produces a structural
 * value — no boundary cast required. `validateManifest` is the runtime
 * authority on shape; this just satisfies the compile-time check.
 */
function toWidgetManifest(m: EditorWidgetEntry['manifest']): WidgetManifest {
    const out: WidgetManifest = {
        widgetId: m.widgetId,
        version: String(m['version'] ?? ''),
        displayName: String(m['displayName'] ?? ''),
        configSchema: String(m['configSchema'] ?? ''),
        isolation: String(m['isolation'] ?? 'inline') as WidgetManifest['isolation'], // eslint-disable-line @typescript-eslint/no-unsafe-type-assertion -- boundary: as-const manifest literal narrowed to one of the IsolationMode values; validateManifest re-checks at runtime
    };
    if (typeof m['description'] === 'string')
        out.description = m['description'];
    for (const [k, v] of Object.entries(m)) {
        if (!(k in out))
            out[k] = v;
    }
    return out;
}
export function registerEditorWidgets(registry: WidgetRegistry = moduleDefaultRegistry): WidgetRegistry {
    for (const w of EDITOR_WIDGETS) {
        if (registry.has(w.manifest.widgetId))
            continue;
        // `WidgetRegisterEntry.schema` is typed as `Record<string, unknown>`
        // (the registry only stores it for callers; it doesn't read the
        // typed surface). Spread the typed schema into a plain record so
        // the assignment is by-construction rather than via a cast.
        const schemaRecord: Record<string, unknown> = { ...w.schema };
        registry.register({
            manifest: toWidgetManifest(w.manifest),
            element: w.element,
            schema: schemaRecord,
        });
    }
    return registry;
}
/**
 * Schema lookup keyed by widgetId. Used by the Page Editor property
 * panel (Phase C) to resolve a widget's config schema. Returns a typed
 * `WidgetConfigSchema` (not a bare `Record<string, unknown>`) so callers
 * get first-class types for the JSON-Schema vocabulary plus `x-atlas-*`
 * extensions — see `widget-config.ts`.
 */
export const editorWidgetSchemas: Record<string, WidgetConfigSchema> = Object.fromEntries(EDITOR_WIDGETS.map(function (w) {
    return [w.manifest.widgetId, w.schema];
}));
export const editorWidgetManifests = EDITOR_WIDGETS.map(function (w) {
    return w.manifest;
});
