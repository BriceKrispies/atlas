/**
 * Line / area renderer. Returns an SVG <g> containing one <path> per
 * series plus focusable <g.point> elements for each data point.
 *
 * `fill` mode ('line' or 'area') decides whether the path closes to the
 * baseline; 'area' also renders with a semi-transparent fill.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {{
 *   series: Array<{ name: string, values: Array<{x:any, y:number}> }>,
 *   xScale: { scale: (v:any) => number, kind?: string, bandwidth?: number },
 *   yScale: { scale: (v:any) => number },
 *   bounds: { left: number, top: number, right: number, bottom: number },
 *   colors: string[],
 *   mode?: 'line' | 'area',
 * }} opts
 */
export function renderLine(opts) {
  const { series, xScale, yScale, bounds, colors, mode = 'line' } = opts;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'atlas-chart-series atlas-chart-line');

  const bandwidth = xScale.bandwidth ?? 0;
  const xOf = (v) => xScale.scale(v) + bandwidth / 2;
  const baselineY = bounds.bottom;

  series.forEach((s, i) => {
    const color = colors[i % colors.length];
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('data-series', String(i));

    const path = document.createElementNS(SVG_NS, 'path');
    const d = pathString(s.values.map((p) => [xOf(p.x), yScale.scale(p.y)]), mode === 'area', baselineY);
    path.setAttribute('d', d);
    path.setAttribute('fill', mode === 'area' ? color : 'none');
    path.setAttribute('fill-opacity', mode === 'area' ? '0.15' : '0');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('class', 'series-line');
    group.appendChild(path);

    s.values.forEach((p, j) => {
      const cx = xOf(p.x);
      const cy = yScale.scale(p.y);
      const point = document.createElementNS(SVG_NS, 'g');
      point.setAttribute('class', 'atlas-chart-point');
      point.setAttribute('tabindex', '0');
      point.setAttribute('role', 'graphics-symbol');
      point.setAttribute('data-series', String(i));
      point.setAttribute('data-index', String(j));

      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(cx));
      dot.setAttribute('cy', String(cy));
      dot.setAttribute('r', '3');
      dot.setAttribute('fill', color);
      point.appendChild(dot);

      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${s.name}: ${p.y} (${formatX(p.x)})`;
      point.appendChild(title);

      group.appendChild(point);
    });

    g.appendChild(group);
  });

  return g;
}

function pathString(points, area, baselineY) {
  if (points.length === 0) return '';
  let d = '';
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i];
    d += (i === 0 ? 'M ' : ' L ') + `${x} ${y}`;
  }
  if (area) {
    const [lastX] = points[points.length - 1];
    const [firstX] = points[0];
    d += ` L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;
  }
  return d;
}

function formatX(x) {
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  return String(x);
}
