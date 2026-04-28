import { AtlasElement, effect, signal, type EffectCleanup, type Signal } from '@atlas/core';
import { normalize, type NormalizedData, type NormalizedSeriesData, type NormalizedSlicesData, type PointX, type Series, type XKind } from './data-normalize.ts';
import { linearScale, bandScale, timeScale, type AnyScale } from './scales.ts';
import { renderAxis, type AxisBounds } from './axis.ts';
import { paletteColors, gridColor, axisColor } from './color-palette.ts';
import { renderChartDataTable } from './a11y-table.ts';
import { observeSize, type ElementSize } from '../responsive/observe-size.ts';
import { renderLine } from './renderers/line.ts';
import { renderArea } from './renderers/area.ts';
import { renderBar } from './renderers/bar.ts';
import { renderStackedBar } from './renderers/stacked-bar.ts';
import { renderPie } from './renderers/pie.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADIAL_TYPES = new Set<string>(['pie', 'donut']);
const CARTESIAN_TYPES = new Set<string>(['line', 'area', 'bar', 'stacked-bar']);

type ChartType = 'line' | 'area' | 'bar' | 'stacked-bar' | 'pie' | 'donut' | string;

/**
 * <atlas-chart type="line|area|bar|stacked-bar|pie|donut">
 *
 * A single element encapsulates the six major chart types.
 */
class AtlasChart extends AtlasElement {
  static override get observedAttributes(): string[] {
    return ['type', 'height', 'label', 'show-legend', 'show-axes', 'inner-radius'];
  }

  _data: unknown = null;
  _sizeSignal: Signal<ElementSize> = signal<ElementSize>({ width: 0, height: 0 });
  _sizeObserver: { size: Signal<ElementSize>; dispose: () => void } | null = null;
  override _renderDispose: EffectCleanup | null = null;

  get data(): unknown { return this._data; }
  set data(next: unknown) {
    this._data = next;
    this._sizeSignal.set({ ...this._sizeSignal.value }); // nudge reactive render
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'img');
    this._ensureHeight();

    const observed = observeSize(this);
    this._sizeSignal = observed.size;
    this._sizeObserver = observed;

