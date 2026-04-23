/**
 * Built-in cell formatters.
 *
 *   formatCell(value, row, column) → string | DocumentFragment | Node
 *
 * A column's `format` may be:
 *   - a built-in string key ('text' | 'date' | 'number' | 'currency' | 'status')
 *   - a function (value, row) → string | Node
 *   - undefined, in which case `text` is used.
 *
 * Formatters return strings unless they need DOM (status → an atlas-badge);
 * the widget element wraps strings in text nodes so the output is always
 * safe for appending into an <atlas-table-cell>.
 */

/** @typedef {import('../data-source/types.js').Row} Row */

export function formatCell(value, row, column) {
  const fmt = column?.format;
  if (typeof fmt === 'function') return fmt(value, row);
  switch (fmt) {
    case 'date':     return formatDate(value);
    case 'number':   return formatNumber(value);
    case 'currency': return formatCurrency(value, column?.currency ?? 'USD');
    case 'status':   return renderStatusBadge(value);
    case 'text':
    default:         return value == null ? '' : String(value);
  }
}

export function formatDate(value) {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  try {
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function formatNumber(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  try { return n.toLocaleString(); } catch { return String(n); }
}

export function formatCurrency(value, currency = 'USD') {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  try {
    return n.toLocaleString(undefined, { style: 'currency', currency });
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function renderStatusBadge(value) {
  const text = value == null ? '' : String(value);
  const el = document.createElement('atlas-badge');
  el.setAttribute('status', text.toLowerCase());
  el.textContent = text;
  return el;
}
