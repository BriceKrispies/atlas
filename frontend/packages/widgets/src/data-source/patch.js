/**
 * Pure row-patching helpers.
 *
 *   applyPatch(rows, patch, rowKey) → nextRows
 *   diff(prev, next, rowKey)         → patches[]
 *
 * `rowKey` may be a string (field name) or a function (row → key).
 */

/** @typedef {import('./types.js').Row} Row */
/** @typedef {import('./types.js').RowPatch} RowPatch */

/**
 * @param {Row} row
 * @param {string | ((row: Row) => string | number)} rowKey
 * @returns {string | number}
 */
export function keyOf(row, rowKey) {
  if (typeof rowKey === 'function') return rowKey(row);
  if (typeof rowKey === 'string') return /** @type {any} */ (row)[rowKey];
  return /** @type {any} */ (row).id;
}

/**
 * Apply a single patch to a row array, returning a new array.
 * For `reload`, callers should refetch; this helper just returns `rows` unchanged.
 *
 * @param {Row[]} rows
 * @param {RowPatch} patch
 * @param {string | ((row: Row) => string | number)} rowKey
 * @returns {Row[]}
 */
export function applyPatch(rows, patch, rowKey) {
  if (!patch || typeof patch !== 'object') return rows;
  if (patch.type === 'reload') return rows;

  if (patch.type === 'upsert') {
    if (!patch.row) return rows;
    const k = keyOf(patch.row, rowKey);
    const idx = rows.findIndex((r) => keyOf(r, rowKey) === k);
    if (idx === -1) return [...rows, patch.row];
    const next = rows.slice();
    next[idx] = patch.row;
    return next;
  }

  if (patch.type === 'remove') {
    const k = patch.rowKey;
    if (k == null) return rows;
    const idx = rows.findIndex((r) => keyOf(r, rowKey) === k);
    if (idx === -1) return rows;
    const next = rows.slice();
    next.splice(idx, 1);
    return next;
  }

  return rows;
}

/**
 * Diff two row arrays into a sequence of upsert/remove patches.
 * Order: removes first, then upserts (new rows appended in `next` order).
 *
 * @param {Row[]} prev
 * @param {Row[]} next
 * @param {string | ((row: Row) => string | number)} rowKey
 * @returns {RowPatch[]}
 */
export function diff(prev, next, rowKey) {
  const prevByKey = new Map();
  for (const r of prev) prevByKey.set(keyOf(r, rowKey), r);
  const nextKeys = new Set();
  /** @type {RowPatch[]} */
  const patches = [];

  for (const r of next) {
    nextKeys.add(keyOf(r, rowKey));
  }
  for (const [k] of prevByKey) {
    if (!nextKeys.has(k)) patches.push({ type: 'remove', rowKey: k });
  }
  for (const r of next) {
    const k = keyOf(r, rowKey);
    const prior = prevByKey.get(k);
    if (!prior || !shallowEqual(prior, r)) {
      patches.push({ type: 'upsert', row: r });
    }
  }
  return patches;
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.is(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k])) return false;
  }
  return true;
}