    this._renderDispose = effect(() => this._render(this._sizeSignal.value));
  }

  override disconnectedCallback(): void {
    this._renderDispose?.();
    this._renderDispose = null;
    this._sizeObserver?.dispose();
    this._sizeObserver = null;
    super.disconnectedCallback?.();
  }

  override attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (oldVal === newVal) return;
    if (name === 'height') this._ensureHeight();
    // Poke reactive render by re-setting the signal.
    this._sizeSignal.set({ ...this._sizeSignal.value });
  }

  _ensureHeight(): void {
    const h = this.getAttribute('height');
    if (h) this.style.setProperty('height', h);
    else if (!this.style.height) this.style.setProperty('height', '240px');
  }

  _type(): ChartType {
    return this.getAttribute('type') ?? 'line';
  }

  _render(size: ElementSize): void {
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

    const expected: 'series' | 'slices' = isRadial ? 'slices' : 'series';
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
      this._renderRadial(svg, type, normalized as NormalizedSlicesData, { width, height, colors });
    } else if (CARTESIAN_TYPES.has(type)) {
      this._renderCartesian(svg, type, normalized as NormalizedSeriesData, { width, height, colors, showAxes });
    }

    this.appendChild(svg);

    // Hidden <table> data fallback for screen readers.
    const fallback = renderChartDataTable(normalized, type);
    this.appendChild(fallback);

    if (showLegend) {
      const legend = document.createElement('atlas-chart-legend') as HTMLElement & {
        entries?: Array<{ label: string; color: string }>;
      };
      legend.entries = isRadial
        ? (normalized as NormalizedSlicesData).slices.map((s, i) => ({ label: s.label, color: colors[i % colors.length] ?? '#000' }))
        : (normalized as NormalizedSeriesData).series.map((s, i) => ({ label: s.name, color: colors[i % colors.length] ?? '#000' }));
      this.appendChild(legend);
    }
  }

  _renderCartesian(
    svg: SVGSVGElement,
    type: ChartType,
    normalized: NormalizedSeriesData,
    { width, height, colors, showAxes }: { width: number; height: number; colors: string[]; showAxes: boolean },
  ): void {
    const { series, xKind } = normalized;
    if (series.length === 0) return;

    const pad = { left: 44, top: 12, right: 16, bottom: 28 };
    const bounds: AxisBounds = {
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
      svg.appendChild(renderAxis({ scale: yScale as unknown as Parameters<typeof renderAxis>[0]['scale'], orientation: 'left', bounds, axisColor: axisColor(this) }));
      svg.appendChild(renderAxis({ scale: xScale as unknown as Parameters<typeof renderAxis>[0]['scale'], orientation: 'bottom', bounds, axisColor: axisColor(this) }));
    }

    const rendererOpts = {
      series,
      xScale: xScale as unknown as { scale(v: unknown): number; bandwidth: number; kind?: string },
      yScale: yScale as unknown as { scale(v: number): number },
      bounds,
      colors,
    };
    let plot: SVGGElement | undefined;
    if (type === 'line') plot = renderLine(rendererOpts);
    else if (type === 'area') plot = renderArea(rendererOpts);
    else if (type === 'bar') plot = renderBar(rendererOpts);
    else if (type === 'stacked-bar') plot = renderStackedBar(rendererOpts);
    if (plot) svg.appendChild(plot);

    // Keyboard navigation + focus telemetry: delegate on svg.
    svg.addEventListener('focusin', (e) => this._onFocus(e));
    svg.addEventListener('focusout', () => this._onBlur());
    svg.addEventListener('click', (e) => this._onClick(e));
  }

  _renderRadial(
    svg: SVGSVGElement,
    type: ChartType,
    normalized: NormalizedSlicesData,
    { width, height, colors }: { width: number; height: number; colors: string[] },
  ): void {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 8;
    const innerFraction = type === 'donut'
      ? clamp01(Number(this.getAttribute('inner-radius') ?? 0.6))
      : 0;
    const inner = radius * innerFraction;
    svg.appendChild(renderPie({ slices: normalized.slices, cx, cy, radius, innerRadius: inner, colors }));
  }

  _defaultLabel(type: ChartType, normalized: NormalizedData | null): string {
    if ((normalized as NormalizedSlicesData | null)?.slices) {
      return `${type} chart with ${(normalized as NormalizedSlicesData).slices.length} slices`;
    }
    return `${type} chart with ${(normalized as NormalizedSeriesData | null)?.series?.length ?? 0} series`;
  }

  _onFocus(e: Event): void {
    const target = e.target as Element | null;
    const seriesIdx = Number(target?.getAttribute?.('data-series'));
    const index = Number(target?.getAttribute?.('data-index'));
    if (!Number.isFinite(seriesIdx) && !Number.isFinite(index)) return;
    this.dispatchEvent(new CustomEvent('point-focus', {
      bubbles: true, detail: { seriesIdx, index },
    }));
  }

  _onBlur(): void {
    this.dispatchEvent(new CustomEvent('point-blur', { bubbles: true }));
  }

  _onClick(e: Event): void {
    const target = e.target as Element | null;
    const seriesIdx = Number(target?.getAttribute?.('data-series'));
    const index = Number(target?.getAttribute?.('data-index'));
    const seriesId = target?.getAttribute?.('data-series-id') ?? null;
    const pointValue = target?.getAttribute?.('data-x') ?? null;
    if (!Number.isFinite(seriesIdx) && !Number.isFinite(index) && !seriesId) return;
    this.dispatchEvent(new CustomEvent('point-click', {
      bubbles: true,
      detail: { seriesIdx, index, seriesId, pointValue },
    }));
  }
}

// ── helpers ───────────────────────────────────────────────────────

function makeXScale(type: ChartType, xKind: XKind, series: Series[], range: [number, number]): AnyScale {
  const xs = flattenXs(series);
  if (type === 'bar' || type === 'stacked-bar' || xKind === 'band') {
    const domain = uniqueOrdered(xs) as Array<string | number>;
    return bandScale({ domain, range, padding: 0.2 });
  }
  if (xKind === 'time') {
    const ms = xs.map((x) => (x instanceof Date ? x : new Date(x as string | number)));
    const d0 = ms.reduce((a, b) => (a < b ? a : b));
    const d1 = ms.reduce((a, b) => (a > b ? a : b));
    return timeScale({ domain: [d0, d1], range });
  }
  const nums = xs.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  const d0 = Math.min(...nums);
  const d1 = Math.max(...nums);
  return linearScale({ domain: [d0, d1], range });
}

function makeYScale(type: ChartType, series: Series[], range: [number, number]) {
  if (type === 'stacked-bar') {
    const byX = new Map<string, number>();
    for (const s of series) {
      for (const p of s.values) {
        const key = p.x instanceof Date ? String(p.x.getTime()) : String(p.x);
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

function flattenXs(series: Series[]): PointX[] {
  const xs: PointX[] = [];
  for (const s of series) for (const p of s.values) xs.push(p.x);
  return xs;
}

function uniqueOrdered(values: PointX[]): PointX[] {
  const seen = new Set<string>();
  const out: PointX[] = [];
  for (const v of values) {
    const key = v instanceof Date ? String(v.getTime()) : String(v);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.6;
  if (n < 0) return 0;
  if (n > 0.95) return 0.95;
  return n;
}

function renderGridLines(yScale: { ticks?: (n?: number) => number[]; scale(v: number): number }, bounds: AxisBounds, color: string): SVGGElement {
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
