import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryDataSource } from '../src/data-source/query-data-source.js';

function fakeBackend({ response, subscribe = true } = {}) {
  /** @type {Array<{ eventType: string, cb: (e: any) => void }>} */
  const subs = [];
  const backend = {
    async query(path) {
      return typeof response === 'function' ? response(path) : response;
    },
  };
  if (subscribe) {
    /** @type {any} */ (backend).subscribe = (eventType, cb) => {
      const entry = { eventType, cb };
      subs.push(entry);
      return () => {
        const i = subs.indexOf(entry);
        if (i >= 0) subs.splice(i, 1);
      };
    };
  }
  return { backend, subs, emit: (eventType, data) => {
    for (const s of subs) if (s.eventType === eventType) s.cb(data);
  } };
}

test('queryDataSource.fetchAll normalizes array response', async () => {
  const { backend } = fakeBackend({ response: [{ id: 1 }, { id: 2 }] });
  const ds = queryDataSource(backend, '/pages');
  const result = await ds.fetchAll();
  assert.deepEqual(result.rows, [{ id: 1 }, { id: 2 }]);
  assert.equal(result.total, 2);
});

test('queryDataSource.fetchAll normalizes envelope response', async () => {
  const { backend } = fakeBackend({ response: { rows: [{ id: 1 }], total: 42 } });
  const ds = queryDataSource(backend, '/pages');
  const result = await ds.fetchAll();
  assert.deepEqual(result.rows, [{ id: 1 }]);
  assert.equal(result.total, 42);
});

test('queryDataSource.fetchAll on unexpected payload returns []', async () => {
  const { backend } = fakeBackend({ response: null });
  const ds = queryDataSource(backend, '/pages');
  const result = await ds.fetchAll();
  assert.deepEqual(result.rows, []);
  assert.equal(result.total, 0);
});

test('queryDataSource.subscribe emits reload on matching resourceType', async () => {
  const { backend, emit } = fakeBackend({ response: [] });
  const ds = queryDataSource(backend, '/pages', { resourceType: 'page' });
  /** @type {any[]} */
  const patches = [];
  ds.subscribe((p) => patches.push(p));

  emit('projection.updated', { resourceType: 'page', resourceId: 'a' });
  emit('projection.updated', { resourceType: 'other', resourceId: 'b' });
  emit('projection.updated', { resourceType: 'page', resourceId: 'c' });

  assert.equal(patches.length, 2);
  assert.equal(patches[0].type, 'reload');
  assert.equal(patches[1].type, 'reload');
});

test('queryDataSource honours onEvent converter', async () => {
  const { backend, emit } = fakeBackend({ response: [] });
  const ds = queryDataSource(backend, '/pages', {
    resourceType: 'page',
    onEvent: (ev) => ev.payload
      ? { type: 'upsert', row: ev.payload }
      : { type: 'remove', rowKey: ev.resourceId },
  });
  /** @type {any[]} */
  const patches = [];
  ds.subscribe((p) => patches.push(p));

  emit('projection.updated', { resourceType: 'page', resourceId: 'a', payload: { id: 'a', title: 'Hi' } });
  emit('projection.updated', { resourceType: 'page', resourceId: 'a' });

  assert.equal(patches.length, 2);
  assert.equal(patches[0].type, 'upsert');
  assert.deepEqual(patches[0].row, { id: 'a', title: 'Hi' });
  assert.equal(patches[1].type, 'remove');
  assert.equal(patches[1].rowKey, 'a');
});

test('queryDataSource.subscribe unsubscribe detaches listener', () => {
  const { backend, subs, emit } = fakeBackend({ response: [] });
  const ds = queryDataSource(backend, '/pages');
  /** @type {any[]} */
  const patches = [];
  const unsub = ds.subscribe((p) => patches.push(p));
  assert.equal(subs.length, 1);
  unsub();
  assert.equal(subs.length, 0);
  emit('projection.updated', { resourceType: 'page' });
  assert.equal(patches.length, 0);
});

test('queryDataSource capabilities includes stream only when subscribe is available', () => {
  const streaming = queryDataSource(fakeBackend({ response: [], subscribe: true }).backend, '/x');
  const static_ = queryDataSource(fakeBackend({ response: [], subscribe: false }).backend, '/x');
  assert.ok(streaming.capabilities.includes('stream'));
  assert.ok(!static_.capabilities.includes('stream'));
});
