/**
 * DataTableCore — pure state machine for <atlas-data-table>.
 *
 * No DOM, no events, no timers. Actions mutate state and notify listeners.
 * Selectors are pure reads. Mirrors the shape and conventions of
 * `packages/design/src/multi-select-core.js`.
 *
 * ── Status ───────────────────────────────────────────────────────
 *   'idle' | 'loading' | 'ready' | 'empty' | 'filtered-empty' | 'error'
 *
 * ── Delta contract ───────────────────────────────────────────────
 *   Actions that change rows return { changed, added, removed }
 *   where added / removed are row keys.
 */

import { sortRows, nextSortDir, type SortDirection } from './sort-core.ts';
import { filterRows, type FilterableColumn } from './filter-core.ts';
import {
  selectRow,
  unselectRow,
  toggleAllOnPage,
  clearSelection,
  type SelectionKey,
  type SelectionMode,
} from './selection-core.ts';
import { applyPatch, keyOf, type RowKey } from '../data-source/patch.ts';
import type { Row, RowPatch } from '../data-source/types.ts';

export const STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  EMPTY: 'empty',
  FILTERED_EMPTY: 'filtered-empty',
  ERROR: 'error',
} as const);

export type Status = typeof STATUS[keyof typeof STATUS];

export interface ColumnConfig<R extends Row = Row> extends FilterableColumn<R> {
  key: string | ((row: R) => unknown);
  label?: string;
  sortable?: boolean;
  align?: string;
  format?: unknown;
  currency?: string;
}

export interface DataTableCoreConfig<R extends Row = Row> {
  columns?: Array<ColumnConfig<R>>;
  rowKey?: RowKey<R>;
  pageSize?: number;
  selectionMode?: SelectionMode;
}

export interface DataTableState<R extends Row = Row> {
  status: Status;
  error: string | null;
  rows: R[];
  columns: Array<ColumnConfig<R>>;
  sortBy: string | null;
  sortDir: SortDirection;
  filters: Record<string, unknown>;
  page: number;
  pageSize: number;
  selection: Set<SelectionKey>;
  selectionMode: SelectionMode;
}

export interface TableDelta {
  changed: boolean;
  added: SelectionKey[];
  removed: SelectionKey[];
}

const NO_DELTA: TableDelta = Object.freeze({ changed: false, added: [], removed: [] }) as TableDelta;

export class DataTableCore<R extends Row = Row> {
  _columns: Array<ColumnConfig<R>>;
  _rowKey: RowKey<R>;
  _pageSize: number;
  _selectionMode: SelectionMode;

  _allRows: R[] = [];
  _sortBy: string | null = null;
  _sortDir: SortDirection = null;
  _filters: Record<string, unknown> = {};
  _page = 0;
  _selection: Set<SelectionKey> = new Set();
  _status: Status = STATUS.IDLE;
  _error: string | null = null;

  _listeners: Set<(state: DataTableState<R>) => void> = new Set();

  constructor(config: DataTableCoreConfig<R> = {}) {
    this._columns = Array.isArray(config.columns) ? config.columns.slice() : [];
    this._rowKey = config.rowKey ?? 'id';
    this._pageSize = normalizePageSize(config.pageSize);
    this._selectionMode = config.selectionMode ?? 'none';
  }

  // ── Observability ───────────────────────────────────────────────

  getState(): DataTableState<R> {
    return {
      status: this._status,
      error: this._error,
      rows: this._allRows,
      columns: this._columns,
      sortBy: this._sortBy,
      sortDir: this._sortDir,
      filters: { ...this._filters },
      page: this._page,
      pageSize: this._pageSize,
      selection: new Set(this._selection),
      selectionMode: this._selectionMode,
    };
  }

