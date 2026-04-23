import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectRow,
  unselectRow,
  toggleRow,
  toggleAllOnPage,
  clearSelection,
} from '../src/data-table/selection-core.js';

test('selectRow none mode is a no-op', () => {
  const before = new Set();
  const after = selectRow('none', before, 1);
  assert.equal(after, before);
});

test('selectRow single mode replaces the entry', () => {
  const after = selectRow('single', new Set([1]), 2);
  assert.deepEqual([...after], [2]);
});

test('selectRow single mode is a no-op when already selected', () => {
  const before = new Set([1]);
  const after = selectRow('single', before, 1);
  assert.equal(after, before);
});

test('selectRow multi mode adds to set', () => {
  const after = selectRow('multi', new Set([1]), 2);
  assert.deepEqual([...after].sort(), [1, 2]);
});

test('unselectRow removes entry in multi mode', () => {
  const after = unselectRow('multi', new Set([1, 2]), 1);
  assert.deepEqual([...after], [2]);
});

test('toggleRow adds then removes', () => {
  const a = toggleRow('multi', new Set(), 1);
  assert.deepEqual([...a], [1]);
  const b = toggleRow('multi', a, 1);
  assert.equal(b.size, 0);
});

test('toggleAllOnPage selects all when none selected', () => {
  const out = toggleAllOnPage('multi', new Set(), [1, 2, 3]);
  assert.deepEqual([...out].sort(), [1, 2, 3]);
});

test('toggleAllOnPage deselects all when all already selected', () => {
  const out = toggleAllOnPage('multi', new Set([1, 2, 3]), [1, 2, 3]);
  assert.equal(out.size, 0);
});

test('toggleAllOnPage partial selection selects remaining', () => {
  const out = toggleAllOnPage('multi', new Set([1]), [1, 2, 3]);
  assert.deepEqual([...out].sort(), [1, 2, 3]);
});

test('toggleAllOnPage no-op for single mode', () => {
  const before = new Set([1]);
  const after = toggleAllOnPage('single', before, [1, 2, 3]);
  assert.equal(after, before);
});

test('clearSelection empties set and returns new reference', () => {
  const before = new Set([1, 2]);
  const after = clearSelection(before);
  assert.equal(after.size, 0);
  assert.notEqual(after, before);
});

test('clearSelection returns same reference when already empty', () => {
  const before = new Set();
  const after = clearSelection(before);
  assert.equal(after, before);
});
