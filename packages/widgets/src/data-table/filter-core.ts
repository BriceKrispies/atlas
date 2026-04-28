/**
 * Row filtering.
 *
 *   filterRows(rows, filters, columns)
 */

import type { Row } from '../data-source/types.ts';

export type FilterType = 'text' | 'eq' | 'select' | 'range' | 'custom' | string;

export interface FilterConfig<R extends Row = Row> {
  type?: FilterType;
  matches?: (filter: unknown, value: unknown, row: R) => boolean;
  label?: string;
  placeholder?: string;
}

export interface FilterableColumn<R extends Row = Row> {
  key: string | ((row: R) => unknown);
  filter?: FilterConfig<R>;
  label?: string;
}

export function filterRows<R extends Row>(
  rows: R[],
  filters: Record<string, unknown>,
  columns: ReadonlyArray<FilterableColumn<R>>,
): R[] {
  if (!filters || typeof filters !== 'object') return rows;
  const active = Object.entries(filters).filter(([, v]) => !isBlank(v));
  if (active.length === 0) return rows;

  const columnsByKey = new Map<string, FilterableColumn<R>>();
  for (const c of columns || []) {
    const k = typeof c.key === 'string' ? c.key : null;
    if (k) columnsByKey.set(k, c);
  }

  return rows.filter((row) => {
    for (const [columnKey, filterValue] of active) {
      const column = columnsByKey.get(columnKey);
      if (!column) continue;
      const accessor: (r: R) => unknown = typeof column.key === 'function'
        ? column.key
        : (r: R) => (r as Record<string, unknown>)[column.key as string];
      const rowValue = accessor(row);
      if (!matchFilter(column.filter, filterValue, rowValue, row)) return false;
    }
    return true;
  });
}

function isBlank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    // range: blank if both min and max are nullish
    if ('min' in obj || 'max' in obj) {
      return obj['min'] == null && obj['max'] == null;
    }
  }
  return false;
}

function matchFilter<R extends Row>(
  config: FilterConfig<R> | undefined,
  filterValue: unknown,
  rowValue: unknown,
  row: R,
): boolean {
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

function matchText(filter: unknown, value: unknown): boolean {
  const q = String(filter ?? '').trim().toLowerCase();
  if (!q) return true;
  return String(value ?? '').toLowerCase().includes(q);
}

function matchSelect(filter: unknown, value: unknown): boolean {
  if (Array.isArray(filter)) {
    if (filter.length === 0) return true;
    return filter.some((f) => String(f) === String(value));
  }
  return String(filter ?? '') === String(value ?? '');
}

function matchRange(filter: unknown, value: unknown): boolean {
  const { min, max } = (filter as { min?: unknown; max?: unknown }) ?? {};
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return false;
  if (min != null && n < Number(min)) return false;
  if (max != null && n > Number(max)) return false;
  return true;
}
