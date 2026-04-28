/**
 * SVG axis renderer. Builds an SVG `<g>` with axis line, tick lines, and
 * labels. Orientation-aware: 'bottom' or 'left'.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface AxisBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AxisScaleShape {
  scale(v: unknown): number;
  ticks(n?: number): unknown[];
  kind: string;
  bandwidth?: number;
}

export interface RenderAxisOptions {
  scale: AxisScaleShape;
  orientation: 'bottom' | 'left';
  bounds: AxisBounds;
  tickCount?: number;
  formatter?: (v: unknown) => string;
  axisColor?: string;
}

export function renderAxis(opts: RenderAxisOptions): SVGGElement {
  const { scale, orientation, bounds, tickCount = 5, formatter, axisColor = '#6b7280' } = opts;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', `atlas-axis atlas-axis-${orientation}`);
  g.setAttribute('aria-hidden', 'true');

  const lineAttrs: Record<string, string> = { stroke: axisColor, 'stroke-width': '1' };

  if (orientation === 'bottom') {
    const y = bounds.bottom;
    g.appendChild(makeLine(bounds.left, y, bounds.right, y, lineAttrs));
    const ticks = scale.ticks?.(tickCount) ?? [];
    for (const t of ticks) {
      const x = scale.scale(t) + (scale.bandwidth ? scale.bandwidth / 2 : 0);
      g.appendChild(makeLine(x, y, x, y + 4, lineAttrs));
      const text = makeText(x, y + 16, formatTick(t, formatter), { 'text-anchor': 'middle', fill: axisColor });
      g.appendChild(text);
    }
  } else {
    const x = bounds.left;
    g.appendChild(makeLine(x, bounds.top, x, bounds.bottom, lineAttrs));
    const ticks = scale.ticks?.(tickCount) ?? [];
    for (const t of ticks) {
      const y = scale.scale(t);
      g.appendChild(makeLine(x - 4, y, x, y, lineAttrs));
      const text = makeText(x - 8, y + 4, formatTick(t, formatter), { 'text-anchor': 'end', fill: axisColor });
      g.appendChild(text);
    }
  }

  return g;
}

function makeLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  extra: Record<string, string> = {},
): SVGLineElement {
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  for (const [k, v] of Object.entries(extra)) line.setAttribute(k, String(v));
  return line;
}

function makeText(
  x: number,
  y: number,
  text: string,
  extra: Record<string, string> = {},
): SVGTextElement {
  const el = document.createElementNS(SVG_NS, 'text');
  el.setAttribute('x', String(x));
  el.setAttribute('y', String(y));
  el.setAttribute('font-size', '11');
  for (const [k, v] of Object.entries(extra)) el.setAttribute(k, String(v));
  el.textContent = text;
  return el;
}

function formatTick(value: unknown, formatter: ((v: unknown) => string) | undefined): string {
  if (typeof formatter === 'function') return formatter(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return Number(value.toPrecision(4)).toString();
  }
  return String(value);
}
