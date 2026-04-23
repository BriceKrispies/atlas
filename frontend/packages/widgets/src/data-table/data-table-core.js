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

import { sortRows, nextSortDir } from './sort-core.js';
import { filterRows } from './filter-core.js';
import {
  selectRow,
  unselectRow,
  toggleRow,
  toggleAllOnPage,
  clearSelection,
} from './selection-core.js';
import { applyPatch, keyOf } from '../data-source/patch.js';

/** @typedef {import('../data-source/types.js').Row} Row */
/** @typedef {import('../data-source/types.js').RowPatch} RowPatch */

export const STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  EMPTY: 'empty',
  FILTERED_EMPTY: 'filtered-empty',
  ERROR: 'error',
});

const NO_DELTA = Object.freeze({ changed: false, added: [], removed: [] });

export class DataTableCore {
  /**
   * @param {{
   *   columns?: Array<any>,
   *   rowKey?: string | ((row: Row) => string | number),
   *   pageSize?: number,
   *   selectionMode?: 'none' | 'single' | 'multi',
   * }} [config]
   */
  constructor(config = {}) {
    this._columns = Array.isArray(config.columns) ? config.columns.slice() : [];
    this._rowKey = config.rowKey ?? 'id';
    this._pageSize = normalizePageSize(config.pageSize);
    this._selectionMode = config.selectionMode ?? 'none';

    /** @type {Row[]} */
    this._allRows = [];
    /** @type {string | null} */
    this._sortBy = null;
    /** @type {'asc' | 'desc' | null} */
    this._sortDir = null;
    /** @type {Record<string, unknown>} */
    this._filters = {};
    this._page = 0;
    /** @type {Set<string | number>} */
    this._selection = new Set();
    this._status = STATUS.IDLE;
    /** @type {string | null} */
    this._error = null;

    /** @type {Set<(state: ReturnType<DataTableCore['getState']>) => void>} */
    this._listeners = new Set();
  }

  // ── Observability ───────────────────────────────────────────────

