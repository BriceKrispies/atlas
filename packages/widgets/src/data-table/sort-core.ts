/**
 * Stable sort for row collections.
 *
 *   sortRows(rows, { sortBy, sortDir, comparator, tiebreak })
 */

import type { Row } from '../data-source/types.ts';

export type SortDirection = 'asc' | 'desc' | null;

export interface SortOptions<R extends Row = Row> {
  sortBy: string | ((row: R) => unknown) | null;
  sortDir: SortDirection;
  comparator?: (a: unknown, b: unknown) => number;
  tiebreak?: string | ((row: R) => unknown);
}

export function sortRows<R extends Row>(rows: R[], opts: SortOptions<R>): R[] {
  const { sortBy, sortDir, comparator, tiebreak } = opts || {};
  if (!sortBy || !sortDir) return rows.slice();

  const pick: (row: R) => unknown = typeof sortBy === 'function'
    ? sortBy
    : (row: R) => (row as Record<string, unknown>)[sortBy];
  const tieKey: ((row: R) => unknown) | null = tiebreak
    ? (typeof tiebreak === 'function' ? tiebreak : (r: R) => (r as Record<string, unknown>)[tiebreak])
    : null;
  const cmp = comparator ?? defaultCompare;
  const dir = sortDir === 'desc' ? -1 : 1;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const av = pick(a.row);
      const bv = pick(b.row);
      const primary = cmp(av, bv);
      if (primary !== 0) return primary * dir;
      if (tieKey) {
        const tp = defaultCompare(tieKey(a.row), tieKey(b.row));
        if (tp !== 0) return tp;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

/**
 * Flip through the three-state sort cycle: none → asc → desc → none.
 * Passing `null` as current returns 'asc'.
 */
export function nextSortDir(current: SortDirection): SortDirection {
  if (current === 'asc') return 'desc';
  if (current === 'desc') return null;
  return 'asc';
}

/**
 * Default compare: numeric when both sides are numbers (including numeric
 * strings), locale string compare otherwise. `null`/`undefined` sort last.
 */
export function defaultCompare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const an = typeof a === 'number' ? a : Number(a);
  const bn = typeof b === 'number' ? b : Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) {
    return an < bn ? -1 : an > bn ? 1 : 0;
  }
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
}
