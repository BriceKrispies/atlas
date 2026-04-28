/**
 * Stacked bar renderer. For each x category, stacks series values from
 * the baseline upward. The y scale's domain must accommodate the
 * cumulative sum per x (caller's responsibility).
 */

import type { PointX, Series } from '../data-normalize.ts';
import type { AxisBounds } from '../axis.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface StackedBarRendererOptions {
  series: Series[];
  xScale: { scale(v: unknown): number; bandwidth: number };
  yScale: { scale(v: number): number };
  bounds: AxisBounds;
  colors: string[];
}

interface StackPart {
  seriesIdx: number;
  value: number;
  name: string;
}

interface StackEntry {
  x: PointX;
  parts: StackPart[];
}

export function renderStackedBar(opts: StackedBarRendererOptions): SVGGElement {
  const { series, xScale, yScale, bounds, colors } = opts;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'atlas-chart-series atlas-chart-stacked-bar');

  const bandwidth = xScale.bandwidth ?? 0;

  // [xKey → ordered [{seriesIdx, value, name}]]
  const byX = new Map<string, StackEntry>();
  series.forEach((s, i) => {
    for (const p of s.values) {
      const key = keyOfX(p.x);
      if (!byX.has(key)) byX.set(key, { x: p.x, parts: [] });
      byX.get(key)!.parts.push({ seriesIdx: i, value: p.y, name: s.name });
    }
  });

  for (const { x, parts } of byX.values()) {
    let cumulative = 0;
    let yBottom = bounds.bottom;
    for (const part of parts) {
      cumulative += part.value;
      const yTop = yScale.scale(cumulative);
      const height = Math.max(0, yBottom - yTop);
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(xScale.scale(x)));
      rect.setAttribute('y', String(yTop));
      rect.setAttribute('width', String(Math.max(0, bandwidth - 1)));
      rect.setAttribute('height', String(height));
      rect.setAttribute('fill', colors[part.seriesIdx % colors.length] ?? '#000');
      rect.setAttribute('class', 'bar');
      rect.setAttribute('tabindex', '0');
      rect.setAttribute('role', 'graphics-symbol');
      rect.setAttribute('data-series', String(part.seriesIdx));

      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${part.name}: ${part.value} (${formatX(x)})`;
      rect.appendChild(title);

      g.appendChild(rect);
      yBottom = yTop;
    }
  }

  return g;
}

function keyOfX(x: PointX): string {
  if (x instanceof Date) return `d${x.getTime()}`;
  return String(x);
}

function formatX(x: PointX): string {
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  return String(x);
}