  getState() {
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

  /** @param {(state: ReturnType<DataTableCore['getState']>) => void} listener */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  _notify() {
    const state = this.getState();
    for (const fn of this._listeners) {
      try { fn(state); } catch { /* listener errors don't corrupt core */ }
    }
  }

  // ── Selectors ───────────────────────────────────────────────────

  /** Rows after filters applied. */
  filteredRows() {
    return filterRows(this._allRows, this._filters, this._columns);
  }

  /** Rows after filter + sort. */
  sortedRows() {
    return sortRows(this.filteredRows(), {
      sortBy: this._sortBy,
      sortDir: this._sortDir,
      tiebreak: typeof this._rowKey === 'string' ? this._rowKey : undefined,
    });
  }

  /** Current visible page of rows. Whole list when pageSize is 0. */
  pageRows() {
    const sorted = this.sortedRows();
    if (this._pageSize <= 0) return sorted;
    const start = this._page * this._pageSize;
    return sorted.slice(start, start + this._pageSize);
  }

  pageCount() {
    if (this._pageSize <= 0) return 1;
    const n = this.filteredRows().length;
    return Math.max(1, Math.ceil(n / this._pageSize));
  }

  keyOf(row) {
    return keyOf(row, this._rowKey);
  }

  hasActiveFilters() {
    for (const v of Object.values(this._filters)) {
      if (v == null) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      return true;
    }
    return false;
  }

  // ── Actions ─────────────────────────────────────────────────────

  setColumns(columns) {
    this._columns = Array.isArray(columns) ? columns.slice() : [];
    this._notify();
    return NO_DELTA;
  }

  setStatus(status, error = null) {
    this._status = status;
    this._error = status === STATUS.ERROR ? (error ?? 'Something went wrong') : null;
    this._notify();
    return NO_DELTA;
  }

  setLoading() { return this.setStatus(STATUS.LOADING); }
  setError(message) { return this.setStatus(STATUS.ERROR, message); }

  /**
   * Install the full row set (after a successful fetchAll).
   * Drops selection entries that no longer exist in the new rows.
   *
   * @param {Row[]} rows
   */
  setAllRows(rows) {
    const next = Array.isArray(rows) ? rows.slice() : [];
    const prevKeys = new Set(this._allRows.map((r) => this.keyOf(r)));
    const nextKeys = new Set(next.map((r) => this.keyOf(r)));
    const added = [];
    const removed = [];
    for (const k of nextKeys) if (!prevKeys.has(k)) added.push(k);
    for (const k of prevKeys) if (!nextKeys.has(k)) removed.push(k);

    this._allRows = next;

    // Prune stale selections
    if (this._selection.size > 0) {
      const prunedSelection = new Set();
      for (const k of this._selection) if (nextKeys.has(k)) prunedSelection.add(k);
      this._selection = prunedSelection;
    }

    this._updateStatusAfterRowsChange();
    this._clampPage();
    this._notify();
    return { changed: added.length > 0 || removed.length > 0, added, removed };
  }

  /** Apply an SSE-style patch to the row set. */
  applyPatch(patch) {
    if (!patch || typeof patch !== 'object') return NO_DELTA;
    if (patch.type === 'reload') return NO_DELTA; // caller should refetch
    const before = this._allRows;
    const after = applyPatch(before, patch, this._rowKey);
    if (after === before) return NO_DELTA;

    /** @type {(string|number)[]} */
    const added = [];
    /** @type {(string|number)[]} */
    const removed = [];
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

  upsertRow(row) {
    return this.applyPatch({ type: 'upsert', row });
  }

  removeRow(rowKey) {
    return this.applyPatch({ type: 'remove', rowKey });
  }

  setSort(columnKey, direction) {
    const dir = direction === undefined
      ? (this._sortBy === columnKey ? nextSortDir(this._sortDir) : 'asc')
      : direction;
    this._sortBy = dir == null ? null : columnKey;
    this._sortDir = dir;
    this._page = 0;
    this._notify();
    return NO_DELTA;
  }

  setFilter(columnKey, value) {
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

  clearFilters() {
    if (Object.keys(this._filters).length === 0) return NO_DELTA;
    this._filters = {};
    this._page = 0;
    this._updateStatusAfterRowsChange();
    this._notify();
    return NO_DELTA;
  }

  setPage(n) {
    const max = this.pageCount() - 1;
    const next = clamp(Math.floor(Number(n) || 0), 0, Math.max(0, max));
    if (next === this._page) return NO_DELTA;
    this._page = next;
    this._notify();
    return NO_DELTA;
  }

  setPageSize(size) {
    const next = normalizePageSize(size);
    if (next === this._pageSize) return NO_DELTA;
    this._pageSize = next;
    this._page = 0;
    this._notify();
    return NO_DELTA;
  }

  setSelectionMode(mode) {
    const next = mode === 'single' || mode === 'multi' ? mode : 'none';
    this._selectionMode = next;
    if (next === 'none' && this._selection.size > 0) {
      this._selection = new Set();
    } else if (next === 'single' && this._selection.size > 1) {
      const [first] = this._selection;
      this._selection = new Set([first]);
    }
    this._notify();
    return NO_DELTA;
  }

  selectRow(key) {
    const before = this._selection;
    const next = selectRow(this._selectionMode, before, key);
    if (next === before) return NO_DELTA;
    this._selection = next;
    this._notify();
    return { changed: true, added: [key], removed: [...before].filter((k) => !next.has(k)) };
  }

  unselectRow(key) {
    const before = this._selection;
    const next = unselectRow(this._selectionMode, before, key);
    if (next === before) return NO_DELTA;
    this._selection = next;
    this._notify();
    return { changed: true, added: [], removed: [key] };
  }

  toggleRowSelection(key) {
    return this._selection.has(key) ? this.unselectRow(key) : this.selectRow(key);
  }

  toggleSelectAllOnPage() {
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

  clearSelection() {
    const before = this._selection;
    const next = clearSelection(before);
    if (next === before) return NO_DELTA;
    const removed = [...before];
    this._selection = next;
    this._notify();
    return { changed: true, added: [], removed };
  }

  // ── Internals ───────────────────────────────────────────────────

  _updateStatusAfterRowsChange() {
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

  _clampPage() {
    const max = Math.max(0, this.pageCount() - 1);
    if (this._page > max) this._page = max;
  }
}

function normalizePageSize(size) {
  if (size == null || size === '') return 25;
  const n = Number(size);
  if (!Number.isFinite(n) || n < 0) return 25;
  return Math.floor(n);
}

function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}
