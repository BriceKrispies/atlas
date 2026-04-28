import { describe, it, expect } from 'vitest';
import { DataTableCore, STATUS, type ColumnConfig, type DataTableCoreConfig, type DataTableState } from '../src/data-table/data-table-core.ts';

interface TestRow extends Record<string, unknown> {
  id: number;
  title: string;
  status: string;
  score: number;
}

const COLUMNS: Array<ColumnConfig<TestRow>> = [
  { key: 'title', label: 'Title', sortable: true, filter: { type: 'text' } },
  { key: 'status', label: 'Status', sortable: true, filter: { type: 'select' } },
  { key: 'score', label: 'Score', sortable: true, filter: { type: 'range' } },
];

const SAMPLE: TestRow[] = [
  { id: 1, title: 'Alpha',   status: 'draft',     score: 10 },
  { id: 2, title: 'Bravo',   status: 'published', score: 30 },
  { id: 3, title: 'Charlie', status: 'published', score: 20 },
  { id: 4, title: 'Delta',   status: 'draft',     score: 5  },
];

function makeCore(overrides: Partial<DataTableCoreConfig<TestRow>> = {}): DataTableCore<TestRow> {
  return new DataTableCore<TestRow>({ columns: COLUMNS, rowKey: 'id', pageSize: 2, ...overrides });
}

