import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortRows, nextSortDir, defaultCompare } from '../src/data-table/sort-core.js';

test('sortRows asc numeric', () => {
  const out = sortRows([{ v: 3 }, { v: 1 }, { v: 2 }], { sortBy: 'v', sortDir: 'asc' });
  assert.deepEqual(out.map((r) => r.v), [1, 2, 3]);
});

test('sortRows desc numeric', () => {
  const out = sortRows([{ v: 1 }, { v: 3 }, { v: 2 }], { sortBy: 'v', sortDir: 'desc' });
  assert.deepEqual(out.map((r) => r.v), [3, 2, 1]);
});

test('sortRows is stable on ties (preserves input order)', () => {
  const rows = [
    { id: 1, v: 'a' },
    { id: 2, v: 'a' },
    { id: 3, v: 'a' },
  ];
  const out = sortRows(rows, { sortBy: 'v', sortDir: 'asc' });
  assert.deepEqual(out.map((r) => r.id), [1, 2, 3]);
});

test('sortRows tiebreak key restores deterministic order', () => {
  const rows = [
    { id: 3, v: 'a' },
    { id: 1, v: 'a' },
    { id: 2, v: 'a' },
  ];
  const out = sortRows(rows, { sortBy: 'v', sortDir: 'asc', tiebreak: 'id' });
  assert.deepEqual(out.map((r) => r.id), [1, 2, 3]);
});

test('sortRows no-op when sortBy or sortDir is null', () => {
  const rows = [{ v: 2 }, { v: 1 }];
  const a = sortRows(rows, { sortBy: null, sortDir: 'asc' });
  const b = sortRows(rows, { sortBy: 'v', sortDir: null });
  assert.deepEqual(a.map((r) => r.v), [2, 1]);
  assert.deepEqual(b.map((r) => r.v), [2, 1]);
});

test('sortRows supports function sortBy', () => {
  const rows = [{ a: { b: 3 } }, { a: { b: 1 } }];
  const out = sortRows(rows, { sortBy: (r) => r.a.b, sortDir: 'asc' });
  assert.deepEqual(out.map((r) => r.a.b), [1, 3]);
});

test('sortRows null values sort last in asc', () => {
  const out = sortRows([{ v: null }, { v: 1 }, { v: 2 }], { sortBy: 'v', sortDir: 'asc' });
  assert.deepEqual(out.map((r) => r.v), [1, 2, null]);
});

test('sortRows returns a new array', () => {
  const rows = [{ v: 1 }];
  const out = sortRows(rows, { sortBy: 'v', sortDir: 'asc' });
  assert.notEqual(out, rows);
});

test('nextSortDir cycles none → asc → desc → none', () => {
  assert.equal(nextSortDir(null), 'asc');
  assert.equal(nextSortDir('asc'), 'desc');
  assert.equal(nextSortDir('desc'), null);
});

test('defaultCompare uses numeric semantics for numeric strings', () => {
  assert.ok(defaultCompare('10', '9') > 0);
  assert.ok(defaultCompare('aa', 'ab') < 0);
});
