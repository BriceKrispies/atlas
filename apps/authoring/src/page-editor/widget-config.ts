/**
 * Typed widget configs + JSON-Schema-with-extensions for the page editor.
 *
 * The page editor consumes two kinds of widget shape:
 *
 *   1. The runtime config that a widget instance carries on the page document
 *      (`{ widgetId, instanceId, region, config }`). Each widget has its own
 *      config shape — see the per-widget files under `editor-widgets/`.
 *
 *   2. The JSON Schema document that drives the property panel. Each schema
 *      ships in `editor-widgets/<widget>.config.schema.json` and follows
 *      JSON Schema draft-07 with five `x-atlas-*` extension keys documented
 *      in `editor-widgets/_schema-extensions.md`.
 *
 * Historically the page editor read schemas as `Record<string, unknown>` and
 * cast individual fields (`as string`, `as string[]`, `as WhenClause`) at
 * every read site. That hides bugs and lights up `no-unsafe-type-assertion`
 * across the inspector/property-panel codepaths.
 *
 * This module replaces that with:
 *
 *   - `WidgetConfigSchema` — typed root schema describing both the standard
 *     JSON-Schema vocabulary the inspector cares about (properties, type,
 *     title, enum, default, items) AND the `x-atlas-*` extensions as
 *     first-class typed fields. Property-panel and inspector consume this
 *     type directly — no field-level casts.
 *
 *   - `WidgetConfigSchemaProperty` — same idea for nested property schemas.
 *
 *   - `WidgetConfig` — discriminated union of `(widgetId, config)` pairs for
 *     every widget the sandbox bundle ships. Used by the property panel's
 *     `onChange` and inspector's preset/copy/paste flows. Adding a widget
 *     without an arm is a compile error (per the brief).
 */

import type {
  HeadingWidgetConfig,
} from './editor-widgets/heading.ts';
import type {
  TextWidgetConfig,
} from './editor-widgets/text.ts';
import type {
  KpiTileWidgetConfig,
} from './editor-widgets/kpi-tile.ts';
import type {
  SparklineWidgetConfig,
} from './editor-widgets/sparkline.ts';
import type {
  DataTableWidgetConfig,
} from './editor-widgets/data-table.ts';

// ---- typed schema (JSON Schema + x-atlas-*) ----------------------------------

/** JSON Schema `type` values the property panel recognises. */
export type WidgetConfigSchemaType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object';

/**
 * Control-type override for `x-atlas-control`. Drives which control the
 * property panel renders instead of inferring from `type`/`enum`.
 */
export type WidgetConfigSchemaControl =
  | 'textarea'
  | 'select'
  | 'chips'
  | 'color'
  | 'csv';

/**
 * Single-field equality clause used by `x-atlas-when`. The dependent field
 * is rendered only when the sibling `field` equals (or is in) `equals`.
 */
export interface WidgetConfigSchemaWhenClause {
  field: string;
  equals: unknown;
}

/**
 * Section descriptor produced from `x-atlas-section-order`. `defaultOpen`
 * is normalised to a boolean here so callers don't have to.
 */
export interface WidgetConfigSchemaSectionDescriptor {
  id: string;
  label: string;
  defaultOpen: boolean;
}

/**
 * Raw section-order entry as it appears in the JSON file. `defaultOpen` is
 * optional in the JSON; the parsed `WidgetConfigSchemaSectionDescriptor`
 * applies a default.
 */
export interface WidgetConfigSchemaSectionEntry {
  id: string;
  label?: string;
  defaultOpen?: boolean;
}

/**
 * Preset entry as it appears under `x-atlas-presets`. The `config` is a
 * partial widget config shallow-merged onto the current instance config.
 */
export interface WidgetConfigSchemaPreset {
  id: string;
  label: string;
  description?: string;
  config: Record<string, unknown>;
}

/**
 * Per-property schema fragment. Mirrors the JSON Schema subset the property
 * panel uses plus the `x-atlas-*` extension fields documented in
 * `_schema-extensions.md`.
 */
export interface WidgetConfigSchemaProperty {
  type?: WidgetConfigSchemaType;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: ReadonlyArray<unknown>;
  /** Nested item schema for `type: 'array'`. */
  items?: WidgetConfigSchemaProperty;
  /** Nested property schemas for `type: 'object'`. */
  properties?: Record<string, WidgetConfigSchemaProperty>;
  required?: ReadonlyArray<string>;
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;

