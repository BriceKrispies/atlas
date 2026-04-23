/**
 * Pie / donut renderer. When `innerRadius > 0`, produces a donut.
 *
 * Each slice is an SVG <path> with an "M → L → A → Z" arc. Slices are
 * focusable via tabindex="0" and carry <title> tooltips for a11y.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {{
 *   slices: Array<{ label: string, value: number }>,
 *   cx: number, cy: number,
 *   radius: number,
 *   innerRadius?: number,
 *   colors: string[],
 * }} opts
 */
export function renderPie(opts) {
  const { slices, cx, cy, radius, innerRadius = 0, colors } = opts;
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', innerRadius > 0 ? 'atlas-chart-donut' : 'atlas-chart-pie');

  const total = slices.reduce((n, s) => n + (Number.isFinite(s.value) ? s.value : 0), 0);
  if (total <= 0 || slices.length === 0) return g;

  let start = -Math.PI / 2; // top
  slices.forEach((slice, i) => {
    const fraction = slice.value / total;
    const end = start + fraction * 2 * Math.PI;
    const color = colors[i % colors.length];

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', arcPath(cx, cy, radius, innerRadius, start, end));
    path.setAttribute('fill', color);
    path.setAttribute('class', 'slice');
    path.setAttribute('tabindex', '0');
    path.setAttribute('role', 'graphics-symbol');
    path.setAttribute('data-index', String(i));

    const title = document.createElementNS(SVG_NS, 'title');
    const pct = (fraction * 100).toFixed(1);
    title.textContent = `${slice.label}: ${slice.value} (${pct}%)`;
    path.appendChild(title);

    g.appendChild(path);
    start = end;
  });

  return g;
}

function arcPath(cx, cy, rOuter, rInner, start, end) {
  const largeArc = end - start > Math.PI ? 1 : 0;
  const x0 = cx + rOuter * Math.cos(start);
  const y0 = cy + rOuter * Math.sin(start);
  const x1 = cx + rOuter * Math.cos(end);
  const y1 = cy + rOuter * Math.sin(end);

  if (rInner > 0) {
    const xi0 = cx + rInner * Math.cos(end);
    const yi0 = cy + rInner * Math.sin(end);
    const xi1 = cx + rInner * Math.cos(start);
    const yi1 = cy + rInner * Math.sin(start);
    return [
      `M ${x0} ${y0}`,
      `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x1} ${y1}`,
      `L ${xi0} ${yi0}`,
      `A ${rInner} ${rInner} 0 ${largeArc} 0 ${xi1} ${yi1}`,
      'Z',
    ].join(' ');
  }

  return [
    `M ${cx} ${cy}`,
    `L ${x0} ${y0}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x1} ${y1}`,
    'Z',
  ].join(' ');
}