  subscribe(listener: (state: DataTableState<R>) => void): () => void {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  _notify(): void {
    const state = this.getState();
    for (const fn of this._listeners) {
      try { fn(state); } catch { /* listener errors don't corrupt core */ }
    }
  }

  // ── Selectors ───────────────────────────────────────────────────

  /** Rows after filters applied. */
  filteredRows(): R[] {
    return filterRows(this._allRows, this._filters, this._columns);
  }

  /** Rows after filter + sort. */
  sortedRows(): R[] {
    return sortRows(this.filteredRows(), {
      sortBy: this._sortBy,
      sortDir: this._sortDir,
      ...(typeof this._rowKey === 'string' ? { tiebreak: this._rowKey } : {}),
    });
  }

  /** Current visible page of rows. Whole list when pageSize is 0. */
  pageRows(): R[] {
    const sorted = this.sortedRows();
    if (this._pageSize <= 0) return sorted;
    const start = this._page * this._pageSize;
    return sorted.slice(start, start + this._pageSize);
  }

  pageCount(): number {
    if (this._pageSize <= 0) return 1;
    const n = this.filteredRows().length;
    return Math.max(1, Math.ceil(n / this._pageSize));
  }

  keyOf(row: R): SelectionKey {
    return keyOf(row, this._rowKey);
  }

  hasActiveFilters(): boolean {
    for (const v of Object.values(this._filters)) {
      if (v == null) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      return true;
    }
    return false;
  }

  // ── Actions ─────────────────────────────────────────────────────

  setColumns(columns: Array<ColumnConfig<R>> | null | undefined): TableDelta {
    this._columns = Array.isArray(columns) ? columns.slice() : [];
    this._notify();
    return NO_DELTA;
  }

  setStatus(status: Status, error: string | null = null): TableDelta {
    this._status = status;
    this._error = status === STATUS.ERROR ? (error ?? 'Something went wrong') : null;
    this._notify();
    return NO_DELTA;
  }

  setLoading(): TableDelta { return this.setStatus(STATUS.LOADING); }
  setError(message: string): TableDelta { return this.setStatus(STATUS.ERROR, message); }

  /**
   * Install the full row set (after a successful fetchAll).
   * Drops selection entries that no longer exist in the new rows.
   */
  setAllRows(rows: R[] | null | undefined): TableDelta {
    const next: R[] = Array.isArray(rows) ? rows.slice() : [];
    const prevKeys = new Set<SelectionKey>(this._allRows.map((r) => this.keyOf(r)));
    const nextKeys = new Set<SelectionKey>(next.map((r) => this.keyOf(r)));
    const added: SelectionKey[] = [];
    const removed: SelectionKey[] = [];
    for (const k of nextKeys) if (!prevKeys.has(k)) added.push(k);
    for (const k of prevKeys) if (!nextKeys.has(k)) removed.push(k);

    this._allRows = next;

    // Prune stale selections
    if (this._selection.size > 0) {
      const prunedSelection = new Set<SelectionKey>();
      for (const k of this._selection) if (nextKeys.has(k)) prunedSelection.add(k);
      this._selection = prunedSelection;
    }

    this._updateStatusAfterRowsChange();
    this._clampPage();
    this._notify();
    return { changed: added.length > 0 || removed.length > 0, added, removed };
  }

  /** Apply an SSE-style patch to the row set. */
  applyPatch(patch: RowPatch<R> | null | undefined): TableDelta {
    if (!patch || typeof patch !== 'object') return NO_DELTA;
    if (patch.type === 'reload') return NO_DELTA; // caller should refetch
    const before = this._allRows;
    const after = applyPatch(before, patch, this._rowKey);
    if (after === before) return NO_DELTA;

    const added: SelectionKey[] = [];
    const removed: SelectionKey[] = [];
    if (patch.type === 'upsert' && patch.row) {
      const k = this.keyOf(patch.row);
      if (!before.some((r) => this.keyOf(r) === k)) added.push(k);
    }
    if (patch.type === 'remove' && patch.rowKey != null) {
      removed.push(patch.rowKey);
      if (this._selection.has(patch.rowKey)) {
        const nextSel = new Set(this._selection);
        nextSel.delete(patch.rowKey);
        this._selection = nextSel;
      }
    }

    this._allRows = after;
    this._updateStatusAfterRowsChange();
    this._clampPage();
    this._notify();
    return { changed: true, added, removed };
  }

  upsertRow(row: R): TableDelta {
    return this.applyPatch({ type: 'upsert', row });
  }

  removeRow(rowKey: SelectionKey): TableDelta {
    return this.applyPatch({ type: 'remove', rowKey });
  }

  setSort(columnKey: string, direction?: SortDirection): TableDelta {
    const dir: SortDirection = direction === undefined
      ? (this._sortBy === columnKey ? nextSortDir(this._sortDir) : 'asc')
      : direction;
    this._sortBy = dir == null ? null : columnKey;
    this._sortDir = dir;
    this._page = 0;
    this._notify();
    return NO_DELTA;
  }

  setFilter(columnKey: string, value: unknown): TableDelta {
    if (value == null || (typeof value === 'string' && value === '')) {
      if (!(columnKey in this._filters)) return NO_DELTA;
      const next = { ...this._filters };
      delete next[columnKey];
      this._filters = next;
    } else {
      this._filters = { ...this._filters, [columnKey]: value };
    }
    this._page = 0;
    this._updateStatusAfterRowsChange();
    this._notify();
    return NO_DELTA;
  }

  clearFilters(): TableDelta {
    if (Object.keys(this._filters).length === 0) return NO_DELTA;
    this._filters = {};
    this._page = 0;
    this._updateStatusAfterRowsChange();
    this._notify();
    return NO_DELTA;
  }

  setPage(n: number): TableDelta {
    const max = this.pageCount() - 1;
    const next = clamp(Math.floor(Number(n) || 0), 0, Math.max(0, max));
    if (next === this._page) return NO_DELTA;
    this._page = next;
    this._notify();
    return NO_DELTA;
  }

  setPageSize(size: number | string | null | undefined): TableDelta {
    const next = normalizePageSize(size);
    if (next === this._pageSize) return NO_DELTA;
    this._pageSize = next;
    this._page = 0;
    this._notify();
    return NO_DELTA;
  }

  setSelectionMode(mode: SelectionMode | string): TableDelta {
    const next: SelectionMode = mode === 'single' || mode === 'multi' ? mode : 'none';
    this._selectionMode = next;
    if (next === 'none' && this._selection.size > 0) {
      this._selection = new Set();
    } else if (next === 'single' && this._selection.size > 1) {
      const [first] = this._selection;
      this._selection = first !== undefined ? new Set([first]) : new Set();
    }
    this._notify();
    return NO_DELTA;
  }

  selectRow(key: SelectionKey): TableDelta {
    const before = this._selection;
    const next = selectRow(this._selectionMode, before, key);
    if (next === before) return NO_DELTA;
    this._selection = next;
    this._notify();
    return { changed: true, added: [key], removed: [...before].filter((k) => !next.has(k)) };
  }

  unselectRow(key: SelectionKey): TableDelta {
    const before = this._selection;
    const next = unselectRow(this._selectionMode, before, key);
    if (next === before) return NO_DELTA;
    this._selection = next;
    this._notify();
    return { changed: true, added: [], removed: [key] };
  }

  toggleRowSelection(key: SelectionKey): TableDelta {
    return this._selection.has(key) ? this.unselectRow(key) : this.selectRow(key);
  }

  toggleSelectAllOnPage(): TableDelta {
    const keys = this.pageRows().map((r) => this.keyOf(r));
    const before = this._selection;
    const next = toggleAllOnPage(this._selectionMode, before, keys);
    if (next === before) return NO_DELTA;
    const added = [...next].filter((k) => !before.has(k));
    const removed = [...before].filter((k) => !next.has(k));
    this._selection = next;
    this._notify();
    return { changed: true, added, removed };
  }

  clearSelection(): TableDelta {
    const before = this._selection;
    const next = clearSelection(before);
    if (next === before) return NO_DELTA;
    const removed = [...before];
    this._selection = next;
    this._notify();
    return { changed: true, added: [], removed };
  }

  // ── Internals ───────────────────────────────────────────────────

  _updateStatusAfterRowsChange(): void {
    if (this._allRows.length === 0) {
      this._status = STATUS.EMPTY;
      return;
    }
    if (this.hasActiveFilters() && this.filteredRows().length === 0) {
      this._status = STATUS.FILTERED_EMPTY;
      return;
    }
    this._status = STATUS.READY;
  }

  _clampPage(): void {
    const max = Math.max(0, this.pageCount() - 1);
    if (this._page > max) this._page = max;
  }
}

function normalizePageSize(size: unknown): number {
  if (size == null || size === '') return 25;
  const n = Number(size);
  if (!Number.isFinite(n) || n < 0) return 25;
  return Math.floor(n);
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
