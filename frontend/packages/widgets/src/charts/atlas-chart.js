import { AtlasElement, effect, signal } from '@atlas/core';
import { normalize } from './data-normalize.js';
import { linearScale, bandScale, timeScale } from './scales.js';
import { renderAxis } from './axis.js';
import { paletteColors, gridColor, axisColor } from './color-palette.js';
import { renderChartDataTable } from './a11y-table.js';
import { observeSize } from '../responsive/observe-size.js';
import { renderLine } from './renderers/line.js';
import { renderArea } from './renderers/area.js';
import { renderBar } from './renderers/bar.js';
import { renderStackedBar } from './renderers/stacked-bar.js';
import { renderPie } from './renderers/pie.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADIAL_TYPES = new Set(['pie', 'donut']);
const CARTESIAN_TYPES = new Set(['line', 'area', 'bar', 'stacked-bar']);

/**
 * <atlas-chart type="line|area|bar|stacked-bar|pie|donut">
 *
 * A single element encapsulates the six major chart types. They share
 * the scaffolding (scales, axes, legend, tooltip, ResizeObserver,
 * hidden-table a11y fallback, color palette) and differ only in the
 * renderer function chosen from ./renderers/*.
 *
 * Attributes:
 *   - type        : chart type (see list above). Default 'line'.
 *   - name        : testid source (AtlasElement convention).
 *   - height      : CSS length applied as height. Default '240px'.
 *   - label       : accessible name for the chart (role="img").
 *   - show-legend : presence → render <atlas-chart-legend>.
 *   - show-axes   : defaults to on for cartesian, off for radial.
 *   - inner-radius: donut only — fraction [0..1]. Default 0.6.
 *
 * Properties:
 *   - data        : accepted shapes defined in data-normalize.js.
 *
 * Events:
 *   - point-focus / point-blur : { seriesIdx, index } for keyboard nav.
 */
class AtlasChart extends AtlasElement {
  static get observedAttributes() {
    return ['type', 'height', 'label', 'show-legend', 'show-axes', 'inner-radius'];
  }

  constructor() {
    super();
    this._data = null;
    this._sizeSignal = signal({ width: 0, height: 0 });
    this._sizeObserver = null;
    this._renderDispose = null;
  }

  get data() { return this._data; }
  set data(next) {
    this._data = next;
    this._sizeSignal.set({ ...this._sizeSignal.value }); // nudge reactive render
  }

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'img');
    this._ensureHeight();

    const observed = observeSize(this);
    this._sizeSignal = observed.size;
    this._sizeObserver = observed;

    this._renderDispose = effect(() => this._render(this._sizeSignal.value));
  }

  disconnectedCallback() {
    this._renderDispose?.();
    this._renderDispose = null;
    this._sizeObserver?.dispose();
    this._sizeObserver = null;
    super.disconnectedCallback?.();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal) return;
    if (name === 'height') this._ensureHeight();
    // Poke reactive render by re-setting the signal.
    this._sizeSignal.set({ ...this._sizeSignal.value });
  }

  _ensureHeight() {
    const h = this.getAttribute('height');
    if (h) this.style.setProperty('height', h);
    else if (!this.style.height) this.style.setProperty('height', '240px');
  }

  _type() {
    return this.getAttribute('type') ?? 'line';
  }

  _render(size) {
    const { width } = size;
    const height = size.height || parseFloat(this.style.height) || 240;
    const type = this._type();
    const isRadial = RADIAL_TYPES.has(type);
    const showLegendAttr = this.hasAttribute('show-legend');
    const showLegend = showLegendAttr || isRadial;
    const showAxesAttr = this.hasAttribute('show-axes');
    const showAxes = isRadial ? false : (!showAxesAttr ? true : this.getAttribute('show-axes') !== 'false');

    this.textContent = '';

    if (!this._data) {
      const placeholder = document.createElementNS(SVG_NS, 'svg');
      placeholder.setAttribute('xmlns', SVG_NS);
      this.appendChild(placeholder);
      return;
    }

    const expected = isRadial ? 'slices' : 'series';
    const normalized = normalize(this._data, expected);
    const colors = paletteColors(this, 8);

    if (width <= 0 || height <= 0) {
      // We're offscreen or not yet laid out. ResizeObserver will trigger
      // another render as soon as real dimensions arrive.
      return;
    }

    const label = this.getAttribute('label') ?? this._defaultLabel(type, normalized);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('aria-label', label);

    if (isRadial) {
      this._renderRadial(svg, type, normalized, { width, height, colors });
    } else if (CARTESIAN_TYPES.has(type)) {
      this._renderCartesian(svg, type, normalized, { width, height, colors, showAxes });
    }

    this.appendChild(svg);

    // Hidden <table> data fallback for screen readers.
    const fallback = renderChartDataTable(normalized, type);
    this.appendChild(fallback);

    if (showLegend) {
      const legend = document.createElement('atlas-chart-legend');
      legend.entries = isRadial
        ? normalized.slices.map((s, i) => ({ label: s.label, color: colors[i % colors.length] }))
        : normalized.series.map((s, i) => ({ label: s.name, color: colors[i % colors.length] }));
      this.appendChild(legend);
    }
  }

  _renderCartesian(svg, type, normalized, { width, height, colors, showAxes }) {
    const { series, xKind } = normalized;
    if (series.length === 0) return;

    const pad = { left: 44, top: 12, right: 16, bottom: 28 };
    const bounds = {
      left: pad.left,
      top: pad.top,
      right: width - pad.right,
      bottom: height - pad.bottom,
    };

    // X scale — linear if numeric, time if Dates, band if categorical.
    const xScale = makeXScale(type, xKind, series, [bounds.left, bounds.right]);
    // Y scale — linear over (0 or min, max) for grouped; (0, maxSum) for stacked.
    const yScale = makeYScale(type, series, [bounds.bottom, bounds.top]);

    if (showAxes) {
      const grid = renderGridLines(yScale, bounds, gridColor(this));
      svg.appendChild(grid);
      svg.appendChild(renderAxis({ scale: yScale, orientation: 'left', bounds, axisColor: axisColor(this) }));
      svg.appendChild(renderAxis({ scale: xScale, orientation: 'bottom', bounds, axisColor: axisColor(this) }));
    }

    const opts = { series, xScale, yScale, bounds, colors };
    let plot;
    if (type === 'line') plot = renderLine(opts);
    else if (type === 'area') plot = renderArea(opts);
    else if (type === 'bar') plot = renderBar(opts);
    else if (type === 'stacked-bar') plot = renderStackedBar(opts);
    if (plot) svg.appendChild(plot);

    // Keyboard navigation + focus telemetry: delegate on svg.
    svg.addEventListener('focusin', (e) => this._onFocus(e));
    svg.addEventListener('focusout', (e) => this._onBlur(e));
  }

  _renderRadial(svg, type, normalized, { width, height, colors }) {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 8;
    const innerFraction = type === 'donut'
      ? clamp01(Number(this.getAttribute('inner-radius') ?? 0.6))
      : 0;
    const inner = radius * innerFraction;
    svg.appendChild(renderPie({ slices: normalized.slices, cx, cy, radius, innerRadius: inner, colors }));
  }

  _defaultLabel(type, normalized) {
    if (normalized?.slices) return `${type} chart with ${normalized.slices.length} slices`;
    return `${type} chart with ${normalized?.series?.length ?? 0} series`;
  }

  _onFocus(e) {
    const target = e.target;
    const seriesIdx = Number(target?.getAttribute?.('data-series'));
    const index = Number(target?.getAttribute?.('data-index'));
    if (!Number.isFinite(seriesIdx) && !Number.isFinite(index)) return;
    this.dispatchEvent(new CustomEvent('point-focus', {
      bubbles: true, detail: { seriesIdx, index },
    }));
  }

  _onBlur() {
    this.dispatchEvent(new CustomEvent('point-blur', { bubbles: true }));
  }
}

