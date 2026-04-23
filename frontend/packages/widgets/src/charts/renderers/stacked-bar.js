/**
 * Stacked bar renderer. For each x category, stacks series values from
 * the baseline upward. The y scale's domain must accommodate the
 * cumulative sum per x (caller's responsibility).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {{
 *   series: Array<{ name: string, values: Array<{x:any, y:number}> }>,
 *   xScale: { scale: (v:any) => number, bandwidth: number },
 *   yScale: { scale: (v:any) => number },
 *   bounds: { left: number, top: number, right: number, bottom: number },
 *   colors: string[],
 * }} opts
 */
export function renderStackedBar(opts) {
  const { series, xScale, yScale, bounds, colors } = opts;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'atlas-chart-series atlas-chart-stacked-bar');

  const bandwidth = xScale.bandwidth ?? 0;

  // [xKey → ordered [{seriesIdx, value, name}]]
  const byX = new Map();
  series.forEach((s, i) => {
    for (const p of s.values) {
      const key = keyOfX(p.x);
      if (!byX.has(key)) byX.set(key, { x: p.x, parts: [] });
      byX.get(key).parts.push({ seriesIdx: i, value: p.y, name: s.name });
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
      rect.setAttribute('fill', colors[part.seriesIdx % colors.length]);
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

function keyOfX(x) {
  if (x instanceof Date) return `d${x.getTime()}`;
  return String(x);
}

function formatX(x) {
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  return String(x);
}
