/**
 * Row filtering.
 *
 *   filterRows(rows, filters, columns)
 *
 * Filter values are loosely typed at this layer (the UI installs whatever
 * the input control produces), but each column's `filter.matches` callback
 * receives the column's typed value V via `Column<R, V>`.
 */
import type { Row } from '../data-source/types.ts';
export type FilterType = 'text' | 'eq' | 'select' | 'range' | 'custom';
export interface RangeFilter {
    min?: number | string | null;
    max?: number | string | null;
}
/**
 * Filter-value shape per `type`. The data-table component installs the
 * raw filter input (typically a string) and `filterRows` interprets it
 * according to the column's filter `type`. The custom `matches` callback
 * declares its own filter-value contract per column.
 */
export type FilterValueFor<V> = string | V | readonly V[] | RangeFilter | null | undefined;
export interface FilterConfig<R extends Row, V> {
    type?: FilterType;
    /** Custom predicate — receives the raw filter input and the column's V. */
    matches?: (filter: FilterValueFor<V>, value: V, row: R) => boolean;
    label?: string;
    placeholder?: string;
}
export interface FilterableColumn<R extends Row, V = unknown> {
    /** Either a row-property name (yielding R[K]) or a derived accessor returning V. */
    key: keyof R | ((row: R) => V);
    filter?: FilterConfig<R, V>;
    label?: string;
}
export function filterRows<R extends Row>(rows: R[], filters: Record<string, unknown>, columns: ReadonlyArray<FilterableColumn<R, unknown>>): R[] {
    if (!filters || typeof filters !== 'object')
        return rows;
    const active = Object.entries(filters).filter(function ([, v]) {
        return !isBlank(v);
    });
    if (active.length === 0)
        return rows;
    const columnsByKey = new Map<string, FilterableColumn<R, unknown>>();
    for (const c of columns || []) {
        const k = typeof c.key === 'string' ? c.key : null;
        if (k)
            columnsByKey.set(k, c);
    }
    return rows.filter(function (row) {
        for (const [columnKey, filterValue] of active) {
            const column = columnsByKey.get(columnKey);
            if (!column)
                continue;
            const rowValue = readColumnValue(row, column);
            if (!matchFilter(column.filter, filterValue, rowValue, row))
                return false;
        }
        return true;
    });
}
function readColumnValue<R extends Row>(row: R, column: FilterableColumn<R, unknown>): unknown {
    if (typeof column.key === 'function')
        return column.key(row);
    return (row as Record<keyof R, unknown>)[column.key];
}
function isBlank(v: unknown): boolean {
    if (v == null)
        return true;
    if (typeof v === 'string')
        return v.trim() === '';
    if (Array.isArray(v))
        return v.length === 0;
    if (typeof v === 'object') {
        const obj = v as {
            min?: unknown;
            max?: unknown;
        };
        // range: blank if both min and max are nullish
        if ('min' in obj || 'max' in obj) {
            return obj.min == null && obj.max == null;
        }
    }
    return false;
}
function matchFilter<R extends Row>(config: FilterConfig<R, unknown> | undefined, filterValue: unknown, rowValue: unknown, row: R): boolean {
    const type: FilterType = config?.type ?? 'text';
    switch (type) {
        case 'text': return matchText(filterValue, rowValue);
        case 'eq': return String(rowValue ?? '') === String(filterValue ?? '');
        case 'select': return matchSelect(filterValue, rowValue);
        case 'range': return matchRange(filterValue, rowValue);
        case 'custom': return typeof config?.matches === 'function'
            ? !!config.matches(filterValue as FilterValueFor<unknown>, rowValue, row)
            : true;
        default: return matchText(filterValue, rowValue);
    }
}
function matchText(filter: unknown, value: unknown): boolean {
    const q = String(filter ?? '').trim().toLowerCase();
    if (!q)
        return true;
    return String(value ?? '').toLowerCase().includes(q);
}
function matchSelect(filter: unknown, value: unknown): boolean {
    if (Array.isArray(filter)) {
        if (filter.length === 0)
            return true;
        return filter.some(function (f) {
            return String(f) === String(value);
        });
    }
    return String(filter ?? '') === String(value ?? '');
}
function matchRange(filter: unknown, value: unknown): boolean {
    let min: unknown;
    let max: unknown;
    if (filter && typeof filter === 'object') {
        const obj = filter as {
            min?: unknown;
            max?: unknown;
        };
        min = obj.min;
        max = obj.max;
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n))
        return false;
    if (min != null && n < Number(min))
        return false;
    if (max != null && n > Number(max))
        return false;
    return true;
}
