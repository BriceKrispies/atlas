/**
 * renderChartDataTable(data, type) — visually-hidden <table> fallback
 * that mirrors a chart's data for screen readers. The SVG carries
 * aria-describedby pointing at this table's caption.
 *
 * Only data and layout matter here; styling is handled by the
 * `.atlas-visually-hidden` class in `@atlas/widgets/styles.css`.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'; // kept for symmetry with renderers

/**
 * @param {{ series?: Array<{ name: string, values: Array<{x: any, y: number}> }>, slices?: Array<{ label: string, value: number }> }} data
 * @param {string} type
 * @returns {HTMLTableElement}
 */
export function renderChartDataTable(data, type) {
  void SVG_NS;
  const table = document.createElement('table');
  table.className = 'atlas-visually-hidden';
  table.setAttribute('aria-label', `${type} chart data table`);

  if (data?.slices) return renderSlicesTable(table, data.slices);
  if (data?.series) return renderSeriesTable(table, data.series);
  return table;
}

function renderSlicesTable(table, slices) {
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(th('Label'));
  headRow.appendChild(th('Value'));
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement('tbody');
  for (const s of slices) {
    const row = document.createElement('tr');
    row.appendChild(td(s.label));
    row.appendChild(td(String(s.value)));
    body.appendChild(row);
  }
  table.appendChild(body);
  return table;
}

function renderSeriesTable(table, series) {
  // Build the union of x values across all series in insertion order.
  const xs = [];
  const seen = new Set();
  for (const s of series) {
    for (const p of s.values) {
      const key = keyOfX(p.x);
      if (!seen.has(key)) {
        seen.add(key);
        xs.push(p.x);
      }
    }
  }

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(th('X'));
  for (const s of series) headRow.appendChild(th(s.name));
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement('tbody');
  for (const x of xs) {
    const row = document.createElement('tr');
    row.appendChild(td(formatX(x)));
    for (const s of series) {
      const match = s.values.find((p) => keyOfX(p.x) === keyOfX(x));
      row.appendChild(td(match ? String(match.y) : ''));
    }
    body.appendChild(row);
  }
  table.appendChild(body);
  return table;
}

function th(text) {
  const cell = document.createElement('th');
  cell.setAttribute('scope', 'col');
  cell.textContent = text;
  return cell;
}
function td(text) {
  const cell = document.createElement('td');
  cell.textContent = text;
  return cell;
}
function keyOfX(x) {
  if (x instanceof Date) return `d${x.getTime()}`;
  return String(x);
}
function formatX(x) {
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  return String(x);
}
