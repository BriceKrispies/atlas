/**
 * Built-in cell formatters.
 *
 *   formatCell(value, row, column) → string | DocumentFragment | Node
 *
 * A column's `format` may be:
 *   - a built-in string key ('text' | 'date' | 'number' | 'currency' | 'status')
 *   - a function (value, row) → string | Node — typed to the column's V
 *   - undefined, in which case `text` is used.
 */

import type { Row } from '../data-source/types.ts';
import type { AnyColumn, CellFormatterFn } from './data-table-core.ts';

export type { CellFormatterFn };

export function formatCell<R extends Row>(
  value: unknown,
  row: R,
  column: AnyColumn<R> | undefined,
): string | Node {
  const fmt = column?.format;
  if (typeof fmt === 'function') {
    // The column's CellFormatterFn was declared with a specific V; the core
    // dispatches values as `unknown` because it doesn't know per-column V
    // at this layer. AnyColumn<R> = Column<R, unknown>, so fmt's signature
    // is already (value: unknown, row: R) — no cast needed.
    return fmt(value, row);
  }
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
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === 'string' || typeof value === 'number') {
    d = new Date(value);
  } else {
    return String(value);
  }
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
