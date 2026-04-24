/**
 * Grouped bar chart renderer. Each data point is an SVG <rect> with a
 * <title> tooltip. Groups are positioned at xScale(x); within a group,
 * bars for each series are spread across the bandwidth.
 */

import type { PointX, Series } from '../data-normalize.ts';
import type { AxisBounds } from '../axis.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface BarRendererOptions {
  series: Series[];
  xScale: { scale(v: unknown): number; bandwidth: number };
  yScale: { scale(v: number): number };
  bounds: AxisBounds;
  colors: string[];
}

export function renderBar(opts: BarRendererOptions): SVGGElement {
  const { series, xScale, yScale, bounds, colors } = opts;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'atlas-chart-series atlas-chart-bar');

  const bandwidth = xScale.bandwidth ?? 0;
  const seriesCount = Math.max(1, series.length);
  const barWidth = bandwidth / seriesCount;
  const baselineY = bounds.bottom;

  series.forEach((s, i) => {
    const color = colors[i % colors.length] ?? '#000';
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('data-series', String(i));

    s.values.forEach((p, j) => {
      const x = xScale.scale(p.x) + i * barWidth;
      const y = yScale.scale(p.y);
      const height = Math.max(0, baselineY - y);
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(Math.min(y, baselineY)));
      rect.setAttribute('width', String(Math.max(0, barWidth - 1)));
      rect.setAttribute('height', String(height));
      rect.setAttribute('fill', color);
      rect.setAttribute('class', 'bar');
      rect.setAttribute('tabindex', '0');
      rect.setAttribute('role', 'graphics-symbol');
      rect.setAttribute('data-series', String(i));
      rect.setAttribute('data-index', String(j));

      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${s.name}: ${p.y} (${formatX(p.x)})`;
      rect.appendChild(title);

      group.appendChild(rect);
    });

    g.appendChild(group);
  });

  return g;
}

function formatX(x: PointX): string {
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  return String(x);
}
