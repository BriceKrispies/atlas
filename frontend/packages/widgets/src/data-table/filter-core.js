/**
 * Row filtering.
 *
 *   filterRows(rows, filters, columns)
 *
 * `filters` is a plain map: column-key → value. Empty string, null, undefined,
 * and empty arrays are treated as "no filter" for that column.
 *
 * `columns` supplies per-column config — specifically the filter operator
 * (`type`) and field accessor. Unknown column keys are ignored (no-op).
 *
 * Supported operators (column.filter.type):
 *   - 'text'    (default): case-insensitive substring match
 *   - 'eq'     : strict equality (String(v) === String(filter))
 *   - 'select' : exact match; filter value may be array → "in" semantics
 *   - 'range'  : { min?, max? } inclusive numeric range
 *   - 'custom' : column.filter.matches(value, rowValue, row)
 */

/** @typedef {import('../data-source/types.js').Row} Row */

/**
 * @param {Row[]} rows
 * @param {Record<string, unknown>} filters
 * @param {Array<{
 *   key: string | ((row: Row) => unknown),
 *   filter?: { type?: string, matches?: (filter: unknown, value: unknown, row: Row) => boolean }
 * }>} columns
 * @returns {Row[]}
 */
export function filterRows(rows, filters, columns) {
  if (!filters || typeof filters !== 'object') return rows;
  const active = Object.entries(filters).filter(([, v]) => !isBlank(v));
  if (active.length === 0) return rows;

  const columnsByKey = new Map();
  for (const c of columns || []) {
    const k = typeof c.key === 'string' ? c.key : null;
    if (k) columnsByKey.set(k, c);
  }

  return rows.filter((row) => {
    for (const [columnKey, filterValue] of active) {
      const column = columnsByKey.get(columnKey);
      if (!column) continue;
      const accessor = typeof column.key === 'function'
        ? column.key
        : (r) => /** @type {any} */ (r)[column.key];
      const rowValue = accessor(row);
      if (!matchFilter(column.filter, filterValue, rowValue, row)) return false;
    }
    return true;
  });
}

function isBlank(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    // range: blank if both min and max are nullish
    if ('min' in /** @type {any} */ (v) || 'max' in /** @type {any} */ (v)) {
      const r = /** @type {any} */ (v);
      return r.min == null && r.max == null;
    }
  }
  return false;
}

function matchFilter(config, filterValue, rowValue, row) {
  const type = config?.type ?? 'text';
  switch (type) {
    case 'text': return matchText(filterValue, rowValue);
    case 'eq':   return String(rowValue ?? '') === String(filterValue ?? '');
    case 'select': return matchSelect(filterValue, rowValue);
    case 'range':  return matchRange(filterValue, rowValue);
    case 'custom': return typeof config?.matches === 'function'
      ? !!config.matches(filterValue, rowValue, row)
      : true;
    default: return matchText(filterValue, rowValue);
  }
}

function matchText(filter, value) {
  const q = String(filter ?? '').trim().toLowerCase();
  if (!q) return true;
  return String(value ?? '').toLowerCase().includes(q);
}

function matchSelect(filter, value) {
  if (Array.isArray(filter)) {
    if (filter.length === 0) return true;
    return filter.some((f) => String(f) === String(value));
  }
  return String(filter ?? '') === String(value ?? '');
}

function matchRange(filter, value) {
  const { min, max } = /** @type {any} */ (filter) || {};
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return false;
  if (min != null && n < Number(min)) return false;
  if (max != null && n > Number(max)) return false;
  return true;
}
