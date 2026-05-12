/**
 * Pure row-patching helpers.
 *
 *   applyPatch(rows, patch, rowKey) → nextRows
 *   diff(prev, next, rowKey)         → patches[]
 *
 * `rowKey` may be a string (field name) or a function (row → key).
 */

import type { Row, RowPatch } from './types.ts';

export type RowKey<R extends Row = Row> =
  | string
  | ((row: R) => string | number);

export function keyOf<R extends Row>(row: R, rowKey: RowKey<R> | undefined): string | number {
  if (typeof rowKey === 'function') return rowKey(row);
  // `R extends Row` (`Record<string, unknown>`) — index reads are typed
  // `unknown`. Narrow at runtime so we never return non-keyable values
  // silently; an unknown shape surfaces as a clear runtime error rather
  // than a `NaN` key.
  const raw = typeof rowKey === 'string' ? row[rowKey] : row['id'];
  if (typeof raw === 'string' || typeof raw === 'number') return raw;
  throw new Error(
    `keyOf: row key ${typeof rowKey === 'string' ? rowKey : 'id'} is ${typeof raw}, expected string|number`,
  );
}

/**
 * Apply a single patch to a row array, returning a new array.
 * For `reload`, callers should refetch; this helper just returns `rows` unchanged.
 */
export function applyPatch<R extends Row>(
  rows: R[],
  patch: RowPatch<R> | null | undefined,
  rowKey: RowKey<R> | undefined,
): R[] {
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
 */
export function diff<R extends Row>(
  prev: R[],
  next: R[],
  rowKey: RowKey<R> | undefined,
): RowPatch<R>[] {
  const prevByKey = new Map<string | number, R>();
  for (const r of prev) prevByKey.set(keyOf(r, rowKey), r);
  const nextKeys = new Set<string | number>();
  const patches: RowPatch<R>[] = [];

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

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isRecord(a) || !isRecord(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

/** Type-guard: `unknown` → `Record<string, unknown>`. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
