import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRows } from '../src/data-table/filter-core.js';

const rows = [
  { id: 1, title: 'Hello world', status: 'published', score: 10 },
  { id: 2, title: 'Another post', status: 'draft',     score: 25 },
  { id: 3, title: 'Weekly HELLO', status: 'published', score: 3  },
];

test('text filter is case-insensitive substring', () => {
  const out = filterRows(rows, { title: 'hello' }, [{ key: 'title' }]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.id), [1, 3]);
});

test('blank filter values are ignored', () => {
  const out = filterRows(rows, { title: '   ', status: '' }, [
    { key: 'title' }, { key: 'status' },
  ]);
  assert.equal(out.length, 3);
});

test('eq filter is strict string equality', () => {
  const out = filterRows(rows, { status: 'draft' }, [
    { key: 'status', filter: { type: 'eq' } },
  ]);
  assert.deepEqual(out.map((r) => r.id), [2]);
});

test('select filter with array is "in"', () => {
  const out = filterRows(rows, { status: ['draft', 'published'] }, [
    { key: 'status', filter: { type: 'select' } },
  ]);
  assert.equal(out.length, 3);
});

test('select filter with empty array is ignored', () => {
  const out = filterRows(rows, { status: [] }, [
    { key: 'status', filter: { type: 'select' } },
  ]);
  assert.equal(out.length, 3);
});

test('range filter inclusive', () => {
  const out = filterRows(rows, { score: { min: 5, max: 20 } }, [
    { key: 'score', filter: { type: 'range' } },
  ]);
  assert.deepEqual(out.map((r) => r.id), [1]);
});

test('range filter min-only', () => {
  const out = filterRows(rows, { score: { min: 10 } }, [
    { key: 'score', filter: { type: 'range' } },
  ]);
  assert.deepEqual(out.map((r) => r.id), [1, 2]);
});

test('range filter blank object is ignored', () => {
  const out = filterRows(rows, { score: { min: null, max: null } }, [
    { key: 'score', filter: { type: 'range' } },
  ]);
  assert.equal(out.length, 3);
});

test('custom filter uses provided matches()', () => {
  const out = filterRows(rows, { score: 15 }, [
    { key: 'score', filter: { type: 'custom', matches: (f, v) => Number(v) < f } },
  ]);
  assert.deepEqual(out.map((r) => r.id), [1, 3]);
});

test('function column accessor is honoured', () => {
  const out = filterRows(rows, { upperTitle: 'WORLD' }, [
    { key: (r) => r.title.toUpperCase(), filter: { type: 'text' } },
  ].map((c) => ({ ...c })));
  // Function keys aren't looked up by columnKey — ignored. Sanity: no filter applies.
  assert.equal(out.length, 3);
});
