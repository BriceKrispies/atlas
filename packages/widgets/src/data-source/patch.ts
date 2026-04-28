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
  if (typeof rowKey === 'string') return (row as Record<string, unknown>)[rowKey] as string | number;
  return (row as Record<string, unknown>)['id'] as string | number;
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
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.is(ao[k], bo[k])) return false;
  }
  return true;
}
