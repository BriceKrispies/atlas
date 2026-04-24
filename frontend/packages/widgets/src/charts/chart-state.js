import { signal, effect, batch } from '@atlas/core';
import { makeCommit } from '@atlas/test-state';

/**
 * ChartStateStore — the committed-state contract for charts.
 *
 * Every user interaction (config change, filter, time range, legend toggle,
 * drilldown, export, series selection) goes through `commit(intent, patch)`.
 * That is the single write path. Signals update, `lastCommit` is recorded,
 * and any test observer sees the new state in the next turn of the event
 * loop.
 *
 * Canonical intents are documented in
 * `specs/frontend/interaction-contracts.md`.
 */
export class ChartStateStore {
  /**
   * @param {string} chartId — stable id used as the registry key.
   * @param {{
   *   config?: Record<string, unknown>,
   *   data?: unknown,
   *   drilldowns?: Record<string, unknown>,
   * }} [initial]
   */
  constructor(chartId, initial = {}) {
    this.chartId = chartId;

    this._config = signal({ ...(initial.config ?? {}) });
    this._rawData = signal(initial.data ?? null);
    this._selection = signal(null);
    this._filters = signal([]);
    this._timeRange = signal(null);
    this._hiddenSeries = signal(new Set());
    this._drilldownStack = signal([]);
    this._exportStatus = signal(null);
    this._lastCommit = signal(null);

    // Optional map of { [stepValue]: childData } used by `pushDrilldown`
    // so demos can drill into a nested dataset without a backend.
    this._drilldowns = initial.drilldowns ?? {};

    // `_derivedData` is a plain signal kept in sync by an effect that
    // watches the inputs. We use effect+signal instead of `computed` to
    // avoid a latent recursion when a subscriber reads the computed
    // during its own initial recompute.
    this._derivedData = signal(null);
    this._disposeDerive = effect(() => {
      this._derivedData.set(this._deriveData());
    });
  }

  /** Dispose the internal effect — call when the owning element unmounts. */
  dispose() {
    this._disposeDerive?.();
    this._disposeDerive = null;
  }

  // ── public signal-backed getters ────────────────────────────────

  get config() { return this._config.value; }
  get rawData() { return this._rawData.value; }
  get data() { return this._derivedData.value; }
  /** Synchronous read of derived data without subscribing — for snapshots. */
  _dataNow() { return this._deriveData(); }
  get selection() { return this._selection.value; }
  get filters() { return this._filters.value; }
  get timeRange() { return this._timeRange.value; }
  get hiddenSeries() { return [...this._hiddenSeries.value]; }
  get drilldownStack() { return this._drilldownStack.value; }
  get exportStatus() { return this._exportStatus.value; }
  get lastCommit() { return this._lastCommit.value; }

  setRawData(data) {
    this._rawData.set(data);
  }

  /**
   * Snapshot — the reader used by `@atlas/test-state`. JSON-safe.
   */
  snapshot() {
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
   * Single write path for every user intent. Applies the patch to signals,
   * records `lastCommit`. Returns the commit record.
   * @param {string} intent
   * @param {Record<string, unknown>} patch
   */
  commit(intent, patch) {
    const surfaceId = `chart:${this.chartId}`;
    const record = makeCommit(surfaceId, intent, patch);

    batch(() => {
      this._apply(intent, patch);
      this._lastCommit.set(record);
    });
    return record;
  }

  _apply(intent, patch) {
    switch (intent) {
      case 'setConfig': {
        const next = { ...this._config.value, [patch.field]: patch.value };
        this._config.set(next);
        return;
      }
      case 'selectSeries': {
        this._selection.set({ seriesId: patch.seriesId, pointIndex: patch.pointIndex ?? null });
        return;
      }
      case 'toggleSeries': {
        const next = new Set(this._hiddenSeries.value);
        if (patch.hidden) next.add(patch.seriesId);
        else next.delete(patch.seriesId);
        this._hiddenSeries.set(next);
        return;
      }
      case 'setFilter': {
        const existing = this._filters.value.filter((f) => f.field !== patch.field);
        this._filters.set([...existing, { field: patch.field, op: patch.op, value: patch.value }]);
        return;
      }
      case 'clearFilter': {
        this._filters.set(this._filters.value.filter((f) => f.field !== patch.field));
        return;
      }
      case 'setTimeRange': {
        this._timeRange.set(patch.preset ? { preset: patch.preset } : { from: patch.from, to: patch.to });
        return;
      }
      case 'pushDrilldown': {
        const frame = { level: patch.level, label: patch.label, value: patch.value };
        this._drilldownStack.set([...this._drilldownStack.value, frame]);
        return;
      }
      case 'popDrilldown': {
        const depth = patch.toDepth ?? Math.max(0, this._drilldownStack.value.length - 1);
        this._drilldownStack.set(this._drilldownStack.value.slice(0, depth));
        return;
      }
      case 'requestExport': {
        this._exportStatus.set({ format: patch.format, at: Date.now() });
        return;
      }
      default:
        // Unknown intent — still recorded in lastCommit for tests to inspect.
        return;
    }
  }

  /**
   * Derive visible data from rawData + drilldownStack + timeRange + filters
   * + hiddenSeries. Pure function of signals.
   * @private
   */
  _deriveData() {
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

  _currentDataSet() {
    const stack = this._drilldownStack.value;
    if (stack.length === 0) return this._rawData.value;
    const last = stack[stack.length - 1];
    const child = this._drilldowns[last.value];
    return child ?? this._rawData.value;
  }
}

function inTimeRange(x, tr) {
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

function presetWindowMs(preset) {
  switch (preset) {
    case '1d': return 24 * 60 * 60 * 1000;
    case '7d': return 7 * 24 * 60 * 60 * 1000;
    case '30d': return 30 * 24 * 60 * 60 * 1000;
    case '90d': return 90 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

function passesFilters(point, filters) {
  for (const f of filters) {
    const v = point[f.field];
    if (!compare(v, f.op, f.value)) return false;
  }
  return true;
}

function compare(a, op, b) {
  switch (op) {
    case '=': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    case 'includes': return String(a ?? '').includes(String(b ?? ''));
    default: return true;
  }
}