// ── helpers ───────────────────────────────────────────────────────

function makeXScale(type, xKind, series, range) {
  const xs = flattenXs(series);
  if (type === 'bar' || type === 'stacked-bar' || xKind === 'band') {
    const domain = uniqueOrdered(xs);
    return bandScale({ domain, range, padding: 0.2 });
  }
  if (xKind === 'time') {
    const ms = xs.map((x) => (x instanceof Date ? x : new Date(x)));
    const d0 = ms.reduce((a, b) => (a < b ? a : b));
    const d1 = ms.reduce((a, b) => (a > b ? a : b));
    return timeScale({ domain: [d0, d1], range });
  }
  const nums = xs.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  const d0 = Math.min(...nums);
  const d1 = Math.max(...nums);
  return linearScale({ domain: [d0, d1], range });
}

function makeYScale(type, series, range) {
  if (type === 'stacked-bar') {
    const byX = new Map();
    for (const s of series) {
      for (const p of s.values) {
        const key = p.x instanceof Date ? p.x.getTime() : String(p.x);
        byX.set(key, (byX.get(key) ?? 0) + p.y);
      }
    }
    const values = [...byX.values()];
    const max = values.length ? Math.max(...values) : 1;
    return linearScale({ domain: [0, max || 1], range });
  }
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const p of s.values) {
      if (p.y < min) min = p.y;
      if (p.y > max) max = p.y;
    }
  }
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = 1;
  // Ensure bars/areas always reach the axis baseline by including 0.
  min = Math.min(0, min);
  if (max === min) max = min + 1;
  return linearScale({ domain: [min, max], range });
}

function flattenXs(series) {
  const xs = [];
  for (const s of series) for (const p of s.values) xs.push(p.x);
  return xs;
}

function uniqueOrdered(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    const key = v instanceof Date ? v.getTime() : String(v);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0.6;
  if (n < 0) return 0;
  if (n > 0.95) return 0.95;
  return n;
}

function renderGridLines(yScale, bounds, color) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'atlas-chart-grid');
  g.setAttribute('aria-hidden', 'true');
  const ticks = yScale.ticks?.(5) ?? [];
  for (const t of ticks) {
    const y = yScale.scale(t);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(bounds.left));
    line.setAttribute('y1', String(y));
    line.setAttribute('x2', String(bounds.right));
    line.setAttribute('y2', String(y));
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-dasharray', '2 3');
    line.setAttribute('stroke-width', '1');
    g.appendChild(line);
  }
  return g;
}

AtlasElement.define('atlas-chart', AtlasChart);
