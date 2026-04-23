import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataTableCore, STATUS } from '../src/data-table/data-table-core.js';

const COLUMNS = [
  { key: 'title', label: 'Title', sortable: true, filter: { type: 'text' } },
  { key: 'status', label: 'Status', sortable: true, filter: { type: 'select' } },
  { key: 'score', label: 'Score', sortable: true, filter: { type: 'range' } },
];

const SAMPLE = [
  { id: 1, title: 'Alpha',   status: 'draft',     score: 10 },
  { id: 2, title: 'Bravo',   status: 'published', score: 30 },
  { id: 3, title: 'Charlie', status: 'published', score: 20 },
  { id: 4, title: 'Delta',   status: 'draft',     score: 5  },
];

function makeCore(overrides = {}) {
  return new DataTableCore({ columns: COLUMNS, rowKey: 'id', pageSize: 2, ...overrides });
}

test('initial state is idle with empty rows', () => {
  const core = makeCore();
  const s = core.getState();
  assert.equal(s.status, STATUS.IDLE);
  assert.deepEqual(s.rows, []);
  assert.equal(s.page, 0);
  assert.equal(core.pageCount(), 1);
});

test('setAllRows → ready + prunes stale selection', () => {
  const core = makeCore({ selectionMode: 'multi' });
  core.setAllRows(SAMPLE);
  core.selectRow(2);
  assert.deepEqual([...core.getState().selection], [2]);

  core.setAllRows(SAMPLE.filter((r) => r.id !== 2));
  assert.deepEqual([...core.getState().selection], [], 'stale selection pruned');
  assert.equal(core.getState().status, STATUS.READY);
});

test('setAllRows with [] → empty status', () => {
  const core = makeCore();
  core.setAllRows([]);
  assert.equal(core.getState().status, STATUS.EMPTY);
});

test('setFilter on text narrows rows; zero-match → filtered-empty', () => {
  const core = makeCore();
  core.setAllRows(SAMPLE);
  core.setFilter('title', 'alp');
  assert.deepEqual(core.filteredRows().map((r) => r.id), [1]);

  core.setFilter('title', 'no-match-ever');
  assert.equal(core.getState().status, STATUS.FILTERED_EMPTY);

  core.clearFilters();
  assert.equal(core.getState().status, STATUS.READY);
  assert.equal(core.filteredRows().length, 4);
});

test('setSort cycles asc → desc → none, resets page', () => {
  const core = makeCore();
  core.setAllRows(SAMPLE);
  core.setPage(1);

  core.setSort('title'); // asc
  let s = core.getState();
  assert.equal(s.sortBy, 'title');
  assert.equal(s.sortDir, 'asc');
  assert.equal(s.page, 0);
  assert.deepEqual(core.sortedRows().map((r) => r.title), ['Alpha', 'Bravo', 'Charlie', 'Delta']);

  core.setSort('title'); // desc
  assert.equal(core.getState().sortDir, 'desc');
  assert.deepEqual(core.sortedRows().map((r) => r.title), ['Delta', 'Charlie', 'Bravo', 'Alpha']);

  core.setSort('title'); // none
  s = core.getState();
  assert.equal(s.sortBy, null);
  assert.equal(s.sortDir, null);
});

test('setSort on a new column starts at asc', () => {
  const core = makeCore();
  core.setAllRows(SAMPLE);
  core.setSort('score');
  assert.equal(core.getState().sortDir, 'asc');
  assert.deepEqual(core.sortedRows().map((r) => r.id), [4, 1, 3, 2]);
});

test('pagination: pageRows windows sortedRows', () => {
  const core = makeCore({ pageSize: 2 });
  core.setAllRows(SAMPLE);
  core.setSort('title');
  assert.deepEqual(core.pageRows().map((r) => r.id), [1, 2]);
  core.setPage(1);
  assert.deepEqual(core.pageRows().map((r) => r.id), [3, 4]);
  assert.equal(core.pageCount(), 2);
});

test('setPage clamps to valid range', () => {
  const core = makeCore({ pageSize: 2 });
  core.setAllRows(SAMPLE);
  core.setPage(99);
  assert.equal(core.getState().page, 1, 'clamped to last page');
  core.setPage(-5);
  assert.equal(core.getState().page, 0);
});

test('setPageSize resets to page 0', () => {
  const core = makeCore({ pageSize: 2 });
  core.setAllRows(SAMPLE);
  core.setPage(1);
  core.setPageSize(10);
  assert.equal(core.getState().page, 0);
  assert.equal(core.pageCount(), 1);
});

test('upsertRow adds a new row; updates in place when key exists', () => {
  const core = makeCore();
  core.setAllRows(SAMPLE);
  const d1 = core.upsertRow({ id: 5, title: 'Echo', status: 'draft', score: 1 });
  assert.deepEqual(d1.added, [5]);
  assert.equal(core.getState().rows.length, 5);

  const d2 = core.upsertRow({ id: 1, title: 'ALPHA!', status: 'draft', score: 10 });
  assert.deepEqual(d2.added, [], 'existing key is not re-added');
  assert.equal(core.getState().rows.find((r) => r.id === 1).title, 'ALPHA!');
});

test('removeRow deletes and prunes selection', () => {
  const core = makeCore({ selectionMode: 'multi' });
  core.setAllRows(SAMPLE);
  core.selectRow(2);
  const delta = core.removeRow(2);
  assert.deepEqual(delta.removed, [2]);
  assert.equal(core.getState().rows.find((r) => r.id === 2), undefined);
  assert.equal(core.getState().selection.size, 0);
});

test('applyPatch(reload) is a no-op on core (caller refetches)', () => {
  const core = makeCore();
  core.setAllRows(SAMPLE);
  const delta = core.applyPatch({ type: 'reload' });
  assert.equal(delta.changed, false);
});

test('selection: single mode replaces', () => {
  const core = makeCore({ selectionMode: 'single' });
  core.setAllRows(SAMPLE);
  core.selectRow(1);
  core.selectRow(2);
  assert.deepEqual([...core.getState().selection], [2]);
});

test('selection: toggleSelectAllOnPage scoped to visible page', () => {
  const core = makeCore({ pageSize: 2, selectionMode: 'multi' });
  core.setAllRows(SAMPLE);
  core.setSort('title'); // page 0 = Alpha, Bravo = ids 1, 2
  core.toggleSelectAllOnPage();
  assert.deepEqual([...core.getState().selection].sort(), [1, 2]);

  core.setPage(1);
  core.toggleSelectAllOnPage();
  assert.deepEqual([...core.getState().selection].sort(), [1, 2, 3, 4]);
});

test('setSelectionMode single prunes multi selection to one', () => {
  const core = makeCore({ selectionMode: 'multi' });
  core.setAllRows(SAMPLE);
  core.selectRow(1);
  core.selectRow(2);
  core.setSelectionMode('single');
  assert.equal(core.getState().selection.size, 1);
});

test('subscribe notifies on change; unsubscribe detaches', () => {
  const core = makeCore();
  const events = [];
  const unsub = core.subscribe((s) => events.push(s.status));
  core.setAllRows(SAMPLE);
  core.setAllRows([]);
  unsub();
  core.setAllRows(SAMPLE);
  assert.ok(events.length >= 2);
  assert.equal(events[events.length - 1], STATUS.EMPTY, 'last seen status');
});

test('setLoading and setError move status; setError sets error message', () => {
  const core = makeCore();
  core.setLoading();
  assert.equal(core.getState().status, STATUS.LOADING);
  core.setError('boom');
  const s = core.getState();
  assert.equal(s.status, STATUS.ERROR);
  assert.equal(s.error, 'boom');
});
