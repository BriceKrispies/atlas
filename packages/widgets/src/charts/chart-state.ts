import { signal, effect, batch, type Signal, type EffectCleanup } from '@atlas/core';
import { makeCommit, type CommitRecord } from '@atlas/test-state';

import type { PointX, Series } from './data-normalize.ts';
import type { ChartIntent } from './chart-intents.ts';

export type { ChartIntent } from './chart-intents.ts';

export interface ChartConfig {
  [field: string]: unknown;
  type?: string;
}

export interface ChartDataSetSeries extends Series {
  id?: string;
}

export interface ChartDataSet {
  series?: ChartDataSetSeries[];
  slices?: Array<{ label: string; value: number; color?: string }>;
  [key: string]: unknown;
}

export interface ChartSelection {
  seriesId: string;
  pointIndex: number | null;
}

export interface ChartFilter {
  field: string;
  op: string;
  value: unknown;
}

export interface ChartTimeRange {
  preset?: string | null;
  from?: string | number | Date | null;
  to?: string | number | Date | null;
}

export interface DrilldownFrame {
  level: number;
  label?: string;
  value: string;
}

export interface ChartExportStatus {
  format: string;
  at: number;
}

export interface ChartStateInitial {
  config?: ChartConfig;
  data?: ChartDataSet | null;
  drilldowns?: Record<string, ChartDataSet>;
}

export interface ChartStateSnapshot {
  chartId: string;
  config: ChartConfig;
  data: ChartDataSet | null;
  selection: ChartSelection | null;
  filters: ChartFilter[];
  timeRange: ChartTimeRange | null;
  hiddenSeries: string[];
  drilldownStack: DrilldownFrame[];
  exportStatus: ChartExportStatus | null;
  lastCommit: CommitRecord | null;
}

/**
 * ChartStateStore — the committed-state contract for charts.
 */
export class ChartStateStore {
  chartId: string;

  _config: Signal<ChartConfig>;
  _rawData: Signal<ChartDataSet | null>;
  _selection: Signal<ChartSelection | null>;
  _filters: Signal<ChartFilter[]>;
  _timeRange: Signal<ChartTimeRange | null>;
  _hiddenSeries: Signal<Set<string>>;
  _drilldownStack: Signal<DrilldownFrame[]>;
  _exportStatus: Signal<ChartExportStatus | null>;
  _lastCommit: Signal<CommitRecord | null>;

  _drilldowns: Record<string, ChartDataSet>;

  _derivedData: Signal<ChartDataSet | null>;
  _disposeDerive: EffectCleanup | null;

  constructor(chartId: string, initial: ChartStateInitial = {}) {
    this.chartId = chartId;

    this._config = signal<ChartConfig>({ ...(initial.config ?? {}) });
    this._rawData = signal<ChartDataSet | null>(initial.data ?? null);
    this._selection = signal<ChartSelection | null>(null);
    this._filters = signal<ChartFilter[]>([]);
    this._timeRange = signal<ChartTimeRange | null>(null);
    this._hiddenSeries = signal<Set<string>>(new Set());
    this._drilldownStack = signal<DrilldownFrame[]>([]);
    this._exportStatus = signal<ChartExportStatus | null>(null);
    this._lastCommit = signal<CommitRecord | null>(null);

    this._drilldowns = initial.drilldowns ?? {};

    this._derivedData = signal<ChartDataSet | null>(null);
    this._disposeDerive = effect(() => {
      this._derivedData.set(this._deriveData());
    });
  }

  /** Dispose the internal effect — call when the owning element unmounts. */
  dispose(): void {
    this._disposeDerive?.();
    this._disposeDerive = null;
  }

  // ── public signal-backed getters ────────────────────────────────

  get config(): ChartConfig { return this._config.value; }
  get rawData(): ChartDataSet | null { return this._rawData.value; }
  get data(): ChartDataSet | null { return this._derivedData.value; }
  /** Synchronous read of derived data without subscribing — for snapshots. */
  _dataNow(): ChartDataSet | null { return this._deriveData(); }
  get selection(): ChartSelection | null { return this._selection.value; }
  get filters(): ChartFilter[] { return this._filters.value; }
  get timeRange(): ChartTimeRange | null { return this._timeRange.value; }
  get hiddenSeries(): string[] { return [...this._hiddenSeries.value]; }
  get drilldownStack(): DrilldownFrame[] { return this._drilldownStack.value; }
  get exportStatus(): ChartExportStatus | null { return this._exportStatus.value; }
  get lastCommit(): CommitRecord | null { return this._lastCommit.value; }

  setRawData(data: ChartDataSet | null): void {
    this._rawData.set(data);
  }

  /**
   * Snapshot — the reader used by `@atlas/test-state`. JSON-safe.
   */
  snapshot(): ChartStateSnapshot {
    return {
      chartId: this.chartId,
      config: this._config.value,
      data: this._dataNow(),
      selection: this._selection.value,
      filters: this._filters.value,
      timeRange: this._timeRange.value,
      hiddenSeries: [...this._hiddenSeries.value],
      drilldownStack: this._drilldownStack.value,
      exportStatus: this._exportStatus.value,
      lastCommit: this._lastCommit.value,
    };
  }