  // ---- x-atlas-* extensions ----
  'x-atlas-section'?: string;
  'x-atlas-control'?: WidgetConfigSchemaControl;
  'x-atlas-when'?: WidgetConfigSchemaWhenClause;
}

/**
 * Root widget-config schema. Same field set as `WidgetConfigSchemaProperty`
 * plus the schema-level extensions (`x-atlas-section-order`,
 * `x-atlas-presets`) that only make sense at the document root.
 */
export interface WidgetConfigSchema extends WidgetConfigSchemaProperty {
  $id?: string;
  $schema?: string;
  'x-atlas-section-order'?: ReadonlyArray<WidgetConfigSchemaSectionEntry>;
  'x-atlas-presets'?: ReadonlyArray<WidgetConfigSchemaPreset>;
}

// ---- discriminated widget-config union --------------------------------------

/**
 * All widget ids the sandbox editor knows about. Adding a widget without
 * extending this union is a compile error inside `WidgetConfig`.
 */
export type EditorWidgetId =
  | 'sandbox.heading'
  | 'sandbox.text'
  | 'sandbox.kpi-tile'
  | 'sandbox.sparkline'
  | 'sandbox.data-table';

/**
 * Discriminated union of every (widgetId, config) pair the editor can carry.
 * Use this in handler/onChange signatures so adding a widget without a
 * matching arm fails to compile.
 */
export type WidgetConfig =
  | { widgetId: 'sandbox.heading'; config: HeadingWidgetConfig }
  | { widgetId: 'sandbox.text'; config: TextWidgetConfig }
  | { widgetId: 'sandbox.kpi-tile'; config: KpiTileWidgetConfig }
  | { widgetId: 'sandbox.sparkline'; config: SparklineWidgetConfig }
  | { widgetId: 'sandbox.data-table'; config: DataTableWidgetConfig };

/**
 * Map from widget id → its config type. Useful when the discriminated union
 * is awkward (e.g. you have just the id at the type level).
 */
export interface WidgetConfigMap {
  'sandbox.heading': HeadingWidgetConfig;
  'sandbox.text': TextWidgetConfig;
  'sandbox.kpi-tile': KpiTileWidgetConfig;
  'sandbox.sparkline': SparklineWidgetConfig;
  'sandbox.data-table': DataTableWidgetConfig;
}

// Re-export the per-widget config types so consumers can `import {
// HeadingWidgetConfig } from '../widget-config.ts'` without reaching into
// the individual widget files.
export type {
  HeadingWidgetConfig,
  TextWidgetConfig,
  KpiTileWidgetConfig,
  SparklineWidgetConfig,
  DataTableWidgetConfig,
};

/** Type-predicate guard for `Record<string, unknown>`. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Boundary helper: load a JSON-imported widget config schema. JSON
 * `import x from './foo.json' with { type: 'json' }` produces an
 * inferred deeply-readonly literal whose structural type is too
 * narrow to be usefully `satisfies`-checked against
 * `WidgetConfigSchema`. The schema files under `editor-widgets/` are
 * static documents we own; this helper concentrates the boundary cast
 * to one site so the rest of the editor consumes typed values.
 *
 * The body validates the minimum-viable shape (`type === 'object'`
 * + a `properties` record) so a malformed schema fails fast at boot
 * instead of mid-render. The single justified cast at the bottom
 * widens to the typed surface — this is the legitimate JSON-import
 * boundary.
 */
export function asWidgetConfigSchema(raw: unknown): WidgetConfigSchema {
  if (!isRecord(raw)) {
    throw new Error('widget config schema: not an object');
  }
  if (raw['type'] !== 'object') {
    throw new Error('widget config schema: top-level type must be "object"');
  }
  const properties = raw['properties'];
  if (properties !== undefined && !isRecord(properties)) {
    throw new Error('widget config schema: properties must be an object when present');
  }
  // The minimum-viable shape is verified; the schema files are
  // committed JSON we own. Concentrate the structural cast here.
  // eslint-disable-next-line atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion -- boundary: JSON-schema-fixture-imported-as-known-type
  return raw as unknown as WidgetConfigSchema;
}