describe('DataTableCore', () => {
  it('initial state is idle with empty rows', () => {
    const core = makeCore();
    const s = core.getState();
    expect(s.status).toBe(STATUS.IDLE);
    expect(s.rows).toEqual([]);
    expect(s.page).toBe(0);
    expect(core.pageCount()).toBe(1);
  });

  it('setAllRows → ready + prunes stale selection', () => {
    const core = makeCore({ selectionMode: 'multi' });
    core.setAllRows(SAMPLE);
    core.selectRow(2);
    expect([...core.getState().selection]).toEqual([2]);

    core.setAllRows(SAMPLE.filter((r) => r.id !== 2));
    expect([...core.getState().selection]).toEqual([]);
    expect(core.getState().status).toBe(STATUS.READY);
  });

  it('setAllRows with [] → empty status', () => {
    const core = makeCore();
    core.setAllRows([]);
    expect(core.getState().status).toBe(STATUS.EMPTY);
  });

  it('setFilter on text narrows rows; zero-match → filtered-empty', () => {
    const core = makeCore();
    core.setAllRows(SAMPLE);
    core.setFilter('title', 'alp');
    expect(core.filteredRows().map((r) => r.id)).toEqual([1]);

    core.setFilter('title', 'no-match-ever');
    expect(core.getState().status).toBe(STATUS.FILTERED_EMPTY);

    core.clearFilters();
    expect(core.getState().status).toBe(STATUS.READY);
    expect(core.filteredRows().length).toBe(4);
  });

  it('setSort cycles asc → desc → none, resets page', () => {
    const core = makeCore();
    core.setAllRows(SAMPLE);
    core.setPage(1);

    core.setSort('title'); // asc
    let s = core.getState();
    expect(s.sortBy).toBe('title');
    expect(s.sortDir).toBe('asc');
    expect(s.page).toBe(0);
    expect(core.sortedRows().map((r) => r.title)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);

    core.setSort('title'); // desc
    expect(core.getState().sortDir).toBe('desc');
    expect(core.sortedRows().map((r) => r.title)).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha']);

    core.setSort('title'); // none
    s = core.getState();
    expect(s.sortBy).toBe(null);
    expect(s.sortDir).toBe(null);
  });

  it('setSort on a new column starts at asc', () => {
    const core = makeCore();
    core.setAllRows(SAMPLE);
    core.setSort('score');
    expect(core.getState().sortDir).toBe('asc');
    expect(core.sortedRows().map((r) => r.id)).toEqual([4, 1, 3, 2]);
  });

  it('pagination: pageRows windows sortedRows', () => {
    const core = makeCore({ pageSize: 2 });
    core.setAllRows(SAMPLE);
    core.setSort('title');
    expect(core.pageRows().map((r) => r.id)).toEqual([1, 2]);
    core.setPage(1);
    expect(core.pageRows().map((r) => r.id)).toEqual([3, 4]);
    expect(core.pageCount()).toBe(2);
  });

  it('setPage clamps to valid range', () => {
    const core = makeCore({ pageSize: 2 });
    core.setAllRows(SAMPLE);
    core.setPage(99);
    expect(core.getState().page).toBe(1);
    core.setPage(-5);
    expect(core.getState().page).toBe(0);
  });

  it('setPageSize resets to page 0', () => {
    const core = makeCore({ pageSize: 2 });
    core.setAllRows(SAMPLE);
    core.setPage(1);
    core.setPageSize(10);
    expect(core.getState().page).toBe(0);
    expect(core.pageCount()).toBe(1);
  });

  it('upsertRow adds a new row; updates in place when key exists', () => {
    const core = makeCore();
    core.setAllRows(SAMPLE);
    const d1 = core.upsertRow({ id: 5, title: 'Echo', status: 'draft', score: 1 });
    expect(d1.added).toEqual([5]);
    expect(core.getState().rows.length).toBe(5);

    const d2 = core.upsertRow({ id: 1, title: 'ALPHA!', status: 'draft', score: 10 });
    expect(d2.added).toEqual([]);
    expect(core.getState().rows.find((r) => r.id === 1)?.title).toBe('ALPHA!');
  });

  it('removeRow deletes and prunes selection', () => {
    const core = makeCore({ selectionMode: 'multi' });
    core.setAllRows(SAMPLE);
    core.selectRow(2);
    const delta = core.removeRow(2);
    expect(delta.removed).toEqual([2]);
    expect(core.getState().rows.find((r) => r.id === 2)).toBeUndefined();
    expect(core.getState().selection.size).toBe(0);
  });

  it('applyPatch(reload) is a no-op on core (caller refetches)', () => {
    const core = makeCore();
    core.setAllRows(SAMPLE);
    const delta = core.applyPatch({ type: 'reload' });
    expect(delta.changed).toBe(false);
  });

  it('selection: single mode replaces', () => {
    const core = makeCore({ selectionMode: 'single' });
    core.setAllRows(SAMPLE);
    core.selectRow(1);
    core.selectRow(2);
    expect([...core.getState().selection]).toEqual([2]);
  });

  it('selection: toggleSelectAllOnPage scoped to visible page', () => {
    const core = makeCore({ pageSize: 2, selectionMode: 'multi' });
    core.setAllRows(SAMPLE);
    core.setSort('title'); // page 0 = Alpha, Bravo = ids 1, 2
    core.toggleSelectAllOnPage();
    expect([...core.getState().selection].sort()).toEqual([1, 2]);

    core.setPage(1);
    core.toggleSelectAllOnPage();
    expect([...core.getState().selection].sort()).toEqual([1, 2, 3, 4]);
  });

  it('setSelectionMode single prunes multi selection to one', () => {
    const core = makeCore({ selectionMode: 'multi' });
    core.setAllRows(SAMPLE);
    core.selectRow(1);
    core.selectRow(2);
    core.setSelectionMode('single');
    expect(core.getState().selection.size).toBe(1);
  });

  it('subscribe notifies on change; unsubscribe detaches', () => {
    const core = makeCore();
    const events: string[] = [];
    const unsub = core.subscribe((s: DataTableState<TestRow>) => events.push(s.status));
    core.setAllRows(SAMPLE);
    core.setAllRows([]);
    unsub();
    core.setAllRows(SAMPLE);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]).toBe(STATUS.EMPTY);
  });

  it('setLoading and setError move status; setError sets error message', () => {
    const core = makeCore();
    core.setLoading();
    expect(core.getState().status).toBe(STATUS.LOADING);
    core.setError('boom');
    const s = core.getState();
    expect(s.status).toBe(STATUS.ERROR);
    expect(s.error).toBe('boom');
  });
});