  /**
   * Single write path for every user intent. Applies the typed intent to
   * signals, records `lastCommit`. Returns the commit record.
   *
   * The intent is a `ChartIntent` discriminated union — each `kind`
   * carries exactly the fields its handler reads, so `_apply` narrows
   * without any `as` casts.
   */
  commit(intent: ChartIntent): CommitRecord {
    const surfaceId = `chart:${this.chartId}`;
    // The commit record stores the patch payload (everything but `kind`)
    // for test-state inspection — same shape callers used before.
    const { kind, ...patch } = intent;
    const record = makeCommit(surfaceId, kind, patch);

    batch(() => {
      this._apply(intent);
      this._lastCommit.set(record);
    });
    return record;
  }

  _apply(intent: ChartIntent): void {
    switch (intent.kind) {
      case 'setConfig': {
        const next: ChartConfig = { ...this._config.value, [intent.field]: intent.value };
        this._config.set(next);
        return;
      }
      case 'selectSeries': {
        this._selection.set({
          seriesId: intent.seriesId,
          pointIndex: intent.pointIndex ?? null,
        });
        return;
      }
      case 'toggleSeries': {
        const next = new Set(this._hiddenSeries.value);
        if (intent.hidden) next.add(intent.seriesId);
        else next.delete(intent.seriesId);
        this._hiddenSeries.set(next);
        return;
      }
      case 'setFilter': {
        const existing = this._filters.value.filter((f) => f.field !== intent.field);
        this._filters.set([
          ...existing,
          { field: intent.field, op: intent.op, value: intent.value },
        ]);
        return;
      }
      case 'clearFilter': {
        this._filters.set(this._filters.value.filter((f) => f.field !== intent.field));
        return;
      }
      case 'setTimeRange': {
        this._timeRange.set(
          intent.preset
            ? { preset: intent.preset }
            : {
                from: intent.from ?? null,
                to: intent.to ?? null,
              },
        );
        return;
      }
      case 'pushDrilldown': {
        const frame: DrilldownFrame = {
          level: intent.level,
          value: intent.value,
          ...(intent.label !== undefined ? { label: intent.label } : {}),
        };
        this._drilldownStack.set([...this._drilldownStack.value, frame]);
        return;
      }
      case 'popDrilldown': {
        const depth = intent.toDepth ?? Math.max(0, this._drilldownStack.value.length - 1);
        this._drilldownStack.set(this._drilldownStack.value.slice(0, depth));
        return;
      }
      case 'requestExport': {
        this._exportStatus.set({ format: intent.format, at: Date.now() });
        return;
      }
    }
  }

  /**
   * Derive visible data from rawData + drilldownStack + timeRange + filters
   * + hiddenSeries. Pure function of signals.
   */
  _deriveData(): ChartDataSet | null {
    const current = this._currentDataSet();
    if (!current || !current.series) return current;

    const tr = this._timeRange.value;
    const filters = this._filters.value;

    // We keep hidden series in the derived data so the legend can show
    // them with a "pressed off" state. The card filters them out just
    // before passing data to the chart renderer.
    let series = current.series;
    if (tr || filters.length > 0) {
      series = series.map((s) => ({
        ...s,
        values: s.values.filter((p) => inTimeRange(p.x, tr) && passesFilters(p, filters)),
      }));
    }
    return { ...current, series };
  }

  _currentDataSet(): ChartDataSet | null {
    const stack = this._drilldownStack.value;
    if (stack.length === 0) return this._rawData.value;
    const last = stack[stack.length - 1];
    if (!last) return this._rawData.value;
    const child = this._drilldowns[last.value];
    return child ?? this._rawData.value;
  }
}

function inTimeRange(x: PointX, tr: ChartTimeRange | null): boolean {
  if (!tr) return true;
  const t = x instanceof Date ? x.getTime() : new Date(x).getTime();
  if (!Number.isFinite(t)) return true;
  if (tr.from && t < new Date(tr.from).getTime()) return false;
  if (tr.to && t > new Date(tr.to).getTime()) return false;
  if (tr.preset) {
    const now = Date.now();
    const windowMs = presetWindowMs(tr.preset);
    if (windowMs != null && t < now - windowMs) return false;
  }
  return true;
}

function presetWindowMs(preset: string): number | null {
  switch (preset) {
    case '1d': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    case '30d': return 30 * 24 * 60 * 60 * 1000;
    case '90d': return 90 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

function isRecord(v: unknown): v is { [k: string]: unknown } {
  return typeof v === 'object' && v !== null;
}

function passesFilters(point: unknown, filters: ChartFilter[]): boolean {
  if (!isRecord(point)) return filters.length === 0;
  for (const f of filters) {
    const v = point[f.field];
    if (!compare(v, f.op, f.value)) return false;
  }
  return true;
}

function compare(a: unknown, op: string, b: unknown): boolean {
  switch (op) {
    case '=': return a === b;
    case '!=': return a !== b;
    case '<': return toNum(a) < toNum(b);
    case '<=': return toNum(a) <= toNum(b);
    case '>': return toNum(a) > toNum(b);
    case '>=': return toNum(a) >= toNum(b);
    case 'includes': return String(a ?? '').includes(String(b ?? ''));
    default: return true;
  }
}

function toNum(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}
