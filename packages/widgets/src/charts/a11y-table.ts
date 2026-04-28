/**
 * renderChartDataTable(data, type) — visually-hidden <table> fallback
 * that mirrors a chart's data for screen readers. The SVG carries
 * aria-describedby pointing at this table's caption.
 */

import type { NormalizedData, Point, Series, Slice } from './data-normalize.ts';

const SVG_NS = 'http://www.w3.org/2000/svg'; // kept for symmetry with renderers

export function renderChartDataTable(data: NormalizedData | null | undefined, type: string): HTMLTableElement {
  void SVG_NS;
  const table = document.createElement('table');
  table.className = 'atlas-visually-hidden';
  table.setAttribute('aria-label', `${type} chart data table`);

  if ((data as { slices?: Slice[] } | null)?.slices) {
    return renderSlicesTable(table, (data as { slices: Slice[] }).slices);
  }
  if ((data as { series?: Series[] } | null)?.series) {
    return renderSeriesTable(table, (data as { series: Series[] }).series);
  }
  return table;
}

function renderSlicesTable(table: HTMLTableElement, slices: Slice[]): HTMLTableElement {
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

function renderSeriesTable(table: HTMLTableElement, series: Series[]): HTMLTableElement {
  // Build the union of x values across all series in insertion order.
  const xs: Point['x'][] = [];
  const seen = new Set<string>();
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

function th(text: string): HTMLTableCellElement {
  const cell = document.createElement('th');
  cell.setAttribute('scope', 'col');
  cell.textContent = text;
  return cell;
}
function td(text: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.textContent = text;
  return cell;
}
function keyOfX(x: Point['x']): string {
  if (x instanceof Date) return `d${x.getTime()}`;
  return String(x);
}
function formatX(x: Point['x']): string {
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  return String(x);
}
