/**
 * Built-in cell formatters.
 *
 *   formatCell(value, row, column) → string | DocumentFragment | Node
 *
 * A column's `format` may be:
 *   - a built-in string key ('text' | 'date' | 'number' | 'currency' | 'status')
 *   - a function (value, row) → string | Node
 *   - undefined, in which case `text` is used.
 */

import type { Row } from '../data-source/types.ts';
import type { ColumnConfig } from './data-table-core.ts';

export type CellFormatterFn<R extends Row = Row> = (value: unknown, row: R) => string | Node;

export function formatCell<R extends Row>(
  value: unknown,
  row: R,
  column: ColumnConfig<R> | undefined,
): string | Node {
  const fmt = column?.format;
  if (typeof fmt === 'function') return (fmt as CellFormatterFn<R>)(value, row);
  switch (fmt) {
    case 'date':     return formatDate(value);
    case 'number':   return formatNumber(value);
    case 'currency': return formatCurrency(value, column?.currency ?? 'USD');
    case 'status':   return renderStatusBadge(value);
    case 'text':
    default:         return value == null ? '' : String(value);
  }
}

export function formatDate(value: unknown): string {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(d.getTime())) return String(value);
  try {
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function formatNumber(value: unknown): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  try { return n.toLocaleString(); } catch { return String(n); }
}

export function formatCurrency(value: unknown, currency: string = 'USD'): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  try {
    return n.toLocaleString(undefined, { style: 'currency', currency });
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function renderStatusBadge(value: unknown): HTMLElement {
  const text = value == null ? '' : String(value);
  const el = document.createElement('atlas-badge');
  el.setAttribute('status', text.toLowerCase());
  el.textContent = text;
  return el;
}
