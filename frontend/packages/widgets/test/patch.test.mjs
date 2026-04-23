import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, diff, keyOf } from '../src/data-source/patch.js';

test('keyOf handles string field, function, and id fallback', () => {
  assert.equal(keyOf({ id: 1 }, 'id'), 1);
  assert.equal(keyOf({ slug: 'x' }, 'slug'), 'x');
  assert.equal(keyOf({ id: 'z' }, /** @type {any} */ (undefined)), 'z');
  assert.equal(keyOf({ uuid: 'q' }, (r) => r.uuid), 'q');
});

test('applyPatch upsert appends new rows', () => {
  const prev = [{ id: 1 }];
  const next = applyPatch(prev, { type: 'upsert', row: { id: 2, title: 'b' } }, 'id');
  assert.deepEqual(next, [{ id: 1 }, { id: 2, title: 'b' }]);
  assert.notEqual(next, prev);
});

test('applyPatch upsert replaces existing rows by key', () => {
  const prev = [{ id: 1, title: 'a' }, { id: 2 }];
  const next = applyPatch(prev, { type: 'upsert', row: { id: 1, title: 'A' } }, 'id');
  assert.deepEqual(next, [{ id: 1, title: 'A' }, { id: 2 }]);
});

test('applyPatch remove drops the row', () => {
  const prev = [{ id: 1 }, { id: 2 }];
  const next = applyPatch(prev, { type: 'remove', rowKey: 2 }, 'id');
  assert.deepEqual(next, [{ id: 1 }]);
});

test('applyPatch remove is a no-op when key absent', () => {
  const prev = [{ id: 1 }];
  const next = applyPatch(prev, { type: 'remove', rowKey: 99 }, 'id');
  assert.equal(next, prev);
});

test('applyPatch reload is a no-op', () => {
  const prev = [{ id: 1 }];
  const next = applyPatch(prev, { type: 'reload' }, 'id');
  assert.equal(next, prev);
});

test('applyPatch ignores malformed patches', () => {
  const prev = [{ id: 1 }];
  assert.equal(applyPatch(prev, /** @type {any} */ (null), 'id'), prev);
  assert.equal(applyPatch(prev, /** @type {any} */ ({ type: 'upsert' }), 'id'), prev);
});

test('diff detects removed rows', () => {
  const patches = diff([{ id: 1 }, { id: 2 }], [{ id: 1 }], 'id');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].type, 'remove');
  assert.equal(patches[0].rowKey, 2);
});

test('diff detects added rows', () => {
  const patches = diff([{ id: 1 }], [{ id: 1 }, { id: 2 }], 'id');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].type, 'upsert');
  assert.deepEqual(patches[0].row, { id: 2 });
});

test('diff detects updated rows via shallow equality', () => {
  const patches = diff([{ id: 1, t: 'a' }], [{ id: 1, t: 'b' }], 'id');
  assert.equal(patches.length, 1);
  assert.equal(patches[0].type, 'upsert');
});

test('diff is empty when rows are shallowly equal', () => {
  const patches = diff([{ id: 1, t: 'a' }], [{ id: 1, t: 'a' }], 'id');
  assert.deepEqual(patches, []);
});

test('diff round-trip via applyPatch reproduces next', () => {
  const prev = [{ id: 1, t: 'a' }, { id: 2, t: 'b' }];
  const next = [{ id: 2, t: 'b' }, { id: 3, t: 'c' }];
  const patches = diff(prev, next, 'id');
  const applied = patches.reduce((rows, p) => applyPatch(rows, p, 'id'), prev);
  // Order can differ because applyPatch appends; normalize before comparing.
  const sort = (rs) => rs.slice().sort((a, b) => a.id - b.id);
  assert.deepEqual(sort(applied), sort(next));
});
