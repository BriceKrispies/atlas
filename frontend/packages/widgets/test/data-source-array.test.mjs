import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrayDataSource } from '../src/data-source/array-data-source.js';

test('arrayDataSource fetchAll returns a copy with total', async () => {
  const rows = [{ id: 1 }, { id: 2 }];
  const ds = arrayDataSource(rows);
  const result = await ds.fetchAll();
  assert.deepEqual(result.rows, rows);
  assert.notEqual(result.rows, rows, 'must be a copy');
  assert.equal(result.total, 2);
});

test('arrayDataSource tolerates non-array input', async () => {
  const ds = arrayDataSource(/** @type {any} */ (null));
  const result = await ds.fetchAll();
  assert.deepEqual(result.rows, []);
  assert.equal(result.total, 0);
});

test('arrayDataSource.subscribe emits reload on setRows', async () => {
  const ds = arrayDataSource([{ id: 1 }]);
  /** @type {any[]} */
  const events = [];
  const unsub = ds.subscribe((p) => events.push(p));
  ds.setRows([{ id: 1 }, { id: 2 }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'reload');
  unsub();
  ds.setRows([]);
  assert.equal(events.length, 1, 'no more events after unsubscribe');
});

test('arrayDataSource.emit forwards patches to subscribers', () => {
  const ds = arrayDataSource();
  /** @type {any[]} */
  const events = [];
  ds.subscribe((p) => events.push(p));
  ds.emit({ type: 'upsert', row: { id: 1 } });
  ds.emit({ type: 'remove', rowKey: 1 });
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'upsert');
  assert.equal(events[1].type, 'remove');
});

test('arrayDataSource capabilities includes stream', () => {
  const ds = arrayDataSource();
  assert.ok(ds.capabilities.includes('stream'));
});
