/**
 * arrayDataSource — static in-memory DataSource for tests and sandbox specimens.
 *
 * Shape:
 *   const ds = arrayDataSource([{ id: 1, title: 'a' }, …]);
 *   await ds.fetchAll();  // { rows, total }
 *
 * The returned object also exposes `setRows(next)` so specimens can replace
 * the underlying data without recreating the DataSource; any subscribers
 * receive a `reload` patch.
 */

import type { DataSource, DataSourceResult, Row, RowPatch } from './types.ts';

export interface ArrayDataSource<R extends Row = Row> extends DataSource<R> {
  setRows(rows: R[] | null | undefined): void;
  emit(patch: RowPatch<R>): void;
}

export function arrayDataSource<R extends Row = Row>(
  initial: R[] | null | undefined = [],
): ArrayDataSource<R> {
  let rows: R[] = Array.isArray(initial) ? initial.slice() : [];
  const listeners = new Set<(patch: RowPatch<R>) => void>();

  return {
    capabilities: ['sort', 'filter', 'page', 'stream'],

    async fetchAll(): Promise<DataSourceResult<R>> {
      return { rows: rows.slice(), total: rows.length };
    },

    subscribe(cb: (patch: RowPatch<R>) => void): () => void {
      if (typeof cb !== 'function') return () => {};
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },

    setRows(next: R[] | null | undefined): void {
      rows = Array.isArray(next) ? next.slice() : [];
      for (const cb of listeners) {
        try { cb({ type: 'reload' }); } catch { /* listener errors don't corrupt */ }
      }
    },

    emit(patch: RowPatch<R>): void {
      for (const cb of listeners) {
        try { cb(patch); } catch { /* swallow */ }
      }
    },
  };
}
