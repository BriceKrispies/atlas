import { AtlasElement, effect } from '@atlas/core';
import { registerTestState } from '@atlas/test-state';
import { ChartStateStore } from './chart-state.js';

/**
 * <atlas-chart-card chart-id="sales" type="line">
 *   <atlas-chart-config-panel>...</atlas-chart-config-panel>
 *   <atlas-chart-time-range></atlas-chart-time-range>
 *   <atlas-chart-filter-panel>...</atlas-chart-filter-panel>
 *   <atlas-chart-drilldown></atlas-chart-drilldown>
 *   <atlas-chart></atlas-chart>
 *   <atlas-chart-legend></atlas-chart-legend>
 *   <atlas-chart-export-button format="csv"></atlas-chart-export-button>
 * </atlas-chart-card>
 *
 * Wrapper element that owns one `ChartStateStore`. Children resolve the
 * store via `this.closest('atlas-chart-card').store` and call
 * `store.commit(intent, patch)` for every user action.
 *
 * The card also bridges the store to the nested `<atlas-chart>`:
 *   - store.data  → chart.data
 *   - store.config.type → chart.type attribute
 *   - chart point-click → store.commit('selectSeries' | 'pushDrilldown')
 *
 * Registers a test-state reader at `chart:<chartId>`.
 */
class AtlasChartCard extends AtlasElement {
  constructor() {
    super();
    /** @type {ChartStateStore | null} */
    this.store = null;
    this._disposeTest = null;
    this._disposeBridge = null;
  }

  static get observedAttributes() {
    return ['chart-id'];
  }

  get chartId() {
    return this.getAttribute('chart-id') ?? 'chart';
  }

  set data(next) {
    this._ensureStore();
    this.store?.setRawData(next);
  }
  get data() {
    return this.store?.rawData ?? null;
  }

  set initialConfig(cfg) {
    this._ensureStore();
    if (!this.store || !cfg) return;
    for (const [field, value] of Object.entries(cfg)) {
      this.store._config.set({ ...this.store._config.value, [field]: value });
    }
  }

  set drilldowns(map) {
    this._ensureStore();
    if (this.store) this.store._drilldowns = map ?? {};
  }

  _ensureStore() {
    if (this.store) return;
    this.store = new ChartStateStore(this.chartId, {});
  }

  connectedCallback() {
    super.connectedCallback();
    this._ensureStore();
    this._disposeTest = registerTestState(
      `chart:${this.chartId}`,
      () => this.store?.snapshot() ?? null,
    );

    // Bridge store → nested <atlas-chart>.
    // Effect reads are reactive; DOM writes are deferred to a microtask
    // so the chart's internal signal reads (e.g. `_sizeSignal.value` in
    // its `data` setter) don't accidentally subscribe this effect.
    this._disposeBridge = effect(() => {
      if (!this.store) return;
      const data = this.store.data;
      const hidden = new Set(this.store.hiddenSeries);
      const cfgType = this.store.config.type;
      const visible = data?.series
        ? { ...data, series: data.series.filter((s) => !hidden.has(s.id ?? s.name)) }
        : data;
      queueMicrotask(() => {
        const chart = this.querySelector('atlas-chart');
        if (!chart) return;
        chart.data = visible;
        if (cfgType && chart.getAttribute('type') !== cfgType) {
          chart.setAttribute('type', cfgType);
        }
      });
    });

    // Listen for chart point-click to commit selection or drilldown.
    this.addEventListener('point-click', (ev) => {
      const detail = ev.detail ?? {};
      const seriesId = detail.seriesId ?? this._seriesIdFor(detail.seriesIdx);
      if (seriesId == null) return;
      // If we have a drilldown dataset for this series, drill in.
      if (this.store?._drilldowns && this.store._drilldowns[seriesId]) {
        this.store.commit('pushDrilldown', {
          level: this.store.drilldownStack.length,
          label: seriesId,
          value: seriesId,
        });
      } else {
        this.store?.commit('selectSeries', {
          seriesId,
          pointIndex: Number.isFinite(detail.index) ? detail.index : null,
        });
      }
    });
  }

  disconnectedCallback() {
    this._disposeTest?.();
    this._disposeTest = null;
    this._disposeBridge?.();
    this._disposeBridge = null;
    this.store?.dispose();
    super.disconnectedCallback?.();
  }

  _seriesIdFor(idx) {
    const data = this.store?.data;
    if (!data?.series || !Number.isFinite(idx)) return null;
    const s = data.series[idx];
    if (!s) return null;
    return s.id ?? s.name;
  }
}

AtlasElement.define('atlas-chart-card', AtlasChartCard);

export { AtlasChartCard };
