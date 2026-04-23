/**
 * Stable sort for row collections.
 *
 *   sortRows(rows, { sortBy, sortDir, comparator, tiebreak })
 *
 * - Stability is guaranteed by pairing rows with their original index.
 * - `comparator(a, b)` overrides the default (accepts a function or is
 *   omitted for the built-in numeric/string aware compare).
 * - `tiebreak` is a secondary key used only when two rows tie on the
 *   primary comparator — useful to keep a natural order (e.g. by id).
 */

/** @typedef {import('../data-source/types.js').Row} Row */

/**
 * @param {Row[]} rows
 * @param {{
 *   sortBy: string | ((row: Row) => unknown) | null,
 *   sortDir: 'asc' | 'desc' | null,
 *   comparator?: (a: unknown, b: unknown) => number,
 *   tiebreak?: string | ((row: Row) => unknown),
 * }} opts
 * @returns {Row[]}
 */
export function sortRows(rows, opts) {
  const { sortBy, sortDir, comparator, tiebreak } = opts || {};
  if (!sortBy || !sortDir) return rows.slice();

  const pick = typeof sortBy === 'function'
    ? sortBy
    : (row) => /** @type {any} */ (row)[sortBy];
  const tieKey = tiebreak
    ? (typeof tiebreak === 'function' ? tiebreak : (r) => /** @type {any} */ (r)[tiebreak])
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
 *
 * @param {'asc' | 'desc' | null} current
 * @returns {'asc' | 'desc' | null}
 */
export function nextSortDir(current) {
  if (current === 'asc') return 'desc';
  if (current === 'desc') return null;
  return 'asc';
}

/**
 * Default compare: numeric when both sides are numbers (including numeric
 * strings), locale string compare otherwise. `null`/`undefined` sort last.
 *
 * @param {unknown} a
 * @param {unknown} b
 */
export function defaultCompare(a, b) {
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
