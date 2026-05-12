/**
 * Discriminated union of every intent the `ChartStateStore.commit` API
 * accepts. Each variant carries exactly the fields its handler reads —
 * no `Record<string, unknown>`, no field-by-field `as string` casts.
 *
 * Consumers build a typed object and pass it whole:
 *
 *   store.commit({ kind: 'selectSeries', seriesId: 'revenue', pointIndex: 3 });
 *
 * The store's `_apply` switches on `intent.kind`; TypeScript narrows each
 * case to its specific variant.
 */

/** Edit a single field of the user-facing chart-config bag. */
export interface SetConfigIntent {
  kind: 'setConfig';
  field: string;
  value: unknown;
}

/** Mark a series (and optionally a point within it) as selected. */
export interface SelectSeriesIntent {
  kind: 'selectSeries';
  seriesId: string;
  pointIndex?: number | null;
}

/** Toggle a series's hidden-in-legend state. */
export interface ToggleSeriesIntent {
  kind: 'toggleSeries';
  seriesId: string;
  hidden: boolean;
}

/** Add/replace a filter on `field`. */
export interface SetFilterIntent {
  kind: 'setFilter';
  field: string;
  op: string;
  value: unknown;
}

/** Remove the filter on `field`. */
export interface ClearFilterIntent {
  kind: 'clearFilter';
  field: string;
}

/** Set a time-range preset, or an explicit [from, to] window. */
export interface SetTimeRangeIntent {
  kind: 'setTimeRange';
  preset?: string | null;
  from?: string | number | Date | null;
  to?: string | number | Date | null;
}

/** Push a drilldown frame onto the stack. */
export interface PushDrilldownIntent {
  kind: 'pushDrilldown';
  level: number;
  value: string;
  label?: string;
}

/** Pop drilldown frames back to (optional) target depth. */
export interface PopDrilldownIntent {
  kind: 'popDrilldown';
  toDepth?: number;
}

/** Mark an export as requested (recorded in `exportStatus`). */
export interface RequestExportIntent {
  kind: 'requestExport';
  format: string;
}

export type ChartIntent =
  | SetConfigIntent
  | SelectSeriesIntent
  | ToggleSeriesIntent
  | SetFilterIntent
  | ClearFilterIntent
  | SetTimeRangeIntent
  | PushDrilldownIntent
  | PopDrilldownIntent
  | RequestExportIntent;

export type ChartIntentKind = ChartIntent['kind'];
